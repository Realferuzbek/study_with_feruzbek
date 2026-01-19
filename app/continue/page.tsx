export const dynamic = "force-dynamic";

import ContinueInBrowserButton from "@/components/ContinueInBrowserButton";
import { stripTelegramInAppFromCallback } from "@/lib/inapp-browser";
import { sanitizeCallbackPath } from "@/lib/signin-messages";

type ContinuePageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function resolveTargetPath(
  searchParams?: Record<string, string | string[] | undefined>,
): string {
  if (!searchParams) return "/signin";
  const raw = searchParams.to ?? searchParams.callbackUrl;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return "/signin";
  const cleaned = stripTelegramInAppFromCallback(value);
  return sanitizeCallbackPath(cleaned) ?? "/signin";
}

export default function ContinuePage({ searchParams }: ContinuePageProps) {
  const targetPath = resolveTargetPath(searchParams);

  return (
    <div className="min-h-screen grid place-items-center bg-neutral-950 text-white">
      <main className="w-[420px] max-w-[92vw]" role="main">
        <ContinueInBrowserButton targetPath={targetPath} />
      </main>
    </div>
  );
}
