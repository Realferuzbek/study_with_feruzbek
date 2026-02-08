function buildPermissionsPolicy(context = {}) {
  const mediaScope = context.allowMedia ? "(self)" : "()";
  return [
    "accelerometer=()",
    `camera=${mediaScope}`,
    `display-capture=${mediaScope}`,
    "geolocation=()",
    `microphone=${mediaScope}`,
    "payment=()",
    "usb=()",
    "bluetooth=()",
    "gyroscope=()",
    "magnetometer=()",
  ].join(", ");
}

const PERMISSIONS_POLICY = buildPermissionsPolicy();

const RAW_IFRAME_ANCESTORS = process.env.SECURITY_IFRAME_ANCESTORS || "";
const EXTRA_IFRAME_ANCESTORS = RAW_IFRAME_ANCESTORS.split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

const VALID_CORP_VALUES = new Set(["same-origin", "same-site", "cross-origin"]);
const RAW_IFRAME_CORP = (process.env.SECURITY_IFRAME_RESOURCE_POLICY || "")
  .trim()
  .toLowerCase();
const IFRAME_CORP_OVERRIDE = VALID_CORP_VALUES.has(RAW_IFRAME_CORP)
  ? RAW_IFRAME_CORP
  : null;

const ANALYTICS_HOSTS = [
  "https://vitals.vercel-insights.com",
  "https://vitals.vercel-analytics.com",
];

function buildScriptSources(context = {}) {
  const sources = new Set(["'self'", "'unsafe-inline'", "blob:"]);
  for (const host of ANALYTICS_HOSTS) sources.add(host);
  if (!context.isProduction) {
    sources.add("'unsafe-eval'");
  }
  return Array.from(sources);
}

function buildConnectSources(extraSources = []) {
  const sources = new Set(["'self'"]);
  for (const host of ANALYTICS_HOSTS) sources.add(host);
  if (Array.isArray(extraSources)) {
    for (const source of extraSources) {
      addSource(sources, source);
    }
  }
  return Array.from(sources);
}

function buildBaseDirectives(context = {}) {
  return [
    { name: "default-src", value: ["'self'"] },
    { name: "base-uri", value: ["'none'"] },
    { name: "object-src", value: ["'none'"] },
    { name: "frame-ancestors", value: ["'none'"] },
    { name: "form-action", value: ["'self'"] },
    { name: "img-src", value: ["'self'", "data:"] },
    { name: "font-src", value: ["'self'", "data:"] },
    { name: "script-src", value: buildScriptSources(context) },
    { name: "style-src", value: ["'self'", "'unsafe-inline'"] },
    { name: "connect-src", value: buildConnectSources(context.extraConnectSrc) },
    { name: "child-src", value: ["'self'"] },
    // Keep same-origin frames allowed across SPA navigations (timer embeds).
    { name: "frame-src", value: ["'self'"] },
    { name: "upgrade-insecure-requests" },
    { name: "block-all-mixed-content" },
  ];
}

const CSP_REPORT_ONLY = serializeDirectives(buildBaseDirectives());

// CSP enforces by default in production builds; set SECURITY_CSP_ENFORCE=0 to force report-only
// or SECURITY_CSP_ENFORCE=1 / { enforceCsp: true } to pin enforcement in any environment.
function buildContentSecurityPolicy(context = {}) {
  const directives = buildBaseDirectives(context);

  if (context.allowIframe) {
    setDirectiveValue(
      directives,
      "frame-src",
      buildFrameSources(context.allowedFrameSrc),
    );
    setDirectiveValue(
      directives,
      "frame-ancestors",
      buildFrameAncestors(context.allowedFrameAncestors),
    );
  }

  return serializeDirectives(directives);
}

function setDirectiveValue(directives, name, value) {
  const directive = directives.find((entry) => entry.name === name);
  if (!directive) return;
  directive.value = value;
}

function buildFrameSources(extraSources = []) {
  const sources = new Set(["'self'"]);
  if (Array.isArray(extraSources)) {
    for (const source of extraSources) {
      addSource(sources, source);
    }
  }
  return Array.from(sources);
}

function buildFrameAncestors(extraAncestors = []) {
  const sources = new Set(["'self'"]);
  for (const ancestor of EXTRA_IFRAME_ANCESTORS) {
    sources.add(ancestor);
  }
  if (Array.isArray(extraAncestors)) {
    for (const source of extraAncestors) {
      addSource(sources, source);
    }
  }
  return Array.from(sources);
}

function addSource(store, raw) {
  if (!raw || typeof raw !== "string") return;
  const trimmed = raw.trim();
  if (!trimmed) return;
  store.add(trimmed);
}

function serializeDirectives(directives) {
  return directives
    .map(({ name, value }) =>
      value && value.length > 0 ? `${name} ${value.join(" ")}` : name,
    )
    .join("; ");
}

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

