type SignInErrorMessage = {
  title: string;
  description: string;
};

const DEFAULT_MESSAGE: SignInErrorMessage = {
  title: "Sign-in failed",
  description:
    "We couldn't complete your sign-in. Please try again, and contact support if the issue continues.",
};

const MESSAGE_MAP: Record<string, SignInErrorMessage> = {
  SessionRequired: {
    title: "Session expired",
    description:
      "Your previous session ended. Please sign in again to continue.",
  },
  OAuthSignin: {
    title: "Provider sign-in unavailable",
    description:
      "We couldn't start the sign-in flow. Retry in a fresh tab or private window.",
  },
  OAuthCallback: {
    title: "Provider didn't finish signing you in",
    description:
      "Retry the sign-in. A private window often resolves this.",
  },
  OAuthAccountNotLinked: {
    title: "Use your original sign-in",
    description:
      "That account is already linked elsewhere. Sign in with the provider you originally used.",
  },
  EmailSignin: {
    title: "Email sign-in disabled",
    description:
      "Email links are unavailable. Use another sign-in option instead.",
  },
  CredentialsSignin: {
    title: "Invalid credentials",
    description: "Check your email and password, then try again.",
  },
  EmailNotVerified: {
    title: "Email not verified",
    description: "Please verify your email first, then sign in again.",
  },
  AccessDenied: {
    title: "Access denied",
    description:
      "We couldn't validate your access. Retry or contact support if this persists.",
  },
};

export const SWITCH_ACCOUNT_DISABLED_NOTICE: SignInErrorMessage = {
  title: "Switch account temporarily unavailable",
  description:
    "Switching Google accounts is disabled right now. Sign out of your current account first to use a different one.",
};

export function resolveSignInError(
  errorCode?: string | null,
): SignInErrorMessage | null {
  if (!errorCode) return null;
  return MESSAGE_MAP[errorCode] ?? DEFAULT_MESSAGE;
}

export function sanitizeCallbackPath(
  value: string | string[] | null | undefined,
): string | undefined {
  if (!value) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed !== raw) return undefined;
  if (!trimmed.startsWith("/")) return undefined;
  if (trimmed.startsWith("//")) return undefined;
  if (
    trimmed.includes(" ") ||
    trimmed.includes("\\") ||
    trimmed.includes("\n")
  ) {
    return undefined;
  }
  if (trimmed.includes("://")) return undefined;
  return trimmed;
}

export type { SignInErrorMessage };
