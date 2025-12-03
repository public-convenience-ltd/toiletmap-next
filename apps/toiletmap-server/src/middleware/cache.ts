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
      return match;
    }

    await next();

    if (c.res.ok) {
      const maxAge = typeof ttl === "function" ? ttl(c) : ttl;
      c.res.headers.set("Cache-Control", `public, max-age=${maxAge}`);

      if (cache) {
        c.executionCtx.waitUntil(cache.put(c.req.raw, c.res.clone()));
      }
    }
  };
};
