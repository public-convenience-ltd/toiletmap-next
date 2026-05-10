import type { Context, MiddlewareHandler } from "hono";

type TtlResolver = number | ((c: Context) => number);

/**
 * Middleware to cache responses using Cloudflare Workers Cache API.
 *
 * @param ttl Seconds to cache the response. Can be a number or a function returning a number.
 */
export const cacheResponse = (ttl: TtlResolver): MiddlewareHandler => {
  return async (c, next) => {
    // biome-ignore lint/suspicious/noExplicitAny: Cloudflare caches type is not available in standard DOM types
    const cache = typeof caches !== "undefined" ? (caches as any).default : undefined;
    const match = cache ? await cache.match(c.req.raw) : undefined;

    if (match) {
      // Security/CORS headers were set on the Hono context by middleware that ran
      // before this handler (e.g. securityHeaders), but returning the raw cached
      // Response bypasses Hono's context header merging. Copy them across so every
      // cached response still carries the correct CORS headers for the caller's origin.
      const response = new Response(match.body, match);
      for (const [key, value] of c.res.headers.entries()) {
        response.headers.set(key, value);
      }
      return response;
    }

    await next();

    if (c.res.ok) {
      const maxAge = typeof ttl === "function" ? ttl(c) : ttl;

      if (maxAge >= 0) {
        c.res.headers.set("Cache-Control", `public, max-age=${maxAge}`);

        if (cache && maxAge > 0) {
          c.executionCtx.waitUntil(cache.put(c.req.raw, c.res.clone()));
        }
      }
    }
  };
};
