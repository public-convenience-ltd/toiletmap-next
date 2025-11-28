import { Context, MiddlewareHandler } from "hono";
import { Env, AppVariables } from "../types";
import { MAX_RATE_LIMIT_STORE_SIZE } from "../common/constants";

/**
 * Rate limiting configuration
 */
interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Time window in seconds */
  windowSeconds: number;
  /** Optional key function to identify clients (defaults to IP address) */
  keyGenerator?: (c: Context) => string;
  /** Optional message to return when rate limit is exceeded */
  message?: string;
}

/**
 * In-memory rate limit store
 *
 * > [!WARNING]
 * > This implementation uses in-memory storage which is NOT shared across
 * > Cloudflare Worker instances. In a distributed environment, this means
 * > rate limits are per-isolate, not global.
 * >
 * > For production use with strict global limits, consider using:
 * > - Cloudflare Rate Limiting (infrastructure level)
 * > - Cloudflare KV or Durable Objects (application level)
 * >
 * > This implementation is sufficient for preventing basic abuse and
 * > protecting against single-client floods on a single edge node.
 */
class RateLimitStore {
  private store = new Map<string, { count: number; resetAt: number }>();

  /**
   * Check if a request should be allowed
   */
  check(
    key: string,
    maxRequests: number,
    windowSeconds: number
  ): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
  } {
    const now = Date.now();
    const entry = this.store.get(key);

    // Clean up expired entries periodically
    if (this.store.size > MAX_RATE_LIMIT_STORE_SIZE) {
      this.cleanup(now);
    }

    if (!entry || entry.resetAt < now) {
      // New window
      const resetAt = now + windowSeconds * 1000;
      this.store.set(key, { count: 1, resetAt });
      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetAt,
      };
    }

    // Within existing window
    if (entry.count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.resetAt,
      };
    }

    entry.count++;
    return {
      allowed: true,
      remaining: maxRequests - entry.count,
      resetAt: entry.resetAt,
    };
  }

  /**
   * Clean up expired entries
   */
  private cleanup(now: number) {
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt < now) {
        this.store.delete(key);
      }
    }
  }
}

const rateLimitStore = new RateLimitStore();

/**
 * Rate limiting middleware
 *
 * @example
 * ```ts
 * // Limit to 100 requests per minute
 * app.use('/api/*', rateLimit({ maxRequests: 100, windowSeconds: 60 }));
 *
 * // Strict limit for auth endpoints
 * app.use('/api/auth/*', rateLimit({ maxRequests: 5, windowSeconds: 60 }));
 * ```
 */
export const rateLimit = (
  config: RateLimitConfig
): MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> => {
  const {
    maxRequests,
    windowSeconds,
    keyGenerator = (c) =>
      c.req.header("cf-connecting-ip") ||
      c.req.header("x-forwarded-for") ||
      "unknown",
    message = "Too many requests, please try again later",
  } = config;

  return async (c, next) => {
    const key = keyGenerator(c);
    const result = rateLimitStore.check(key, maxRequests, windowSeconds);

    // Add rate limit headers
    c.header("X-RateLimit-Limit", maxRequests.toString());
    c.header("X-RateLimit-Remaining", result.remaining.toString());
    c.header("X-RateLimit-Reset", Math.floor(result.resetAt / 1000).toString());

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
      c.header("Retry-After", retryAfter.toString());
      return c.json(
        {
          message,
          retryAfter,
        },
        429
      );
    }

    await next();
  };
};

/**
 * Pre-configured rate limiters for common use cases
 */
