import { NextResponse, type NextRequest } from "next/server";
import { stripTelegramInAppFromCallback } from "@/lib/inapp-browser";
import { sanitizeCallbackPath } from "@/lib/signin-messages";

const REAL_BROWSER_COOKIE = "sm_real_browser";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function resolveCallbackUrl(req: NextRequest): string {
  const raw = req.nextUrl.searchParams.get("callbackUrl") ?? "/";
  const cleaned = stripTelegramInAppFromCallback(raw);
  return sanitizeCallbackPath(cleaned) ?? "/";
}

export function GET(req: NextRequest) {
  const callbackUrl = resolveCallbackUrl(req);
  const redirect = NextResponse.redirect(new URL(callbackUrl, req.url));

  redirect.cookies.set(REAL_BROWSER_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });

  return redirect;
}
