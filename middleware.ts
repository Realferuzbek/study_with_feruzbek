// middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { applySecurityHeaders } from "./lib/security-headers";
import { getToken } from "next-auth/jwt";
import { generateCsrfToken, CSRF_COOKIE_NAME, CSRF_HEADER } from "./lib/csrf";
import {
  requiresCsrfProtection,
  validateCsrfTokens,
  buildCsrfCookieOptions,
  buildSessionCookieOptions,
} from "./lib/csrf-guard";
import {
  buildBlockedRedirectUrl,
  isBlockedFlag,
} from "./lib/blocked-user-guard";

type EnvMap = Record<string, string | undefined>;

const ENV: EnvMap = ((globalThis as Record<string, any>)?.process?.env ??
  {}) as EnvMap;

const DEFAULT_SESSION_VERSION = "1";
const SESSION_VERSION_CACHE_TTL_MS = 15_000;
const SESSION_VERSION_FALLBACK_TTL_MS = 2_000;

type SessionVersionCacheEntry = {
  value: string;
  expiresAt: number;
};

let sessionVersionCache: SessionVersionCacheEntry | null = null;
let sessionVersionInflight: Promise<string> | null = null;

const CSRF_ENFORCEMENT_DISABLED = ENV.CSRF_ENFORCEMENT_DISABLED === "1";
const CSRF_MAINTENANCE_PATH_PREFIXES = (ENV.CSRF_MAINTENANCE_PATHS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

const INTERNAL_ADMIN_SIGNATURE_HEADER = "x-internal-admin-signature";
let cachedInternalSignature: string | null = null;

async function getInternalAdminSignature(): Promise<string | null> {
  if (cachedInternalSignature) return cachedInternalSignature;
  const secret = ENV.NEXTAUTH_SECRET;
  if (!secret) return null;
  try {
    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(secret),
    );
    const hashArray = Array.from(new Uint8Array(digest));
    cachedInternalSignature = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return cachedInternalSignature;
  } catch {
    return null;
  }
}

function isProduction(): boolean {
  return ENV.NODE_ENV === "production";
}

function buildSecurityContext(req: NextRequest) {
  const proto = req.nextUrl.protocol;
  const forwardedProto = req.headers.get("x-forwarded-proto");
  return {
    isProduction: isProduction(),
    isSecureTransport:
      proto === "https" || proto === "https:" || forwardedProto === "https",
  };
}

const PUBLIC_PATHS = new Set<string>([
  "/continue",
  "/signin",
  "/api/auth",
  "/api/live",
  "/api/reindex",
  "/api/leaderboard/health",
  "/api/leaderboard/latest",
  "/api/cron/leaderboard",
  "/api/cron/nightly-reindex",
  "/api/telegram/webhook",
  "/api/100ms/webhook",
  "/api/100ms/token",
  "/api/admin/state",
  "/_next",
  "/favicon.ico",
  "/robots.txt",
  "/opengraph-image",
]);

const PUBLIC_API_BYPASS_PATHS = ["/api/leaderboard/ingest"];

// treat common static assets as public
const STATIC_EXT = /\.(?:png|svg|jpg|jpeg|gif|webp|ico|txt|xml|html)$/i;

function isAdminPath(pathname: string): boolean {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return true;
  if (pathname === "/community/admin" || pathname.startsWith("/community/admin/")) {
    return true;
  }
  if (pathname === "/leaderboard/admin" || pathname.startsWith("/leaderboard/admin/")) {
    return true;
  }
  return false;
}

function isPublic(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isAdminPath(pathname)) return false;
  if (pathname === "/") return true;
  if (pathname === "/api/chat") return true;
  if (pathname === "/api/chat/status") return true;
  if (pathname === "/api/chat/rating") return true;
  if (pathname === "/api/ai/health") return true;
  if (STATIC_EXT.test(pathname)) return true;
  for (const p of PUBLIC_PATHS) if (pathname.startsWith(p)) return true;
  return false;
}

function isBypassPath(pathname: string): boolean {
  return PUBLIC_API_BYPASS_PATHS.some((path) => pathname.startsWith(path));
}

