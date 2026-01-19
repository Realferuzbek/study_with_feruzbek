// app/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import Image from "next/image";
import { headers } from "next/headers";
import { Suspense } from "react";
import { getCachedSession } from "@/lib/server-session";
import SignInInteractive from "@/components/SignInInteractive";
import { isTelegramInAppParam, isTelegramWebView } from "@/lib/inapp-browser";

type HomePageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

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

export default async function Home({ searchParams }: HomePageProps) {
  const session = await getCachedSession();
  const hintId = "home-auth-hint";
  const isSignedIn = !!session?.user;
  const isTelegram =
    isTelegramWebView(headers().get("user-agent") ?? undefined) ||
    isTelegramEntryParam(searchParams);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#07070b] px-6 text-white">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10">
          <Image
            src="/logo.svg"
            alt="StudyMate"
            width={40}
            height={40}
          />
        </div>
        <h1 className="mt-6 text-3xl font-semibold">StudyMate</h1>
        <p className="mt-2 text-sm font-medium uppercase tracking-[0.3em] text-fuchsia-300/70">
          Welcome back
        </p>

        <div className="mt-8 space-y-3">
          {isTelegram ? (
            <SignInInteractive
              defaultCallbackUrl="/dashboard"
              hintId={hintId}
              initialIsTelegramWebView={isTelegram}
            />
          ) : isSignedIn ? (
            <a
              href="/dashboard"
              aria-describedby={hintId}
              className="relative inline-flex h-12 min-h-[48px] w-full items-center justify-center rounded-2xl bg-[linear-gradient(120deg,#7c3aed,#8b5cf6,#a855f7,#ec4899)] px-6 text-sm font-semibold text-white shadow-[0_20px_40px_rgba(123,58,237,0.35)] transition-transform duration-200 hover:scale-[1.01] focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
            >
              Go to dashboard
            </a>
          ) : (
            <Suspense
              fallback={
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80" />
              }
            >
              <SignInInteractive
                defaultCallbackUrl="/dashboard"
                hintId={hintId}
                initialIsTelegramWebView={isTelegram}
              />
            </Suspense>
          )}
          {!isTelegram ? (
            <p id={hintId} className="text-sm text-zinc-400">
              {isSignedIn
                ? "You're already signed in. Head straight to your dashboard."
                : "We only support Google sign-in. You'll be redirected back to your dashboard."}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
