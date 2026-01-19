export function isTelegramWebView(ua?: string): boolean {
  if (typeof ua !== "string" || ua.length === 0) return false;
  return /telegram/i.test(ua);
}

const TELEGRAM_INAPP_PARAM = "inapp";
const TELEGRAM_INAPP_VALUE = "telegram";

export function isTelegramInAppParam(value?: string | null): boolean {
  return (value ?? "").toLowerCase() === TELEGRAM_INAPP_VALUE;
}

function isRelativePath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

function stripTelegramInAppFromCallback(value: string): string {
  if (!isRelativePath(value)) return value;
  try {
    const callbackUrl = new URL(value, "https://example.com");
    const inappValues = callbackUrl.searchParams.getAll(TELEGRAM_INAPP_PARAM);
    if (inappValues.some(isTelegramInAppParam)) {
      callbackUrl.searchParams.delete(TELEGRAM_INAPP_PARAM);
    }
    return callbackUrl.pathname + callbackUrl.search;
  } catch {
    return value;
  }
}

export function buildExternalSigninUrl(currentUrl: string): string {
  try {
    const url = new URL(currentUrl);
    url.pathname = "/signin";
    url.hash = "";
    url.searchParams.set("src", "telegram");
    const inappValues = url.searchParams.getAll(TELEGRAM_INAPP_PARAM);
    if (inappValues.some(isTelegramInAppParam)) {
      url.searchParams.delete(TELEGRAM_INAPP_PARAM);
    }
    const callbackValues = url.searchParams.getAll("callbackUrl");
    if (callbackValues.length > 0) {
      const cleanedValues = callbackValues.map(stripTelegramInAppFromCallback);
      if (
        cleanedValues.some((value, index) => value !== callbackValues[index])
      ) {
        url.searchParams.delete("callbackUrl");
        for (const value of cleanedValues) {
          url.searchParams.append("callbackUrl", value);
        }
      }
    }
    return url.toString();
  } catch {
    return "/signin?src=telegram";
  }
}
