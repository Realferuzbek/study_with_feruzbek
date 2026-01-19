import { sanitizeCallbackPath } from "./signin-messages";

export function isTelegramWebView(ua?: string): boolean {
  if (typeof ua !== "string" || ua.length === 0) return false;
  return /telegram/i.test(ua);
}

const TELEGRAM_INAPP_PARAM = "inapp";
const TELEGRAM_INAPP_VALUE = "telegram";

export function isTelegramInAppParam(value?: string | null): boolean {
  return (value ?? "").toLowerCase() === TELEGRAM_INAPP_VALUE;
}

export function isAndroidWebView(ua: string): boolean {
  if (!ua) return false;
  const u = ua.toLowerCase();
  return u.includes("; wv");
}

export function isKnownInAppBrowserUA(ua: string): boolean {
  if (!ua) return false;
  const u = ua.toLowerCase();
  const tokens = [
    "telegram",
    "instagram",
    "fbav",
    "fban",
    "fb_iab",
    "messenger",
    "line",
    "snapchat",
    "tiktok",
    "okhttp",
  ];
  return tokens.some((token) => u.includes(token));
}

export function isInAppBrowserUA(ua: string): boolean {
  return isAndroidWebView(ua) || isKnownInAppBrowserUA(ua);
}

export function isRealBrowserUA(ua: string): boolean {
  if (!ua) return false;
  const u = ua.toLowerCase();
  const looksLikeBrowser =
    u.includes("safari") ||
    u.includes("chrome") ||
    u.includes("crios") ||
    u.includes("fxios") ||
    u.includes("edg") ||
    u.includes("brave");
  if (isInAppBrowserUA(ua)) return false;
  return looksLikeBrowser;
}

function isRelativePath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

export function stripTelegramInAppFromCallback(value: string): string {
  if (!isRelativePath(value)) return value;
  try {
    const callbackUrl = new URL(value, "https://example.com");
    const inappValues = callbackUrl.searchParams.getAll(TELEGRAM_INAPP_PARAM);
    if (inappValues.some(isTelegramInAppParam)) {
      callbackUrl.searchParams.delete(TELEGRAM_INAPP_PARAM);
    }
    return callbackUrl.pathname + callbackUrl.search;
  } catch {
    return value;
  }
}

export function buildExternalSigninUrl(currentUrl: string): string {
  try {
    const url = new URL(currentUrl);
    url.hash = "";
    const callback = stripTelegramInAppFromCallback(url.pathname + url.search);
    return buildContinueConfirmUrl(url.toString(), callback);
  } catch {
    return "/continue/confirm?callbackUrl=/";
  }
}

export function buildContinueConfirmUrl(
  baseUrl: string,
  callbackUrl: string,
): string {
  const cleanedCallback = stripTelegramInAppFromCallback(callbackUrl);
  const safeCallback = sanitizeCallbackPath(cleanedCallback) ?? "/";
  try {
    const base = new URL(baseUrl);
    const confirm = new URL("/continue/confirm", base);
    confirm.searchParams.set("callbackUrl", safeCallback);
    return confirm.toString();
  } catch {
    return `/continue/confirm?callbackUrl=${encodeURIComponent(safeCallback)}`;
  }
}

export type AndroidIntentOptions = {
  chromePackage?: boolean;
};

export function buildAndroidIntentUrl(
  targetUrl: string,
  options?: AndroidIntentOptions,
): string | null {
  try {
    const url = new URL(targetUrl);
    const isLocalhost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1";
    const scheme = isLocalhost ? "http" : "https";
    const parts = [
      `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${scheme};`,
    ];
    if (options?.chromePackage) {
      parts.push("package=com.android.chrome;");
    }
    parts.push("end");
    return parts.join("");
  } catch {
    return null;
  }
}
