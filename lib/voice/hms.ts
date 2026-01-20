import "server-only";

import { createHmac, randomUUID } from "crypto";

type JwtPayload = Record<string, unknown>;

type JwtOptions = {
  secret: string;
  payload: JwtPayload;
};

const JWT_HEADER = { alg: "HS256", typ: "JWT" } as const;

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function signJwt({ secret, payload }: JwtOptions) {
  const header = base64UrlEncode(JSON.stringify(JWT_HEADER));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

function nowInSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function createHmsManagementToken(
  accessKey: string,
  secret: string,
  ttlSeconds = 300,
) {
  const now = nowInSeconds();
  const payload: JwtPayload = {
    access_key: accessKey,
    type: "management",
    version: 2,
    iat: now,
    nbf: now,
    exp: now + ttlSeconds,
    jti: randomUUID(),
  };
  return signJwt({ secret, payload });
}

export function createHmsAuthToken(params: {
  accessKey: string;
  secret: string;
  roomId: string;
  userId: string;
  role: "viewer" | "host" | "admin" | "peer";
  ttlSeconds?: number;
}) {
  const now = nowInSeconds();
  const ttlSeconds = params.ttlSeconds ?? 24 * 60 * 60;
  const payload: JwtPayload = {
    access_key: params.accessKey,
    room_id: params.roomId,
    user_id: params.userId,
    role: params.role,
    type: "app",
    version: 2,
    iat: now,
    nbf: now,
    exp: now + ttlSeconds,
    jti: randomUUID(),
  };
  return signJwt({ secret: params.secret, payload });
}

export function buildHmsRoomName(title: string, suffix?: string) {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 32);
  const seed = (suffix ?? randomUUID()).replace(/-/g, "").slice(0, 8);
  const name = base.length ? `${base}-${seed}` : `voice-room-${seed}`;
  return `voice-${name}`;
}
