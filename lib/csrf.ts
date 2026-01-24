// lib/csrf.ts
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "./csrf-constants";

const TOKEN_BYTE_LENGTH = 32;
const HEX_TABLE = Array.from({ length: 256 }, (_, index) =>
  index.toString(16).padStart(2, "0"),
);
const textEncoder =
  typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

function fillRandomBytes(target: Uint8Array): Uint8Array {
  const globalCrypto =
    typeof globalThis !== "undefined" ? globalThis.crypto : null;
  if (globalCrypto && typeof globalCrypto.getRandomValues === "function") {
    return globalCrypto.getRandomValues(target);
  }
  throw new Error(
    "Secure randomness source unavailable for CSRF token generation",
  );
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += HEX_TABLE[bytes[i]];
  }
  return out;
}

function stringToBytes(value: string): Uint8Array {
  if (textEncoder) return textEncoder.encode(value);
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    bytes[i] = value.charCodeAt(i) & 0xff;
  }
  return bytes;
}

// Generate a 32-byte (256-bit) CSRF token in hex
export function generateCsrfToken(): string {
  const bytes = fillRandomBytes(new Uint8Array(TOKEN_BYTE_LENGTH));
  return bytesToHex(bytes);
}

// Backwards-compatible alias for newer imports.
export function createCsrfToken(): string {
  return generateCsrfToken();
}

// Constant-time compare without leaking timing information
export function safeEqual(
  a: string | undefined,
  b: string | undefined,
): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;

  const aBytes = stringToBytes(a);
  const bBytes = stringToBytes(b);
  if (aBytes.length !== bBytes.length) return false;

  let mismatch = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    mismatch |= aBytes[i] ^ bBytes[i];
  }
  return mismatch === 0;
}

// Named exports are already declared above; no default export.
export { CSRF_COOKIE_NAME, CSRF_HEADER_NAME as CSRF_HEADER };
