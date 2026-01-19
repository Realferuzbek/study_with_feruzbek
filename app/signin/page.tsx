// app/signin/page.tsx
export const dynamic = "force-dynamic";

import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import SignInInteractive from "@/components/SignInInteractive";
import ContinueInBrowserButton from "@/components/ContinueInBrowserButton";
import { getCachedSession } from "@/lib/server-session";
import {
  isAndroidWebView,
  isKnownInAppBrowserUA,
  isRealBrowserUA,
  isTelegramInAppParam,
  stripTelegramInAppFromCallback,
} from "@/lib/inapp-browser";
import {
  sanitizeCallbackPath,
  SWITCH_ACCOUNT_DISABLED_NOTICE,
} from "@/lib/signin-messages";

type SignInPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function isSwitchRequested(
  searchParams?: Record<string, string | string[] | undefined>,
) {
  if (!searchParams) return false;
  const raw = searchParams.switch;
  if (Array.isArray(raw)) {
    return raw.some((value) => value === "1");
  }
  return raw === "1";
}

function isTelegramEntryParam(
  searchParams?: Record<string, string | string[] | undefined>,
) {
  if (!searchParams) return false;
  const raw = searchParams.inapp;
  if (Array.isArray(raw)) {
    return raw.some(isTelegramInAppParam);
  }
  return isTelegramInAppParam(raw);
}

function buildSearchString(
  searchParams?: Record<string, string | string[] | undefined>,
) {
  if (!searchParams) return "";
  const params = new URLSearchParams();
  Object.entries(searchParams).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (typeof entry === "string") params.append(key, entry);
      });
    } else if (typeof value === "string") {
      params.set(key, value);
    }
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const hintId = "signin-hint";
  const session = await getCachedSession();
  const isSignedIn = !!session?.user;
  const switchRequested = isSwitchRequested(searchParams);
  const ua = headers().get("user-agent") ?? "";
  const inAppUa = isAndroidWebView(ua) || isKnownInAppBrowserUA(ua);
  const realBrowser = isRealBrowserUA(ua);
  const forcedInApp = isTelegramEntryParam(searchParams);
  const shouldContinueGate = (inAppUa || forcedInApp) && !realBrowser;
  const callbackUrl =
    sanitizeCallbackPath(searchParams?.callbackUrl) ?? "/dashboard";

  if (isSignedIn && !switchRequested && !shouldContinueGate) {
    redirect(callbackUrl);
  }

  if (shouldContinueGate) {
    const rawTarget = `/signin${buildSearchString(searchParams)}`;
    const cleanedTarget = stripTelegramInAppFromCallback(rawTarget);
    const targetPath = sanitizeCallbackPath(cleanedTarget) ?? "/signin";

    return (
      <div className="min-h-screen grid place-items-center bg-neutral-950 text-white">
        <main
          className="w-[520px] max-w-[92vw] rounded-3xl bg-neutral-900/70 px-8 pb-10 pt-9 shadow-[0_0_120px_40px_rgba(118,0,255,0.2)] backdrop-blur"
          role="main"
          aria-label="Continue in browser"
        >
          <ContinueInBrowserButton targetPath={targetPath} />
          <p className="mt-4 text-center text-sm text-neutral-300">
            Continue in your browser to sign in.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center bg-neutral-950 text-white">
      <main
        className="w-[520px] max-w-[92vw] rounded-3xl bg-neutral-900/70 px-8 pb-10 pt-9 shadow-[0_0_120px_40px_rgba(118,0,255,0.2)] backdrop-blur"
        role="main"
        aria-labelledby="signin-heading"
      >
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600/70 via-purple-500/70 to-fuchsia-500/80">
            <Image
              src="/logo.svg"
              alt="logo"
              width={28}
              height={28}
              priority
            />
          </div>
          <h1
            id="signin-heading"
            className="text-2xl font-extrabold uppercase tracking-[0.22em]"
          >
            StudyMate
          </h1>
        </div>

        {switchRequested && isSignedIn ? (
          <div className="mb-4 rounded-2xl border border-fuchsia-500/30 bg-fuchsia-500/10 px-4 py-3 text-sm text-fuchsia-50">
            <p className="font-semibold">
              {SWITCH_ACCOUNT_DISABLED_NOTICE.title}
            </p>
            <p className="mt-1 text-fuchsia-100/80">
              {SWITCH_ACCOUNT_DISABLED_NOTICE.description}
            </p>
          </div>
        ) : null}

        {isSignedIn ? (
          <div className="space-y-3 text-center">
            <Link
              href={callbackUrl}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-[#8b5cf6] via-[#a855f7] to-[#ec4899] px-6 py-3 text-base font-semibold shadow-[0_18px_35px_rgba(138,92,246,0.35)] transition hover:shadow-[0_25px_50px_rgba(138,92,246,0.45)]"
            >
              Go to dashboard
            </Link>
            <Link
              href="/api/auth/signout?callbackUrl=/signin"
              className="inline-flex w-full items-center justify-center rounded-2xl border border-white/15 px-6 py-3 text-sm font-medium text-white/90 transition hover:border-white/30 hover:text-white"
            >
              Sign out
            </Link>
          </div>
        ) : (
          <Suspense
            // EFFECT: Streams the static hero immediately while query-param parsing hydrates later.
            fallback={
              <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80" />
            }
          >
            <SignInInteractive
              defaultCallbackUrl="/dashboard"
              hintId={hintId}
              initialIsInAppBrowser={shouldContinueGate}
              initialIsRealBrowser={realBrowser}
            />
          </Suspense>
        )}

        <p id={hintId} className="mt-4 text-center text-sm text-neutral-300">
          {isSignedIn
            ? "You're already signed in. Use the dashboard shortcut above or sign out to switch accounts."
            : "Use Google, GitHub, or email and password to sign in. You'll be redirected back to your dashboard."}
        </p>
      </main>
    </div>
  );
}
