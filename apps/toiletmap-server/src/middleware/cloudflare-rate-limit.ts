import type { Context, MiddlewareHandler } from "hono";
import type { AppVariables, Env } from "../types";
import { logger } from "../utils/logger";

/**
 * Rate limiting configuration for Cloudflare Rate Limiting API
 */
interface CloudflareRateLimitConfig {
  binding: "RATE_LIMIT_READ" | "RATE_LIMIT_WRITE" | "RATE_LIMIT_ADMIN" | "RATE_LIMIT_AUTH";
  keyGenerator: (c: Context<{ Bindings: Env; Variables: AppVariables }>) => string;
  message?: string;
  name?: string;
}

/**
 * Cloudflare Rate Limiting middleware
 *
 * Uses Cloudflare's native Rate Limiting API for datacenter-level rate limiting.
 * Rate limits are per Cloudflare location.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
 *
 * @example
 * ```ts
 * // IP-based limiting for public endpoints
 * app.use('/api/*', cloudflareRateLimit({
 *   binding: 'RATE_LIMIT_READ',
 *   keyGenerator: (c) => getClientIp(c)
 * }));
 *
 * // User-based limiting for authenticated endpoints
 * app.use('/admin/*', cloudflareRateLimit({
 *   binding: 'RATE_LIMIT_ADMIN',
 *   keyGenerator: (c) => getUserIdOrIp(c)
 * }));
 * ```
 */
const cloudflareRateLimit = (
  config: CloudflareRateLimitConfig,
): MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> => {
  const {
    binding,
    keyGenerator,
    message = "Too many requests, please try again later",
    name = binding,
  } = config;

  return async (c, next) => {
    const rateLimiter = c.env[binding];

    if (!rateLimiter) {
      logger.error("Rate limiter binding not found", {
        binding,
        path: c.req.path,
        method: c.req.method,
      });
      // Fail open if binding is missing
      return next();
    }

    const key = keyGenerator(c);

    try {
      const { success } = await rateLimiter.limit({ key });

      if (!success) {
        logger.warn("Rate limit exceeded", {
          rateLimiter: name,
          key,
          path: c.req.path,
          method: c.req.method,
        });
        return c.json(
          {
            message,
            error: "rate_limit_exceeded",
          },
          429,
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.logError(error, {
          rateLimiter: name,
          path: c.req.path,
          method: c.req.method,
        });
      } else {
        logger.error("Rate limiting error", {
          rateLimiter: name,
          path: c.req.path,
          method: c.req.method,
          errorMessage: String(error),
        });
      }
      // Fail open on error
      return next();
    }

    await next();
  };
};

/**
 * Get client IP from Cloudflare headers
 */
const getClientIp = (c: Context): string => {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
};

/**
 * Get user ID from context, or fall back to IP
 */
const getUserIdOrIp = (c: Context<{ Bindings: Env; Variables: AppVariables }>): string => {
  const user = c.get("user");
  if (user?.sub) {
    return `user:${user.sub}`;
  }
  return `ip:${getClientIp(c)}`;
};

/**
 * Pre-configured rate limiters matching existing behavior
 */
export const rateLimiters = {
  /** Public read operations (400 req/min, IP-based) */
  read: cloudflareRateLimit({
    binding: "RATE_LIMIT_READ",
    keyGenerator: (c) => `read:${getClientIp(c)}`,
    message: "Too many requests, please try again later",
    name: "read",
  }),

  /** Write operations (20 req/min, user or IP-based) */
  write: cloudflareRateLimit({
    binding: "RATE_LIMIT_WRITE",
    keyGenerator: (c) => `write:${getUserIdOrIp(c)}`,
    message: "Too many requests, please slow down",
    name: "write",
  }),

  /** Admin operations (60 req/min, user or IP-based) */
  admin: cloudflareRateLimit({
    binding: "RATE_LIMIT_ADMIN",
    keyGenerator: (c) => `admin:${getUserIdOrIp(c)}`,
    message: "Too many admin requests, please try again later",
    name: "admin",
  }),

  /** Authentication attempts (5 req/min, IP-based) */
  auth: cloudflareRateLimit({
    binding: "RATE_LIMIT_AUTH",
    keyGenerator: (c) => `auth:${getClientIp(c)}`,
    message: "Too many authentication attempts, please try again later",
    name: "auth",
  }),
};
