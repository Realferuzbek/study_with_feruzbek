export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { CSRF_COOKIE_NAME } from "@/lib/csrf-constants";
import { createCsrfToken } from "@/lib/csrf";
import { buildCsrfCookieOptions } from "@/lib/csrf-guard";

function resolveSecurityContext(req: NextRequest) {
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const protocol = req.nextUrl.protocol;
  const isHttps =
    forwardedProto === "https" || protocol === "https" || protocol === "https:";
  const allowIframe = process.env.ALLOW_IFRAME === "true";
  return { isSecureTransport: isHttps, allowIframe };
}

export async function GET(req: NextRequest) {
  const existing = req.cookies.get(CSRF_COOKIE_NAME)?.value;
  if (existing) {
    return NextResponse.json({ csrfToken: existing });
  }

  const csrfToken = createCsrfToken();
  const response = NextResponse.json({ csrfToken });
  const securityContext = resolveSecurityContext(req);
  response.cookies.set(
    CSRF_COOKIE_NAME,
    csrfToken,
    buildCsrfCookieOptions(securityContext),
  );
  return response;
}
