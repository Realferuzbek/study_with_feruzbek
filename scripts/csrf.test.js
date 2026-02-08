// scripts/csrf.test.js
const assert = require("assert");
const { loadTsModule } = require("./test-helpers/load-ts");

const MODULE_PATH = "lib/csrf.ts";

function loadCsrf() {
  return loadTsModule(MODULE_PATH);
}

const { generateCsrfToken, safeEqual, CSRF_COOKIE_NAME, CSRF_HEADER } =
  loadCsrf();

// Constants
assert.strictEqual(
  typeof CSRF_COOKIE_NAME,
  "string",
  "CSRF cookie name should be a string",
);
assert.strictEqual(
  typeof CSRF_HEADER,
  "string",
  "CSRF header name should be a string",
);
assert(
  CSRF_HEADER.toLowerCase() === "x-csrf-token",
  "CSRF header must default to x-csrf-token",
);

// Token generation using runtime crypto
const t1 = generateCsrfToken();
const t2 = generateCsrfToken();
assert(
  typeof t1 === "string" && t1.length === 64,
  "token should be 64 hex chars",
);
assert(t1 !== t2, "tokens should be different");

// safeEqual
assert(safeEqual(t1, t1) === true, "safeEqual should match identical strings");
assert(
  safeEqual(t1, t2) === false,
  "safeEqual should not match different strings",
);
assert(safeEqual(undefined, t1) === false, "safeEqual handles undefined");

// Deterministic getRandomValues path
(function testDeterministicGetRandomValues() {
  const hasCrypto = typeof globalThis.crypto !== "undefined";
  const originalCrypto = hasCrypto ? globalThis.crypto : undefined;
  const originalGetRandomValues =
    hasCrypto && typeof originalCrypto.getRandomValues === "function"
      ? originalCrypto.getRandomValues
      : undefined;
  const stubValue = 0xab;

  const stubGetRandomValues = (target) => {
    const filled = target;
    for (let i = 0; i < filled.length; i += 1) {
      filled[i] = stubValue;
    }
    return filled;
  };

  if (hasCrypto) {
    globalThis.crypto.getRandomValues = stubGetRandomValues;
  } else {
    globalThis.crypto = { getRandomValues: stubGetRandomValues };
  }

  const { generateCsrfToken: deterministicGenerator } = loadCsrf();
  const deterministicToken = deterministicGenerator();
  assert.strictEqual(
    deterministicToken,
    "ab".repeat(32),
    "deterministic generator should honor custom getRandomValues",
  );

  if (!hasCrypto) {
    delete globalThis.crypto;
  } else {
    if (originalGetRandomValues) {
      globalThis.crypto.getRandomValues = originalGetRandomValues;
    } else {
      delete globalThis.crypto.getRandomValues;
    }
  }
  loadCsrf();
})();

console.log("csrf unit tests passed");
process.exit(0);