const OPTIONAL_HEADERS = ["Strict-Transport-Security"];
const SECURITY_HEADERS_CACHE = new Map();
const SECURITY_HEADERS_CACHE_MAX_SIZE = 128;

function normalizeBoolean(value) {
  return value === true;
}

function normalizeSourceList(values) {
  if (!Array.isArray(values)) return "";
  const normalized = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    normalized.push(trimmed);
  }
  return normalized.join("\u001f");
}

function buildSecurityHeadersCacheKey(context = {}, enforceCsp) {
  return [
    normalizeBoolean(context.isProduction) ? "1" : "0",
    normalizeBoolean(context.isSecureTransport) ? "1" : "0",
    normalizeBoolean(context.allowIframe) ? "1" : "0",
    normalizeBoolean(context.allowMedia) ? "1" : "0",
    enforceCsp ? "1" : "0",
    normalizeSourceList(context.extraConnectSrc),
    normalizeSourceList(context.allowedFrameSrc),
    normalizeSourceList(context.allowedFrameAncestors),
  ].join("|");
}

function setCachedSecurityHeaders(cacheKey, headers) {
  if (SECURITY_HEADERS_CACHE.size >= SECURITY_HEADERS_CACHE_MAX_SIZE) {
    SECURITY_HEADERS_CACHE.clear();
  }
  SECURITY_HEADERS_CACHE.set(cacheKey, headers);
}

function resolveBooleanEnvFlag(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function shouldEnforceCsp(context = {}) {
  if (context.enforceCsp) return true;
  const explicit = resolveBooleanEnvFlag(process.env.SECURITY_CSP_ENFORCE);
  if (explicit !== null) return explicit;
  return process.env.NODE_ENV === "production";
}

/**
 * Builds the header key/value pairs.
 * @param {SecurityHeaderContext} [context]
 * @returns {Record<string, string>}
 */
function buildSecurityHeaders(context = {}) {
  const enforceCsp = shouldEnforceCsp(context);
  const cacheKey = buildSecurityHeadersCacheKey(context, enforceCsp);
  const cached = SECURITY_HEADERS_CACHE.get(cacheKey);
  if (cached) return cached;

  const headers = { ...BASE_HEADERS };
  headers["Permissions-Policy"] = buildPermissionsPolicy(context);
  const hstsValue = deriveStrictTransportSecurity(context);
  if (hstsValue) headers["Strict-Transport-Security"] = hstsValue;
  const csp = buildContentSecurityPolicy(context);

  if (context.allowIframe) {
    delete headers["X-Frame-Options"];
    if (IFRAME_CORP_OVERRIDE) {
      headers["Cross-Origin-Resource-Policy"] = IFRAME_CORP_OVERRIDE;
    }
  }

  if (csp) {
    const headerName = enforceCsp
      ? "Content-Security-Policy"
      : "Content-Security-Policy-Report-Only";
    headers[headerName] = csp;
    const alternate =
      headerName === "Content-Security-Policy"
        ? "Content-Security-Policy-Report-Only"
        : "Content-Security-Policy";
    delete headers[alternate];
  }
  setCachedSecurityHeaders(cacheKey, headers);
  return headers;
}

/**
 * Applies headers to the provided response instance.
 * @template {Response} T
 * @param {T} response
 * @param {SecurityHeaderContext} [context]
 * @returns {T}
 */
function applySecurityHeaders(response, context = {}) {
  if (!response || !response.headers) return response;
  const desired = buildSecurityHeaders(context);
  for (const [key, value] of Object.entries(desired)) {
    response.headers.set(key, value);
  }
  for (const header of OPTIONAL_HEADERS) {
    if (!(header in desired)) response.headers.delete(header);
  }
  if (context.allowIframe && !("X-Frame-Options" in desired)) {
    response.headers.delete("X-Frame-Options");
  }
  response.headers.delete("x-powered-by");
  response.headers.delete("server");
  return response;
}

/**
 * Computes the HSTS header value when allowed.
 * @param {SecurityHeaderContext} [context]
 * @returns {string | null}
 */
function deriveStrictTransportSecurity(context = {}) {
  if (!context.isProduction) return null;
  if (!context.isSecureTransport) return null;
  return "max-age=31536000; includeSubDomains";
}

module.exports = {
  applySecurityHeaders,
  buildSecurityHeaders,
  deriveStrictTransportSecurity,
  PERMISSIONS_POLICY,
  CSP_REPORT_ONLY,
};

/**
 * @typedef {Object} SecurityHeaderContext
 * @property {boolean} [isProduction]
 * @property {boolean} [isSecureTransport]
 * @property {boolean} [allowIframe] - Allow iframe embedding (for timer HTML files)
 * @property {string[]} [extraConnectSrc] - Extra connect-src hosts (for route-scoped real-time backends).
 * @property {boolean} [allowMedia] - Allow camera/microphone/display-capture in Permissions-Policy.
 */
