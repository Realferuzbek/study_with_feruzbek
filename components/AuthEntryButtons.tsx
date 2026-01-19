"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { openAuthEntry } from "@/lib/auth-entry";

type AuthEntryButtonsProps = {
  callbackUrl: string;
  className?: string;
  size?: "sm" | "md";
};

export default function AuthEntryButtons({
  callbackUrl,
  className,
  size = "md",
}: AuthEntryButtonsProps) {
  const router = useRouter();
  const sizeClasses =
    size === "sm" ? "h-9 px-4 text-xs" : "h-11 px-6 text-sm";
  const secondarySizeClasses =
    size === "sm" ? "h-9 px-4 text-xs" : "h-11 px-5 text-sm";

  const handleSignIn = useCallback(() => {
    openAuthEntry("signin", callbackUrl, router);
  }, [callbackUrl, router]);

  const handleRegister = useCallback(() => {
    openAuthEntry("register", callbackUrl, router);
  }, [callbackUrl, router]);

  return (
    <div className={`flex items-center gap-3 ${className ?? ""}`.trim()}>
      <button
        type="button"
        onClick={handleSignIn}
        className={`btn-primary ${sizeClasses}`}
      >
        Sign in
      </button>
      <button
        type="button"
        onClick={handleRegister}
        className={`btn-secondary ${secondarySizeClasses}`}
      >
        Create account
      </button>
    </div>
  );
}
