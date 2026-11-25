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

/** A validated, normalised request parameter as it goes into a cache key. */
export type CacheKeyValue = string | number | boolean | null | undefined;

/**
 * Builds an edge-cache key from a route name and its *validated* parameters,
 * never from the raw URL: parameters are sorted, `undefined` ones are
 * dropped and the values are the normalised ones the handler uses (defaults
 * applied, case folded). So `?b=1&a=2`, `?a=2&b=1` and `?a=2&b=1&b=1` share one
 * entry, and junk parameters (rejected by the `.strict()` schemas) can never
 * mint a new one.
 *
 * The key is a URL under a reserved `/__cache/` path of this origin, since
 * the Cache API needs one; it is never fetched.
 */
export const normalisedCacheKey = (
  c: Context,
  route: string,
  params: Record<string, CacheKeyValue>,
): string => {
  const search = new URLSearchParams();
  for (const name of Object.keys(params).sort()) {
    const value = params[name];
    if (value === undefined) continue;
    search.append(name, value === null ? "null" : String(value));
  }
  const query = search.toString();
  return `${new URL(c.req.url).origin}/__cache/${route}${query ? `?${query}` : ""}`;
};

/**
 * Middleware to cache responses using the Cloudflare Workers Cache API and to
 * send `Cache-Control: public, max-age=<ttl>`.
 *
 * The cache key comes from `key`, which should be built with
 * {@link normalisedCacheKey} from the validated parameters (so register this
 * after the route's validators). Never the raw URL: that would let anyone
 * bypass the cache by adding or reordering query parameters.
 *
 * Only suitable for responses that are identical for every caller (no auth or
 * per-user data) and where up to `ttl` seconds of staleness is acceptable,
 * because nothing purges these entries.
 *
 * @param ttl Seconds to cache the response. Can be a number or a function returning a number.
 * @param key Builds the cache key for this request.
 */
export const cacheResponse = (ttl: TtlResolver, key: (c: Context) => string): MiddlewareHandler => {
  return async (c, next) => {
    const cacheKey = key(c);
    // The entry was stored with `public, max-age=<ttl>`, which is also what
    // browsers should get, so the stored Cache-Control is replayed as-is.
    const hit = await edgeCache.match(c, cacheKey);
    if (hit) return hit;

    await next();

    if (c.res.ok) {
      const maxAge = typeof ttl === "function" ? ttl(c) : ttl;

      if (maxAge >= 0) {
        c.res.headers.set("Cache-Control", `public, max-age=${maxAge}`);
        edgeCache.put(c, cacheKey, c.res, maxAge);
      }
    }
  };
};
