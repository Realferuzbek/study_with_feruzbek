export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createHmsAuthToken, createHmsManagementToken } from "@/lib/voice/hms";

type TokenRequest = {
  userId?: unknown;
  roomId?: unknown;
  roomCode?: unknown;
  role?: unknown;
};

type Role = "viewer" | "host" | "admin" | "peer";

const ROLE_VALUES: Role[] = ["viewer", "host", "admin", "peer"];
const DEFAULT_ROLE: Role = "viewer";
const DEFAULT_TTL_SECONDS = 300;

function readString(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function parseRole(value: unknown): Role | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return ROLE_VALUES.includes(normalized as Role)
    ? (normalized as Role)
    : null;
}

function nowInSeconds() {
  return Math.floor(Date.now() / 1000);
}

function parseExpiresIn(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }
  return null;
}

function decodeJwtPayload(token: string) {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(json);
    if (payload && typeof payload === "object") {
      return payload as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function expiresInFromToken(token: string, fallback: number) {
  const payload = decodeJwtPayload(token);
  const exp = typeof payload?.exp === "number" ? payload.exp : null;
  if (exp && Number.isFinite(exp)) {
    return Math.max(0, Math.floor(exp - nowInSeconds()));
  }
  return fallback;
}

async function exchangeRoomCodeToken(
  roomCode: string,
  managementToken: string,
) {
  const response = await fetch("https://auth.100ms.live/v2/token", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${managementToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code: roomCode }),
  });

  if (!response.ok) {
    console.error(
      "[100ms token] room code exchange failed",
      response.status,
    );
    return null;
  }

  const payload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) return null;

  const token =
    readString(payload.token) ||
    readString(payload.auth_token) ||
    readString(payload.authToken);
  if (!token) return null;

  const expiresIn =
    parseExpiresIn(payload.expires_in) ??
    parseExpiresIn(payload.expiresIn) ??
    expiresInFromToken(token, DEFAULT_TTL_SECONDS);

  return { token, expiresIn };
}

export async function POST(req: NextRequest) {
  let payload: TokenRequest = {};
  try {
    payload = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const userId = readString(payload.userId);
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const roomId = readString(payload.roomId);
  const roomCode = readString(payload.roomCode);
  if (!roomId && !roomCode) {
    return NextResponse.json(
      { error: "roomId or roomCode is required" },
      { status: 400 },
    );
  }

  const role = parseRole(payload.role) ?? DEFAULT_ROLE;

  const accessKey = process.env.HMS_APP_ACCESS_KEY;
  const secret = process.env.HMS_APP_SECRET;
  if (!accessKey || !secret) {
    return NextResponse.json(
      { error: "100ms credentials missing" },
      { status: 500 },
    );
  }

  if (roomId) {
    const token = createHmsAuthToken({
      accessKey,
      secret,
      roomId,
      userId,
      role,
      ttlSeconds: DEFAULT_TTL_SECONDS,
    });
    return NextResponse.json({ token, expiresIn: DEFAULT_TTL_SECONDS });
  }

  const managementToken = createHmsManagementToken(accessKey, secret);
  const roomCodeToken = await exchangeRoomCodeToken(
    roomCode,
    managementToken,
  );

  if (!roomCodeToken?.token) {
    return NextResponse.json(
      { error: "Failed to issue token for room code" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    token: roomCodeToken.token,
    expiresIn: roomCodeToken.expiresIn ?? DEFAULT_TTL_SECONDS,
  });
}
