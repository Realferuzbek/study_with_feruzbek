const assert = require("assert");
const { loadTsModule } = require("./test-helpers/load-ts");

const {
  requiresCsrfProtection,
  validateCsrfTokens,
  buildCsrfCookieOptions,
  buildSessionCookieOptions,
} = loadTsModule("lib/csrf-guard.ts");

(function testRequiresCsrfProtection() {
  assert.strictEqual(
    requiresCsrfProtection("POST", "/api/private"),
    true,
    "POST requests must require CSRF protection",
  );
  assert.strictEqual(
    requiresCsrfProtection("GET", "/api/private"),
    false,
    "GET requests should not trigger CSRF protection",
  );
  assert.strictEqual(
    requiresCsrfProtection("POST", "/api/telegram/webhook"),
    false,
    "Webhook routes are exempt from double-submit CSRF",
  );
})();

(function testValidateCsrfTokensSuccess() {
  const token = "a".repeat(64);
  const result = validateCsrfTokens({
    cookieToken: token,
    headerToken: token,
    originHeader: "https://app.local",
    refererHeader: "https://app.local/page",
    expectedOrigin: "https://app.local",
  });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.reasons, []);
})();

(function testValidateCsrfTokensFailures() {
  const token = "b".repeat(64);
  const missingCookie = validateCsrfTokens({
    headerToken: token,
    originHeader: "https://app.local",
    refererHeader: "https://app.local/dash",
    expectedOrigin: "https://app.local",
  });
  assert.strictEqual(missingCookie.ok, false);
  assert(missingCookie.reasons.includes("missing_cookie"));

  const mismatch = validateCsrfTokens({
    cookieToken: token,
    headerToken: "c".repeat(64),
    originHeader: "https://app.local",
    refererHeader: "https://app.local/dash",
    expectedOrigin: "https://app.local",
  });
  assert.strictEqual(mismatch.ok, false);
  assert(mismatch.reasons.includes("token_mismatch"));

  const originMismatch = validateCsrfTokens({
    cookieToken: token,
    headerToken: token,
    originHeader: "https://attacker.example",
    refererHeader: null,
    expectedOrigin: "https://app.local",
  });
  assert.strictEqual(originMismatch.ok, false);
  assert(originMismatch.reasons.includes("origin_mismatch"));
})();

(function testCookieOptions() {
  const secureOptions = buildCsrfCookieOptions({ isSecureTransport: true });
  assert.strictEqual(secureOptions.httpOnly, false);
  assert.strictEqual(secureOptions.sameSite, "lax");
  assert.strictEqual(secureOptions.secure, true);
  assert.strictEqual(secureOptions.path, "/");

  const devOptions = buildCsrfCookieOptions({ isSecureTransport: false });
  assert.strictEqual(devOptions.secure, false);

  const sessionSecure = buildSessionCookieOptions({ isSecureTransport: true });
  assert.strictEqual(sessionSecure.httpOnly, true);
  assert.strictEqual(sessionSecure.secure, true);

  const sessionDev = buildSessionCookieOptions({ isSecureTransport: false });
  assert.strictEqual(sessionDev.secure, false);
})();

console.log("csrf-guard tests passed");
process.exit(0);