type SessionSnapshot = {
  is_blocked: boolean | string | number | null | undefined;
};

async function fetchSessionSnapshot(
  req: NextRequest,
): Promise<SessionSnapshot | null> {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  try {
    const sessionUrl = new URL("/api/auth/session", req.url);
    const res = await fetch(sessionUrl.toString(), {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const payload = await res.json();
    const user = payload?.user;
    if (!user) return null;
    return {
      is_blocked: user.is_blocked,
    };
  } catch (error) {
    console.warn("[middleware] session snapshot fetch failed", {
      path: req.nextUrl.pathname,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function isMaintenanceBypassPath(pathname: string): boolean {
  for (const prefix of CSRF_MAINTENANCE_PATH_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

function redactUrlOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.origin;
  } catch {
    return value.slice(0, 128);
  }
}

function readSessionVersionCache(now: number): string | null {
  if (sessionVersionCache && sessionVersionCache.expiresAt > now) {
    return sessionVersionCache.value;
  }
  return null;
}

function writeSessionVersionCache(value: string, ttlMs: number) {
  sessionVersionCache = {
    value,
    expiresAt: Date.now() + ttlMs,
  };
}

async function resolveLatestSessionVersion(
  req: NextRequest,
  fallback: string | null,
): Promise<string> {
  const now = Date.now();
  const cached = readSessionVersionCache(now);
  if (cached) return cached;

  if (!sessionVersionInflight) {
    sessionVersionInflight = (async () => {
      try {
        const stateUrl = new URL("/api/admin/state", req.url);
        const signature = await getInternalAdminSignature();
        const fetchOptions: RequestInit = { cache: "no-store" };
        if (signature) {
          fetchOptions.headers = {
            [INTERNAL_ADMIN_SIGNATURE_HEADER]: signature,
          };
        }
        const res = await fetch(stateUrl.toString(), fetchOptions);
        if (res.ok) {
          const data = await res.json();
          const value = `${data?.session_version ?? 1}`;
          writeSessionVersionCache(value, SESSION_VERSION_CACHE_TTL_MS);
          return value;
        }
      } catch {}
      const fallbackValue =
        fallback ?? sessionVersionCache?.value ?? DEFAULT_SESSION_VERSION;
      writeSessionVersionCache(fallbackValue, SESSION_VERSION_FALLBACK_TTL_MS);
      return fallbackValue;
    })();
  }

  const latest = await sessionVersionInflight;
  sessionVersionInflight = null;
  return latest;
}

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  if (isBypassPath(url.pathname)) {
    return NextResponse.next();
  }

  const baseSecurityContext = buildSecurityContext(req);
  const isTimerFeaturePage =
    url.pathname === "/feature/timer" ||
    url.pathname.startsWith("/feature/timer/");
  const securityContext = isTimerFeaturePage
    ? { ...baseSecurityContext, allowIframe: true }
    : baseSecurityContext;

  const isTimerPath = url.pathname.startsWith("/timer/");

  // Allow iframe embedding for timer HTML files and make timer assets public
  if (isTimerPath) {
    const resp = NextResponse.next();
    // Allow iframe embedding for HTML files, regular headers for other assets
    const isTimerHtml = url.pathname.includes(".html");
    const timerSecurityContext = isTimerHtml
      ? { ...baseSecurityContext, allowIframe: true }
      : baseSecurityContext;
    return applySecurityHeaders(resp, timerSecurityContext);
  }

  if (isPublic(req) || isTimerFeaturePage) {
    const resp = NextResponse.next();
    // apply security headers in all responses including public assets
    return applySecurityHeaders(resp, securityContext);
  }

  let token: any = null;
  try {
    token = await getToken({ req, secret: ENV.NEXTAUTH_SECRET });
  } catch (error) {
    console.warn("[middleware] token decode failed", {
      path: url.pathname,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!token) {
    const snapshot = await fetchSessionSnapshot(req);
    if (snapshot) {
      token = {
        is_blocked: snapshot.is_blocked,
      };
    }
  }

  if (!token) {
    if (url.pathname.startsWith("/api/")) {
      const resp = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      return applySecurityHeaders(resp, securityContext);
    }
    if (isAdminPath(url.pathname)) {
      const signin = new URL("/signin", req.url);
      signin.searchParams.set("callbackUrl", url.pathname + url.search);
      const redirect = NextResponse.redirect(signin);
      return applySecurityHeaders(redirect, securityContext);
    }
    const resp = NextResponse.next();
    return applySecurityHeaders(resp, securityContext);
  }

  if (isBlockedFlag((token as any).is_blocked)) {
    const redirect = NextResponse.redirect(buildBlockedRedirectUrl(req.url));
    return applySecurityHeaders(redirect, securityContext);
  }

  // CSRF protections (double-submit cookie) for cookie-backed sessions
  const method = req.method?.toUpperCase();
  const needsCsrf = requiresCsrfProtection(method, url.pathname);
  const csrfBypassed =
    needsCsrf &&
    (CSRF_ENFORCEMENT_DISABLED || isMaintenanceBypassPath(url.pathname));
  let csrfTokenToSet: string | null = null;

  // For authenticated GETs, ensure a CSRF cookie is present (non-HttpOnly so client JS can read it)
  if (!needsCsrf && method === "GET") {
    const existing = req.cookies.get(CSRF_COOKIE_NAME)?.value;
    if (!existing) {
      csrfTokenToSet = generateCsrfToken();
    }
  }

  const finalizeResponse = (resp: NextResponse) => {
    if (csrfTokenToSet) {
      resp.cookies.set(
        CSRF_COOKIE_NAME,
        csrfTokenToSet,
        buildCsrfCookieOptions(securityContext),
      );
    }
    return applySecurityHeaders(resp, securityContext);
  };

  // Verify CSRF on state-changing requests unless webhook or public
  if (needsCsrf && !csrfBypassed) {
    const cookieVal = req.cookies.get(CSRF_COOKIE_NAME)?.value;
    const headerVal = req.headers.get(CSRF_HEADER) ?? undefined;
    const originHeader = req.headers.get("origin");
    const refererHeader = req.headers.get("referer");
    const validation = validateCsrfTokens({
      cookieToken: cookieVal,
      headerToken: headerVal,
      originHeader,
      refererHeader,
      expectedOrigin: req.nextUrl.origin,
    });
    if (!validation.ok) {
      const forwardedFor =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      console.warn("[csrf] blocked request", {
        path: url.pathname,
        method,
        reasons: validation.reasons,
        origin: redactUrlOrigin(originHeader),
        referer: redactUrlOrigin(refererHeader),
        forwardedFor,
      });
      const resp = new NextResponse("CSRF token missing or invalid", {
        status: 403,
      });
      return finalizeResponse(resp);
    }
  } else if (csrfBypassed) {
    console.warn("[csrf] enforcement bypassed", {
      path: url.pathname,
      method,
      maintenance: true,
    });
  }

  const svCookie = req.cookies.get("sv")?.value ?? null;
  const latestVersion = await resolveLatestSessionVersion(req, svCookie);

  if (svCookie && latestVersion && svCookie !== latestVersion) {
    const out = new URL("/api/auth/signout", req.url);
    out.searchParams.set("callbackUrl", "/signin");
    const redirect = NextResponse.redirect(out);
    return finalizeResponse(redirect);
  }

  const response = NextResponse.next();
  if (latestVersion && svCookie !== latestVersion) {
    response.cookies.set(
      "sv",
      latestVersion,
      buildSessionCookieOptions(securityContext),
    );
  }

  return finalizeResponse(response);
}

export const config = {
  // EFFECT: Skips middleware on static assets while covering root/signin for auth checks.
  matcher: [
    "/",
    "/signin",
    "/timer/flip_countdown_new/index.html",
    "/((?!$|_next|signin|.*\\.(?:ico|png|jpg|jpeg|gif|svg|webp|avif|css|js|woff2?|txt|json)$).+)",
  ],
};
