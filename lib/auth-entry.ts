"use client";

import { isInAppBrowserUA, isRealBrowserUA } from "@/lib/inapp-browser";
import { sanitizeCallbackPath } from "@/lib/signin-messages";

type AuthEntryMode = "signin" | "register";

type RouterLike = {
  push: (href: string) => void;
};

function buildSigninPath(mode: AuthEntryMode, callbackUrl: string): string {
  const safeCallback = sanitizeCallbackPath(callbackUrl) ?? "/dashboard";
  const params = new URLSearchParams();
  params.set("callbackUrl", safeCallback);
  if (mode === "register") {
    params.set("mode", "register");
  }
  return `/signin?${params.toString()}`;
}

export function openAuthEntry(
  mode: AuthEntryMode,
  callbackUrl: string,
  router?: RouterLike,
) {
  if (typeof window === "undefined") return;
  const ua = navigator.userAgent ?? "";
  const inApp = isInAppBrowserUA(ua);
  const realBrowser = isRealBrowserUA(ua);
  const authPath = buildSigninPath(mode, callbackUrl);
  const target = inApp && !realBrowser
    ? `/continue?to=${encodeURIComponent(authPath)}`
    : authPath;
  if (router) {
    router.push(target);
    return;
  }
  window.location.assign(target);
}

export type { AuthEntryMode };
