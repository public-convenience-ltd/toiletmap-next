import { MiddlewareHandler } from 'hono';
import { Env, AppVariables } from '../types';

/**
 * Security headers configuration
 */
interface SecurityHeadersConfig {
  /** Allowed CORS origins (use ['*'] for public APIs, but specify origins for production) */
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
const swaggerCdnHost = 'https://cdn.jsdelivr.net';
const googleFontsStylesHost = 'https://fonts.googleapis.com';
const googleFontsAssetsHost = 'https://fonts.gstatic.com';
const fontAwesomeCdnHost = 'https://cdnjs.cloudflare.com';
const leafletCdnHost = 'https://unpkg.com';
const openStreetMapHost = 'https://www.openstreetmap.org';

const defaultConfig: Required<SecurityHeadersConfig> = {
  corsOrigins: [], // Empty array = no CORS allowed by default (must be explicitly configured)
  corsCredentials: true, // Allow credentials for authenticated requests
  contentSecurityPolicy: [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${swaggerCdnHost}`,
    `style-src 'self' 'unsafe-inline' ${swaggerCdnHost} ${googleFontsStylesHost} ${fontAwesomeCdnHost} ${leafletCdnHost}`,
    "img-src 'self' data: https:",
    `font-src 'self' data: ${swaggerCdnHost} ${googleFontsAssetsHost} ${fontAwesomeCdnHost}`,
    "connect-src 'self'",
    `frame-src 'self' ${openStreetMapHost}`,
  ].join('; '),
  enableHSTS: true,
  hstsMaxAge: 63072000, // 2 years
};

/**
 * Check if origin is allowed based on CORS configuration
 */
function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return false;
  if (allowedOrigins.includes('*')) return true;
  return allowedOrigins.some(allowed => {
    // Support wildcard subdomains like *.example.com
    if (allowed.startsWith('*.')) {
      const domain = allowed.slice(1); // Remove the *
      return origin.endsWith(domain);
    }
    return origin === allowed;
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
 * // Production configuration with specific origins
 * app.use('*', securityHeaders({
 *   corsOrigins: ['https://www.toiletmap.org', 'https://toiletmap.org'],
 *   corsCredentials: true,
 * }));
 *
 * // Development configuration (allow all origins)
 * app.use('*', securityHeaders({
 *   corsOrigins: ['*'],
 *   enableHSTS: false, // Don't force HTTPS in development
 * }));
 * ```
 */
export const securityHeaders = (config: SecurityHeadersConfig = {}): MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> => {
  const {
    corsOrigins = defaultConfig.corsOrigins,
    corsCredentials = defaultConfig.corsCredentials,
    contentSecurityPolicy = defaultConfig.contentSecurityPolicy,
    enableHSTS = defaultConfig.enableHSTS,
    hstsMaxAge = defaultConfig.hstsMaxAge,
  } = config;

  return async (c, next) => {
    // Handle CORS preflight requests
    if (c.req.method === 'OPTIONS') {
      const origin = c.req.header('origin');

      if (origin && isOriginAllowed(origin, corsOrigins)) {
        c.header('Access-Control-Allow-Origin', origin);
        if (corsCredentials) {
          c.header('Access-Control-Allow-Credentials', 'true');
        }
        c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        c.header('Access-Control-Max-Age', '86400'); // 24 hours
      }

      return new Response(null, { status: 204, headers: c.res.headers });
    }

    // Set CORS headers for actual requests
    const origin = c.req.header('origin');
    if (origin && isOriginAllowed(origin, corsOrigins)) {
      c.header('Access-Control-Allow-Origin', origin);
      if (corsCredentials) {
        c.header('Access-Control-Allow-Credentials', 'true');
      }
      c.header('Access-Control-Expose-Headers', 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset');
    }

    // Security headers

    // Prevent clickjacking attacks
    c.header('X-Frame-Options', 'DENY');

    // Prevent MIME type sniffing
    c.header('X-Content-Type-Options', 'nosniff');

    // Control referrer information
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Disable dangerous browser features
    c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    // Content Security Policy
    if (contentSecurityPolicy) {
      c.header('Content-Security-Policy', contentSecurityPolicy);
    }

    // HTTP Strict Transport Security (only on HTTPS)
    if (enableHSTS) {
      const protocol = c.req.header('x-forwarded-proto') || 'http';
      if (protocol === 'https') {
        c.header('Strict-Transport-Security', `max-age=${hstsMaxAge}; includeSubDomains; preload`);
      }
    }

    await next();
  };
};
