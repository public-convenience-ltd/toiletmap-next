import type { Context, MiddlewareHandler } from "hono";
import type { AppVariables, Env } from "../types";
import { logger } from "../utils/logger";
import { rateLimit } from "./rate-limit";

/**
 * Rate limiting configuration for Cloudflare Rate Limiting API
 */
interface CloudflareRateLimitConfig {
  binding: "RATE_LIMIT_READ" | "RATE_LIMIT_WRITE" | "RATE_LIMIT_ADMIN" | "RATE_LIMIT_AUTH";
  keyGenerator: (c: Context<{ Bindings: Env; Variables: AppVariables }>) => string;
  message?: string;
  name?: string;
  fallback?: {
    maxRequests: number;
    windowSeconds: number;
  };
}

/**
 * Cloudflare Rate Limiting middleware
 *
 * Uses Cloudflare's native Rate Limiting API for datacenter-level rate limiting.
 * Rate limits are per Cloudflare location, providing better protection than per-isolate
 * in-memory limiting.
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
    fallback,
  } = config;

  const fallbackLimiter = fallback
    ? rateLimit({
        maxRequests: fallback.maxRequests,
        windowSeconds: fallback.windowSeconds,
        keyGenerator,
        message,
      })
    : null;

  return async (c, next) => {
    const rateLimiter = c.env[binding];

    if (!rateLimiter) {
      logger.error("Rate limiter binding not found", {
        binding,
        path: c.req.path,
        method: c.req.method,
      });
      if (fallbackLimiter) {
        logger.warn("Falling back to in-memory rate limiter", {
          rateLimiter: name,
          binding,
          path: c.req.path,
          method: c.req.method,
        });
        return fallbackLimiter(c, next);
      }
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
      // Fallback to in-memory limiter if available, otherwise allow request
      if (fallbackLimiter) {
        logger.warn("Rate limiter error, falling back to in-memory limiter", {
          rateLimiter: name,
          binding,
          path: c.req.path,
          method: c.req.method,
        });
        return fallbackLimiter(c, next);
      }
      // Fail open if no fallback configured
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
  /** Public read operations (100 req/min, IP-based) */
  read: cloudflareRateLimit({
    binding: "RATE_LIMIT_READ",
    keyGenerator: (c) => `read:${getClientIp(c)}`,
    message: "Too many requests, please try again later",
    name: "read",
    fallback: {
      maxRequests: 100,
      windowSeconds: 60,
    },
  }),

  /** Write operations (20 req/min, user or IP-based) */
  write: cloudflareRateLimit({
    binding: "RATE_LIMIT_WRITE",
    keyGenerator: (c) => `write:${getUserIdOrIp(c)}`,
    message: "Too many requests, please slow down",
    name: "write",
    fallback: {
      maxRequests: 20,
      windowSeconds: 60,
    },
  }),

  /** Admin operations (60 req/min, user or IP-based) */
  admin: cloudflareRateLimit({
    binding: "RATE_LIMIT_ADMIN",
    keyGenerator: (c) => `admin:${getUserIdOrIp(c)}`,
    message: "Too many admin requests, please try again later",
    name: "admin",
    fallback: {
      maxRequests: 60,
      windowSeconds: 60,
    },
  }),

  /** Authentication attempts (5 req/min, IP-based) */
  auth: cloudflareRateLimit({
    binding: "RATE_LIMIT_AUTH",
    keyGenerator: (c) => `auth:${getClientIp(c)}`,
    message: "Too many authentication attempts, please try again later",
    name: "auth",
    fallback: {
      maxRequests: 5,
      windowSeconds: 60,
    },
  }),
};
