import type { MiddlewareHandler } from "hono";
import type { AppVariables, Env } from "../types";

/**
 * Security headers configuration
 */
interface SecurityHeadersConfig {
  /** Allowed CORS origins, matched exactly (no wildcards) */
  corsOrigins?: string[];
  /** Allow credentials in CORS requests */
  corsCredentials?: boolean;
  /** Content Security Policy directives */
  contentSecurityPolicy?: string | false;
  /** Enable HSTS (HTTP Strict Transport Security) */
  enableHSTS?: boolean;
  /** HSTS max age in seconds (default: 2 years) */
  hstsMaxAge?: number;
}

/**
 * Default production-ready security configuration
 */
const swaggerCdnHost = "https://cdn.jsdelivr.net";
const googleFontsStylesHost = "https://fonts.googleapis.com";
const googleFontsAssetsHost = "https://fonts.gstatic.com";
const fontAwesomeCdnHost = "https://cdnjs.cloudflare.com";
const leafletCdnHost = "https://unpkg.com";
const openStreetMapHost = "https://www.openstreetmap.org";

const defaultConfig: Required<SecurityHeadersConfig> = {
  corsOrigins: [], // Empty array = no CORS allowed by default (must be explicitly configured)
  corsCredentials: false, // Browsers never send the session cookies cross-origin
  contentSecurityPolicy: [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${swaggerCdnHost}`,
    `style-src 'self' 'unsafe-inline' ${swaggerCdnHost} ${googleFontsStylesHost} ${fontAwesomeCdnHost} ${leafletCdnHost}`,
    "img-src 'self' data: https:",
    `font-src 'self' data: ${swaggerCdnHost} ${googleFontsAssetsHost} ${fontAwesomeCdnHost}`,
    "connect-src 'self'",
    `frame-src 'self' ${openStreetMapHost}`,
  ].join("; "),
  enableHSTS: true,
  hstsMaxAge: 63072000, // 2 years
};

/**
 * Whether `origin` is one of `allowedOrigins`, compared exactly. There is no
 * wildcard: `*` and `https://*.example` entries never match (see
 * {@link parseAllowedOrigins}, which drops them).
 */
export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return false;
  return allowedOrigins.some((allowed) => !allowed.includes("*") && origin === allowed);
}

/** Origins of the local dev stack (server, client): the fallback when ALLOWED_ORIGINS is unset in development. */
export const DEVELOPMENT_CORS_ORIGINS = ["http://localhost:8787", "http://localhost:4321"];

/**
 * The exact CORS origins in a comma-separated `ALLOWED_ORIGINS`. Entries that
 * are not a bare origin (`https://host[:port]`), including any wildcard, are
 * dropped with a warning. Unset or empty: none in public environments, the
 * local dev origins in development.
 */
export function parseAllowedOrigins(
  value: string | undefined,
  options: {
    isPublic: boolean;
    warn?: (message: string, details: Record<string, unknown>) => void;
  },
): string[] {
  const entries = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) return options.isPublic ? [] : [...DEVELOPMENT_CORS_ORIGINS];
  return entries.filter((entry) => {
    let valid = false;
    if (!entry.includes("*")) {
      try {
        valid = new URL(entry).origin === entry;
      } catch {
        valid = false;
      }
    }
    if (!valid)
      options.warn?.("Ignoring an ALLOWED_ORIGINS entry that is not an exact origin", { entry });
    return valid;
  });
}

/**
 * Security headers middleware
 *
 * Adds essential security headers including:
 * - CORS configuration
 * - Content Security Policy (CSP)
 * - X-Frame-Options (clickjacking protection)
 * - X-Content-Type-Options (MIME sniffing protection)
 * - Referrer-Policy
 * - Permissions-Policy
 * - HSTS (when enabled)
 *
 * @example
 * ```ts
 * app.use('*', securityHeaders({
 *   corsOrigins: ['https://www.toiletmap.org.uk'],
 *   corsCredentials: false,
 * }));
 * ```
 */
export const securityHeaders = (
  config: SecurityHeadersConfig = {},
): MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> => {
  const {
    corsOrigins = defaultConfig.corsOrigins,
    corsCredentials = defaultConfig.corsCredentials,
    contentSecurityPolicy = defaultConfig.contentSecurityPolicy,
    enableHSTS = defaultConfig.enableHSTS,
    hstsMaxAge = defaultConfig.hstsMaxAge,
  } = config;

  return async (c, next) => {
    // Handle CORS preflight requests
    if (c.req.method === "OPTIONS") {
      const origin = c.req.header("origin");

      if (origin && isOriginAllowed(origin, corsOrigins)) {
        c.header("Access-Control-Allow-Origin", origin);
        if (corsCredentials) {
          c.header("Access-Control-Allow-Credentials", "true");
        }
        c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
        c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
        c.header("Access-Control-Max-Age", "86400"); // 24 hours
      }

      return new Response(null, { status: 204, headers: c.res.headers });
    }

    // Set CORS headers for actual requests
    const origin = c.req.header("origin");
    if (corsOrigins.length > 0) {
      // The allowed origin is reflected per request, so any cache (browser or
      // shared) must key cacheable responses by Origin.
      c.header("Vary", "Origin", { append: true });
    }
    if (origin && isOriginAllowed(origin, corsOrigins)) {
      c.header("Access-Control-Allow-Origin", origin);
      if (corsCredentials) {
        c.header("Access-Control-Allow-Credentials", "true");
      }
      // ETag lets cross-origin consumers revalidate with If-None-Match.
      c.header(
        "Access-Control-Expose-Headers",
        "ETag, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset",
      );
    }

    // Security headers

    // Prevent clickjacking attacks
    c.header("X-Frame-Options", "DENY");

    // Prevent MIME type sniffing
    c.header("X-Content-Type-Options", "nosniff");

    // Control referrer information
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");

    // Disable dangerous browser features
    c.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");

    // Content Security Policy
    if (contentSecurityPolicy) {
      c.header("Content-Security-Policy", contentSecurityPolicy);
    }

    // HTTP Strict Transport Security (only on HTTPS)
    if (enableHSTS) {
      const protocol = c.req.header("x-forwarded-proto") || "http";
      if (protocol === "https") {
        c.header("Strict-Transport-Security", `max-age=${hstsMaxAge}; includeSubDomains; preload`);
      }
    }

    await next();
  };
};
