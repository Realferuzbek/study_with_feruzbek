export const dynamic = "force-dynamic";

import Image from "next/image";
import ContinueInBrowserButton from "@/components/ContinueInBrowserButton";
import { stripTelegramInAppFromCallback } from "@/lib/inapp-browser";
import { sanitizeCallbackPath } from "@/lib/signin-messages";

type ContinuePageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function resolveCallbackUrl(
  searchParams?: Record<string, string | string[] | undefined>,
): string {
  if (!searchParams) return "/";
  const raw = searchParams.callbackUrl;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return "/";
  const cleaned = stripTelegramInAppFromCallback(value);
  return sanitizeCallbackPath(cleaned) ?? "/";
}

export default function ContinuePage({ searchParams }: ContinuePageProps) {
  const callbackUrl = resolveCallbackUrl(searchParams);

  return (
    <div className="min-h-screen grid place-items-center bg-neutral-950 text-white">
      <main
        className="w-[520px] max-w-[92vw] rounded-3xl bg-neutral-900/70 px-8 pb-10 pt-9 shadow-[0_0_120px_40px_rgba(118,0,255,0.2)] backdrop-blur"
        role="main"
        aria-labelledby="continue-heading"
      >
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600/70 via-purple-500/70 to-fuchsia-500/80">
            <Image src="/logo.svg" alt="StudyMate" width={28} height={28} />
          </div>
          <h1
            id="continue-heading"
            className="text-2xl font-extrabold uppercase tracking-[0.22em]"
          >
            StudyMate
          </h1>
        </div>

        <p className="mb-6 text-center text-sm text-neutral-300">
          Please continue in your browser
        </p>

        <ContinueInBrowserButton callbackUrl={callbackUrl} />
      </main>
    </div>
  );
}
