"use client";

import { useMemo, useState, useCallback, useEffect, type FormEvent } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { csrfFetch } from "@/lib/csrf-client";
import {
  resolveSignInError,
  sanitizeCallbackPath,
  SWITCH_ACCOUNT_DISABLED_NOTICE,
} from "@/lib/signin-messages";
import { buildExternalSigninUrl, isTelegramWebView } from "@/lib/inapp-browser";

const SWITCH_ACCOUNT_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_SWITCH_ACCOUNT === "1";
const LAST_USED_KEY = "last_used_auth";
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type LastUsedAuth = "google" | "github" | "email";

type SignInInteractiveProps = {
  defaultCallbackUrl: string;
  hintId: string;
  initialIsTelegramWebView?: boolean;
};

export default function SignInInteractive({
  defaultCallbackUrl,
  hintId,
  initialIsTelegramWebView,
}: SignInInteractiveProps) {
  const params = useSearchParams();
  const router = useRouter();
  const [redirectingProvider, setRedirectingProvider] = useState<
    "google" | "github" | null
  >(null);
  const [externalUrl, setExternalUrl] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [openBlocked, setOpenBlocked] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [telegramWebView, setTelegramWebView] = useState(
    () => initialIsTelegramWebView ?? false,
  );
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [lastUsedAuth, setLastUsedAuth] = useState<LastUsedAuth | null>(null);

  const switchRequested = params.get("switch") === "1";
  const switchMode = SWITCH_ACCOUNT_ENABLED && switchRequested;

  const errorCode = params.get("error");
  const blockedValues = params.getAll("blocked");
  const blockedParam =
    blockedValues.find((value) => value != null) ?? params.get("blocked");

  const errorMessage = useMemo(
    () => resolveSignInError(errorCode ?? undefined),
    [errorCode],
  );
  const blockedMessage = useMemo(() => {
    if (!blockedParam) return null;
    return blockedParam === "1"
      ? {
          title: "Account temporarily locked",
          description:
            "Your account was blocked by an administrator. Please contact support if you believe this is a mistake.",
        }
      : null;
  }, [blockedParam]);

  const callbackUrl = useMemo(() => {
    const callbackCandidates = params.getAll("callbackUrl");
    const callback =
      callbackCandidates.find((value) => value != null) ??
      params.get("callbackUrl");
    return sanitizeCallbackPath(callback) ?? defaultCallbackUrl;
  }, [params, defaultCallbackUrl]);

  const srcFromTelegram = useMemo(() => {
    const values = params.getAll("src");
    if (values.some((value) => value?.toLowerCase() === "telegram")) {
      return true;
    }
    const single = params.get("src");
    return single?.toLowerCase() === "telegram";
  }, [params]);

  const alertId = errorMessage ? "signin-error" : undefined;
  const blockedAlertId = blockedMessage ? "signin-blocked" : undefined;
  const switchAlertId = !switchMode && switchRequested ? "signin-switch" : undefined;
  const formAlertId = formError ? "signin-form-error" : undefined;
  const describedBy =
    [hintId, alertId, blockedAlertId, switchAlertId, formAlertId]
      .filter(Boolean)
      .join(" ") || undefined;

  const updateLastUsed = useCallback((value: LastUsedAuth) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LAST_USED_KEY, value);
    }
    setLastUsedAuth(value);
  }, []);

  const handleGoogleClick = useCallback(() => {
    if (redirectingProvider || formSubmitting || telegramWebView) return;
    updateLastUsed("google");
    setRedirectingProvider("google");
    signIn(
      "google",
      { callbackUrl, redirect: true },
      { prompt: "select_account" },
    ).catch((error) => {
      console.error("[signin] failed to start Google OAuth", error);
      setRedirectingProvider(null);
    });
  }, [
    callbackUrl,
    formSubmitting,
    redirectingProvider,
    telegramWebView,
    updateLastUsed,
  ]);

  const handleGitHubClick = useCallback(() => {
    if (redirectingProvider || formSubmitting || telegramWebView) return;
    updateLastUsed("github");
    setRedirectingProvider("github");
    signIn("github", { callbackUrl, redirect: true }).catch((error) => {
      console.error("[signin] failed to start GitHub OAuth", error);
      setRedirectingProvider(null);
    });
  }, [
    callbackUrl,
    formSubmitting,
    redirectingProvider,
    telegramWebView,
    updateLastUsed,
  ]);

  const handleCredentialsSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (formSubmitting || redirectingProvider || telegramWebView) return;
      setFormError(null);

      const trimmedEmail = email.trim().toLowerCase();
      if (!trimmedEmail || !EMAIL_REGEX.test(trimmedEmail)) {
        setFormError("Enter a valid email.");
        return;
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        setFormError(
          `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        );
        return;
      }
      if (mode === "register" && password !== confirmPassword) {
        setFormError("Passwords do not match.");
        return;
      }

      setFormSubmitting(true);

      try {
        if (mode === "register") {
          const response = await csrfFetch("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: trimmedEmail,
              password,
              confirmPassword,
            }),
          });

          if (!response.ok) {
            const data = await response.json().catch(() => null);
            const message =
              typeof data?.error === "string"
                ? data.error
                : "Unable to create account";
            setFormError(message);
            return;
          }
        }

        const result = await signIn("credentials", {
          redirect: false,
          email: trimmedEmail,
          password,
          callbackUrl,
        });

        if (result?.ok) {
          updateLastUsed("email");
          router.push(result.url ?? callbackUrl);
          return;
        }

        setFormError(
          mode === "register"
            ? "Unable to sign in after registration."
            : "Invalid credentials",
        );
      } catch (error) {
        console.error("[signin] credentials auth failed", error);
        setFormError(
          mode === "register"
            ? "Unable to sign in after registration."
            : "Unable to sign in.",
        );
      } finally {
        setFormSubmitting(false);
      }
    },
    [
      callbackUrl,
      confirmPassword,
      email,
      formSubmitting,
      mode,
      password,
      redirectingProvider,
      router,
      telegramWebView,
      updateLastUsed,
    ],
  );

  const handleExternalBrowserClick = useCallback(() => {
    if (typeof window === "undefined") return;
    const targetUrl =
      externalUrl ?? buildExternalSigninUrl(window.location.href);
    setFallbackUrl(targetUrl);

    if (telegramWebView && isAndroid) {
      const intentUrl = buildAndroidIntentUrl(targetUrl);
      if (intentUrl) {
        try {
          window.location.href = intentUrl;
        } catch {
          // Ignore intent errors and fall back to window.open.
        }
      }
    }

    const opened = window.open(targetUrl, "_blank", "noopener,noreferrer");
    setOpenBlocked(!opened);
  }, [externalUrl, isAndroid, telegramWebView]);

  useEffect(() => {
    if (switchMode && !redirectingProvider && !telegramWebView) {
      handleGoogleClick();
    }
  }, [handleGoogleClick, redirectingProvider, switchMode, telegramWebView]);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setTelegramWebView(isTelegramWebView(navigator.userAgent));
    setIsAndroid(/android/i.test(navigator.userAgent));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setExternalUrl(buildExternalSigninUrl(window.location.href));
  }, [params]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(LAST_USED_KEY);
    if (stored === "google" || stored === "github" || stored === "email") {
      setLastUsedAuth(stored);
    }
  }, []);

  const idleLabel = switchMode
    ? "Switch account with Google"
    : "Continue with Google";
  const redirectLabel = switchMode ? "Switching..." : "Redirecting...";
  const srStatus = switchMode
    ? "Switching accounts through Google..."
    : "Redirecting to Google...";
  const googleBusy = redirectingProvider === "google";
  const githubBusy = redirectingProvider === "github";

  const submitLabel = mode === "login" ? "Sign in" : "Create account";
  const toggleLabel =
    mode === "login" ? "Don't have an account?" : "Already have an account?";
  const toggleAction = mode === "login" ? "Register here" : "Sign in";

  const renderLastUsedBadge = (value: LastUsedAuth) =>
    lastUsedAuth === value ? (
      <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">
        Last used
      </span>
    ) : null;

  const telegramHelperId = "signin-telegram-helper";

  if (telegramWebView) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={handleExternalBrowserClick}
          aria-describedby={telegramHelperId}
          className="relative inline-flex h-12 min-h-[48px] w-full items-center justify-center rounded-2xl bg-[linear-gradient(120deg,#7c3aed,#8b5cf6,#a855f7,#ec4899)] px-6 text-sm font-semibold text-white shadow-[0_20px_40px_rgba(123,58,237,0.35)] transition-transform duration-200 hover:scale-[1.01] focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
        >
          Continue in Browser
        </button>
        <p id={telegramHelperId} className="text-sm text-neutral-300">
          Telegram&apos;s in-app browser may ask for email again. Continue in
          browser for quickest sign-in.
        </p>
        {openBlocked && fallbackUrl ? (
          <p className="text-sm text-neutral-400">
            <a
              href={fallbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white underline decoration-white/60 underline-offset-4 transition hover:text-white/90"
            >
              Open in browser
            </a>
          </p>
        ) : null}
        {openBlocked ? (
          <p className="text-sm text-neutral-400">
            Tap the menu and choose Open in browser.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {blockedMessage ? (
        <div
          id={blockedAlertId}
          role="alert"
          aria-live="assertive"
          className="mb-4 rounded-2xl border border-yellow-500/40 bg-yellow-500/5 px-4 py-3 text-sm text-yellow-50"
        >
          <p className="font-semibold">{blockedMessage.title}</p>
          <p className="mt-1 text-yellow-100/80">
            {blockedMessage.description}
          </p>
        </div>
      ) : null}

      {errorMessage ? (
        <div
          id={alertId}
          role="alert"
          aria-live="polite"
          className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100"
        >
          <p className="font-semibold">{errorMessage.title}</p>
          <p className="mt-1 text-red-50/80">{errorMessage.description}</p>
        </div>
      ) : null}

      {!switchMode && switchRequested ? (
        <div
          id={switchAlertId}
          role="status"
          aria-live="polite"
          className="mb-4 rounded-2xl border border-fuchsia-500/30 bg-fuchsia-500/10 px-4 py-3 text-sm text-fuchsia-100"
        >
          <p className="font-semibold">
            {SWITCH_ACCOUNT_DISABLED_NOTICE.title}
          </p>
          <p className="mt-1 text-fuchsia-100/80">
            {SWITCH_ACCOUNT_DISABLED_NOTICE.description}
          </p>
        </div>
      ) : null}

      {srcFromTelegram ? (
        <p className="mb-3 text-sm text-emerald-200">
          You&apos;re in browser ✅
        </p>
      ) : null}

      <form
        onSubmit={handleCredentialsSubmit}
        aria-describedby={describedBy}
        className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-4"
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-neutral-200">
            Email and password
          </p>
          {renderLastUsedBadge("email")}
        </div>

        <div className="space-y-3">
          <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">
            Email
            <input
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (formError) setFormError(null);
              }}
              disabled={formSubmitting}
              className="h-12 w-full rounded-2xl border border-white/10 bg-neutral-950/40 px-4 text-sm font-medium normal-case text-white placeholder:text-neutral-500 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition focus:border-fuchsia-400/60 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/30"
              placeholder="you@example.com"
              required
            />
          </label>

          <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">
            Password
            <input
              type="password"
              name="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (formError) setFormError(null);
              }}
              disabled={formSubmitting}
              className="h-12 w-full rounded-2xl border border-white/10 bg-neutral-950/40 px-4 text-sm font-medium normal-case text-white placeholder:text-neutral-500 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition focus:border-fuchsia-400/60 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/30"
              placeholder={
                mode === "register" ? "Create a password" : "Enter your password"
              }
              required
            />
          </label>

          {mode === "register" ? (
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">
              Confirm password
              <input
                type="password"
                name="confirmPassword"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  if (formError) setFormError(null);
                }}
                disabled={formSubmitting}
                className="h-12 w-full rounded-2xl border border-white/10 bg-neutral-950/40 px-4 text-sm font-medium normal-case text-white placeholder:text-neutral-500 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition focus:border-fuchsia-400/60 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/30"
                placeholder="Repeat your password"
                required
              />
            </label>
          ) : null}
        </div>

        {formError ? (
          <div
            id={formAlertId}
            role="alert"
            aria-live="polite"
            className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100"
          >
            {formError}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={formSubmitting || !!redirectingProvider}
          aria-busy={formSubmitting}
          className="relative inline-flex h-12 min-h-[48px] w-full items-center justify-center rounded-2xl bg-[linear-gradient(120deg,#7c3aed,#8b5cf6,#a855f7,#ec4899)] px-6 text-sm font-semibold text-white shadow-[0_20px_40px_rgba(123,58,237,0.35)] transition-transform duration-200 hover:scale-[1.01] focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-75"
        >
          {formSubmitting ? "Working..." : submitLabel}
        </button>

        <p className="text-center text-sm text-neutral-300">
          {toggleLabel}{" "}
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setConfirmPassword("");
              setMode((prev) => (prev === "login" ? "register" : "login"));
            }}
            className="font-semibold text-white underline decoration-white/60 underline-offset-4 transition hover:text-white/90"
          >
            {toggleAction}
          </button>
        </p>
      </form>

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-white/10" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-neutral-400">
          or continue with
        </span>
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <div className="space-y-3">
        <button
          type="button"
          onClick={handleGoogleClick}
          disabled={!!redirectingProvider || formSubmitting}
          aria-busy={googleBusy}
          aria-describedby={describedBy}
          className="relative inline-flex h-12 min-h-[48px] w-full items-center justify-center rounded-2xl border border-white/10 bg-neutral-950/40 px-6 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(0,0,0,0.35)] transition hover:border-white/25 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-70"
        >
          <span role="status" aria-live="polite" className="sr-only">
            {googleBusy ? srStatus : ""}
          </span>
          <span className="flex w-full items-center justify-between gap-3">
            <span>{googleBusy ? redirectLabel : idleLabel}</span>
            {renderLastUsedBadge("google")}
          </span>
        </button>

        <button
          type="button"
          onClick={handleGitHubClick}
          disabled={!!redirectingProvider || formSubmitting}
          aria-busy={githubBusy}
          aria-describedby={describedBy}
          className="relative inline-flex h-12 min-h-[48px] w-full items-center justify-center rounded-2xl border border-white/10 bg-neutral-950/40 px-6 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(0,0,0,0.35)] transition hover:border-white/25 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-70"
        >
          <span className="flex w-full items-center justify-between gap-3">
            <span>{githubBusy ? "Redirecting..." : "Continue with GitHub"}</span>
            {renderLastUsedBadge("github")}
          </span>
        </button>
      </div>
    </>
  );
}

function buildAndroidIntentUrl(targetUrl: string): string | null {
  try {
    const url = new URL(targetUrl);
    const isLocalhost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1";
    const scheme = isLocalhost ? "http" : "https";
    return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${scheme};end`;
  } catch {
    return null;
  }
}
