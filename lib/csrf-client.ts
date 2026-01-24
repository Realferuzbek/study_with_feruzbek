import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "./csrf-constants";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function getCookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  const encodedName = `${name}=`;
  const cookies = document.cookie ? document.cookie.split("; ") : [];
  for (const cookie of cookies) {
    if (cookie.startsWith(encodedName)) {
      return decodeURIComponent(cookie.slice(encodedName.length));
    }
  }
  return null;
}

export function getCsrfToken(): string | null {
  return getCookieValue(CSRF_COOKIE_NAME);
}

function shouldAttachToUrl(url: URL | null): boolean {
  if (typeof window === "undefined" || !url) return false;
  try {
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}

function resolveUrl(input: RequestInfo | URL): URL | null {
  if (typeof window === "undefined") return null;
  try {
    if (typeof input === "string") {
      return new URL(input, window.location.origin);
    }
    if (input instanceof URL) {
      return input;
    }
    if (typeof Request !== "undefined" && input instanceof Request) {
      return new URL(input.url, window.location.origin);
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeHeaders(existing: HeadersInit | undefined): Headers {
  if (existing instanceof Headers) return new Headers(existing);
  return new Headers(existing);
}

function needsCsrfHeader(method?: string): boolean {
  if (!method) return false;
  return STATE_CHANGING_METHODS.has(method.toUpperCase());
}

export function csrfFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  if (typeof window === "undefined") {
    return fetch(input, init);
  }

  const method = (
    init.method ??
    (typeof Request !== "undefined" && input instanceof Request
      ? input.method
      : "GET")
  )?.toUpperCase();
  const url = resolveUrl(input);

  if (!needsCsrfHeader(method) || !shouldAttachToUrl(url)) {
    return fetch(input, init);
  }

  const token = getCsrfToken();
  if (!token) {
    return fetch(input, init);
  }

  const headers = normalizeHeaders(init.headers);
  if (!headers.has(CSRF_HEADER_NAME)) {
    headers.set(CSRF_HEADER_NAME, token);
  }

  const mergedInit: RequestInit = { ...init, headers };
  if (!mergedInit.credentials) {
    mergedInit.credentials = "same-origin";
  }
  return fetch(input, mergedInit);
}

export function requireCsrfHeader(init: RequestInit = {}): RequestInit {
  if (typeof window === "undefined") return init;
  const token = getCsrfToken();
  if (!token) return init;
  const headers = normalizeHeaders(init.headers);
  if (!headers.has(CSRF_HEADER_NAME)) {
    headers.set(CSRF_HEADER_NAME, token);
  }
  return { ...init, headers };
}
