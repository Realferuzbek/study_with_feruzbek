// lib/csrf.js
// CommonJS version for Node.js test scripts (scripts/csrf.test.js)
// The TypeScript version (lib/csrf.ts) is used by Next.js/TypeScript imports
const { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } = require("./csrf-constants");

const TOKEN_BYTE_LENGTH = 32;
const HEX_TABLE = Array.from({ length: 256 }, (_, index) =>
  index.toString(16).padStart(2, "0"),
);
const textEncoder =
  typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

let nodeCrypto = null;
try {
  // Use 'crypto' instead of 'node:crypto' to avoid webpack errors
  nodeCrypto = require("crypto");
} catch {
  nodeCrypto = null;
}

function fillRandomBytes(target) {
  const globalCrypto =
    typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (globalCrypto && typeof globalCrypto.getRandomValues === "function") {
    return globalCrypto.getRandomValues(target);
  }
  if (nodeCrypto?.randomFillSync) {
    return nodeCrypto.randomFillSync(target);
  }
  if (nodeCrypto?.randomBytes) {
    const bytes = nodeCrypto.randomBytes(target.length);
    target.set(bytes);
    return target;
  }
  throw new Error(
    "Secure randomness source unavailable for CSRF token generation",
  );
}

function bytesToHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += HEX_TABLE[bytes[i]];
  }
  return out;
}

function stringToBytes(value) {
  if (textEncoder) return textEncoder.encode(value);
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    bytes[i] = value.charCodeAt(i) & 0xff;
  }
  return bytes;
}

// Generate a 32-byte (256-bit) CSRF token in hex
function generateCsrfToken() {
  const bytes = fillRandomBytes(new Uint8Array(TOKEN_BYTE_LENGTH));
  return bytesToHex(bytes);
}

// Backwards-compatible alias for newer imports.
function createCsrfToken() {
  return generateCsrfToken();
}

// Constant-time compare with best-effort use of timingSafeEqual when present
function safeEqual(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;

  if (nodeCrypto?.timingSafeEqual && typeof Buffer !== "undefined") {
    const A = Buffer.from(a);
    const B = Buffer.from(b);
    if (A.length !== B.length) return false;
    try {
      return nodeCrypto.timingSafeEqual(A, B);
    } catch {
      // fall through to manual constant-time comparison
    }
  }

  const aBytes = stringToBytes(a);
  const bBytes = stringToBytes(b);
  if (aBytes.length !== bBytes.length) return false;

  let mismatch = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    mismatch |= aBytes[i] ^ bBytes[i];
  }
  return mismatch === 0;
}

module.exports = {
  createCsrfToken,
  generateCsrfToken,
  safeEqual,
  CSRF_COOKIE_NAME,
  CSRF_HEADER: CSRF_HEADER_NAME,
};
