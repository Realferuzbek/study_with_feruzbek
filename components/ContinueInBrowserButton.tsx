"use client";

import { useCallback } from "react";
import {
  buildAndroidIntentUrl,
  buildContinueConfirmUrl,
} from "@/lib/inapp-browser";

type ContinueInBrowserButtonProps = {
  callbackUrl: string;
};

export default function ContinueInBrowserButton({
  callbackUrl,
}: ContinueInBrowserButtonProps) {
  const handleClick = useCallback(() => {
    if (typeof window === "undefined") return;
    const targetUrl = buildContinueConfirmUrl(window.location.href, callbackUrl);
    const isAndroid = /android/i.test(navigator.userAgent ?? "");

    if (isAndroid) {
      const chromeIntentUrl = buildAndroidIntentUrl(targetUrl, {
        chromePackage: true,
      });
      if (chromeIntentUrl) {
        try {
          window.location.href = chromeIntentUrl;
        } catch {
          const fallbackIntentUrl = buildAndroidIntentUrl(targetUrl);
          if (fallbackIntentUrl) {
            try {
              window.location.href = fallbackIntentUrl;
            } catch {
              // Ignore intent errors and fall back to window.open.
            }
          }
        }
      }
    }

    window.open(targetUrl, "_blank", "noopener,noreferrer");
  }, [callbackUrl]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="relative inline-flex h-12 min-h-[48px] w-full items-center justify-center rounded-2xl bg-[linear-gradient(120deg,#7c3aed,#8b5cf6,#a855f7,#ec4899)] px-6 text-sm font-semibold text-white shadow-[0_20px_40px_rgba(123,58,237,0.35)] transition-transform duration-200 hover:scale-[1.01] focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
    >
      Continue in Browser
    </button>
  );
}
