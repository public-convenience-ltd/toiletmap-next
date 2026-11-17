import type { Context, MiddlewareHandler } from "hono";

type TtlResolver = number | ((c: Context) => number);

/**
 * Headers worth keeping in a Cache API entry. Everything else is either
 * per-request (CORS, `Vary`, rate-limit counters, cookies) or re-applied by the
 * global middleware on every request (security headers), so it is dropped
 * before `cache.put`. Storing per-request headers would replay the first
 * caller's `Access-Control-Allow-Origin` to every later caller.
 */
const STORED_HEADERS = ["content-type", "etag", "last-modified"] as const;

/** The colo-local Cloudflare cache, or undefined outside Workers (tests may stub it). */
const getEdgeCache = (): Cache | undefined =>
  typeof caches !== "undefined"
    ? (caches as unknown as { default: Cache | undefined }).default
    : undefined;

/**
 * Copies a response into a form safe to store in the shared edge cache: the
 * body plus only {@link STORED_HEADERS}, with `edgeTtl` controlling how long
 * the Cache API keeps it.
 */
const toStorableResponse = (response: Response, edgeTtl: number): Response => {
  const headers = new Headers();
  for (const name of STORED_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("Cache-Control", `public, max-age=${edgeTtl}`);
  return new Response(response.clone().body, { status: response.status, headers });
};

/**
 * Turns a cache hit into a response for *this* request. Building it through
 * `c.newResponse` merges the headers the global middleware already set on the
 * context (CORS for this caller's Origin, `Vary`, security headers).
 */
const fromCachedResponse = (
  c: Context,
  cached: Response,
  cacheControl: string | undefined,
): Response => {
  const headers: Record<string, string> = {};
  for (const name of STORED_HEADERS) {
    const value = cached.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  // Default to the TTL the entry was stored with.
  headers["Cache-Control"] = cacheControl ?? cached.headers.get("cache-control") ?? "no-cache";
  return c.newResponse(cached.body, cached.status as 200, headers);
};

/**
 * Explicitly keyed edge-cache access, for routes that build their own cache
 * key (for example one that embeds a dataset version, so a write simply moves
 * readers to a new key instead of needing a purge in every colo).
 *
 * The Cache API is colo-local and a no-op on `workers.dev`, so treat it purely
 * as an optimisation: correctness must never depend on a hit or a miss.
 */
export const edgeCache = {
  /**
   * @param cacheControl Cache-Control for the response sent to this caller;
   *   defaults to the one the entry was stored with.
   */
  async match(c: Context, key: string, cacheControl?: string): Promise<Response | undefined> {
    const cache = getEdgeCache();
    if (!cache) return undefined;
    // A string key (not `c.req.raw`) so the caller's conditional headers such
    // as If-None-Match never turn the lookup into a 304.
    try {
      const hit = await cache.match(key);
      return hit ? fromCachedResponse(c, hit, cacheControl) : undefined;
    } catch {
      return undefined; // A cache fault is just a miss.
    }
  },

  put(c: Context, key: string, response: Response, edgeTtl: number): void {
    const cache = getEdgeCache();
    if (!cache || !response.ok || edgeTtl <= 0) return;
    c.executionCtx.waitUntil(
      cache.put(key, toStorableResponse(response, edgeTtl)).catch(() => undefined),
    );
  },
};

/**
 * Middleware to cache responses using Cloudflare Workers Cache API, keyed by
 * the request URL, and to send `Cache-Control: public, max-age=<ttl>`.
 *
 * Only suitable for responses that are identical for every caller (no auth or
 * per-user data) and where up to `ttl` seconds of staleness is acceptable,
 * because nothing purges these entries.
 *
 * @param ttl Seconds to cache the response. Can be a number or a function returning a number.
 */
export const cacheResponse = (ttl: TtlResolver): MiddlewareHandler => {
  return async (c, next) => {
    const key = c.req.url;
    // The entry was stored with `public, max-age=<ttl>`, which is also what
    // browsers should get, so the stored Cache-Control is replayed as-is.
    const hit = await edgeCache.match(c, key);
    if (hit) return hit;

    await next();

    if (c.res.ok) {
      const maxAge = typeof ttl === "function" ? ttl(c) : ttl;

      if (maxAge >= 0) {
        c.res.headers.set("Cache-Control", `public, max-age=${maxAge}`);
        edgeCache.put(c, key, c.res, maxAge);
      }
    }
  };
};
