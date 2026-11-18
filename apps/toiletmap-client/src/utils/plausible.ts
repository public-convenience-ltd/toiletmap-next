/**
 * Plausible Analytics through a first-party proxy on this worker.
 *
 * Off unless the `PLAUSIBLE_DOMAIN` var is set (a plain var in wrangler.jsonc, not a
 * secret). When it is set:
 *
 * - pages render `<script defer data-domain=… data-api="/api/event" src="/js/p.js">`
 *   (src/components/Analytics.astro, included by the layout);
 * - `GET /js/p.js` (src/pages/js/p.js.ts) serves Plausible's script, fetched from
 *   plausible.io and cached;
 * - `POST /api/event` (src/pages/api/event.ts) forwards the event to
 *   https://plausible.io/api/event with the visitor's IP in `X-Forwarded-For` and their
 *   `User-Agent`, as Plausible's proxy guide requires (it counts unique visitors from a
 *   daily-rotated hash of IP + User-Agent; nothing is stored on the device).
 *
 * When it is not set, nothing is rendered and both routes are a plain 404, so no request
 * ever reaches plausible.io.
 *
 * Nothing here may be imported by browser islands.
 */

/** Path of the proxied script on our origin. */
export const PLAUSIBLE_SCRIPT_PATH = "/js/p.js";
/** Path of the proxied event endpoint on our origin (passed to the script as `data-api`). */
export const PLAUSIBLE_EVENT_PATH = "/api/event";
/** Plausible's standard script (pageviews only; no outbound-link or file-download add-ons). */
export const PLAUSIBLE_UPSTREAM_SCRIPT_URL = "https://plausible.io/js/script.js";
export const PLAUSIBLE_UPSTREAM_EVENT_URL = "https://plausible.io/api/event";

/** How long the script is cached, at the edge and in the browser (seconds). */
export const PLAUSIBLE_SCRIPT_MAX_AGE = 6 * 60 * 60;
/** Plausible events are a few hundred bytes; anything far larger is not one. */
export const PLAUSIBLE_MAX_EVENT_BYTES = 4096;

/**
 * The worker env (`env` from cloudflare:workers). Only `PLAUSIBLE_DOMAIN` is read, and it
 * is optional: off when unset, blank or not a string. Typed as `object` so this works
 * whether or not `wrangler types` has listed the var (it isn't in wrangler.jsonc until
 * the owner turns analytics on).
 */
export type PlausibleEnv = object;

type FetchLike = (request: Request) => Promise<Response>;

/** Minimal shape of the Workers Cache API (`caches.default`). */
export interface ScriptCache {
  match: (request: Request) => Promise<Response | undefined>;
  put: (request: Request, response: Response) => Promise<void>;
}

/** The site domain Plausible counts pageviews under, or null when analytics is off. */
export function getPlausibleDomain(env: PlausibleEnv): string | null {
  const value: unknown = (env as { PLAUSIBLE_DOMAIN?: unknown }).PLAUSIBLE_DOMAIN;
  const domain = typeof value === "string" ? value.trim() : "";
  return domain ? domain : null;
}

/**
 * Path prefixes never tracked: the CMS, developer pages, sign-in, and the contribution
 * forms (add, edit, report a problem), where people are signed in or entering data.
 */
const UNTRACKED_PATH_PATTERNS: RegExp[] = [
  /^\/cms(\/|$)/,
  /^\/dev(\/|$)/,
  /^\/auth(\/|$)/,
  /^\/admin(\/|$)/,
  /^\/loos\/add\/?$/,
  /^\/loos\/[^/]+\/(edit|remove|report)(\/|$)/,
];

/** True when a page at `pathname` may carry the analytics script. */
export function isTrackedPath(pathname: string): boolean {
  return !UNTRACKED_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

/** True when the browser asks not to be tracked (Global Privacy Control or Do Not Track). */
export function prefersNoTracking(headers: Headers): boolean {
  return headers.get("sec-gpc")?.trim() === "1" || headers.get("dnt")?.trim() === "1";
}

export interface PlausibleScriptTag {
  src: string;
  "data-domain": string;
  "data-api": string;
}

/**
 * Attributes of the analytics `<script>` for a page, or null when none should be
 * rendered: analytics off, an untracked path, or a visitor sending GPC / DNT.
 *
 * `headers` is null for prerendered pages (there is no visitor request at build time);
 * the event route still drops GPC / DNT events for those.
 */
export function plausibleScriptTag(
  env: PlausibleEnv,
  pathname: string,
  headers: Headers | null,
): PlausibleScriptTag | null {
  const domain = getPlausibleDomain(env);
  if (!domain || !isTrackedPath(pathname)) return null;
  if (headers && prefersNoTracking(headers)) return null;
  return { src: PLAUSIBLE_SCRIPT_PATH, "data-domain": domain, "data-api": PLAUSIBLE_EVENT_PATH };
}

const notFound = (): Response =>
  new Response("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

const textResponse = (status: number, body: string, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });

export interface ScriptProxyOptions {
  env: PlausibleEnv;
  request: Request;
  fetchImpl?: FetchLike;
  /** The Workers edge cache (`caches.default`); omitted where there is none. */
  cache?: ScriptCache | null;
  /** Keeps the cache write alive after the response is sent (`ctx.waitUntil`). */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * `GET /js/p.js`: Plausible's script from our own origin, cached at the edge.
 * 404 when analytics is off.
 */
export async function proxyPlausibleScript({
  env,
  request,
  fetchImpl = fetch,
  cache,
  waitUntil,
}: ScriptProxyOptions): Promise<Response> {
  if (!getPlausibleDomain(env)) return notFound();

  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return textResponse(405, "Method Not Allowed", { allow: "GET, HEAD" });
  }

  // One cache entry per deployment origin, keyed on the path alone (no query string).
  const cacheKey = new Request(new URL(PLAUSIBLE_SCRIPT_PATH, request.url).toString());
  const cached = await cache?.match(cacheKey).catch(() => undefined);
  if (cached) return method === "HEAD" ? new Response(null, cached) : cached;

  let upstream: Response;
  try {
    upstream = await fetchImpl(new Request(PLAUSIBLE_UPSTREAM_SCRIPT_URL, { method: "GET" }));
  } catch (error) {
    console.error("Plausible script fetch failed:", error);
    return textResponse(502, "Bad Gateway");
  }
  if (!upstream.ok) return textResponse(502, "Bad Gateway");

  const response = new Response(await upstream.text(), {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": `public, max-age=${PLAUSIBLE_SCRIPT_MAX_AGE}`,
      "x-content-type-options": "nosniff",
    },
  });
  if (cache) {
    const write = cache.put(cacheKey, response.clone()).catch(() => undefined);
    if (waitUntil) waitUntil(write);
    else await write;
  }
  return method === "HEAD" ? new Response(null, response) : response;
}

export interface EventProxyOptions {
  env: PlausibleEnv;
  request: Request;
  /** The visitor's IP (cf-connecting-ip). Never taken from the browser's X-Forwarded-For. */
  clientIp: string | null;
  fetchImpl?: FetchLike;
}

/** The `d` (domain) field of a Plausible event body, or null if it isn't one. */
const eventDomain = (body: string): string | null => {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "d" in parsed) {
      const { d } = parsed as { d: unknown };
      return typeof d === "string" ? d : null;
    }
  } catch {
    // Not JSON.
  }
  return null;
};

/**
 * `POST /api/event`: forwards a Plausible event to plausible.io.
 *
 * - 404 when analytics is off (nothing is sent anywhere).
 * - Only POST, only from our own origin (when the browser says where it came from),
 *   only small bodies, and only events for our own `PLAUSIBLE_DOMAIN`, so the route
 *   cannot be used to relay events for other sites.
 * - Visitors sending GPC or DNT get a 202 and nothing is forwarded.
 * - Forwards only `User-Agent`, `Content-Type` and `X-Forwarded-For` (the visitor's IP
 *   from cf-connecting-ip, never the browser's own X-Forwarded-For). Cookies, Referer
 *   and every other header stay behind.
 */
export async function proxyPlausibleEvent({
  env,
  request,
  clientIp,
  fetchImpl = fetch,
}: EventProxyOptions): Promise<Response> {
  const domain = getPlausibleDomain(env);
  if (!domain) return notFound();

  if (request.method.toUpperCase() !== "POST") {
    return textResponse(405, "Method Not Allowed", { allow: "POST" });
  }

  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return textResponse(403, "Forbidden");
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > PLAUSIBLE_MAX_EVENT_BYTES) return textResponse(413, "Payload Too Large");
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > PLAUSIBLE_MAX_EVENT_BYTES) {
    return textResponse(413, "Payload Too Large");
  }

  if (prefersNoTracking(request.headers)) return textResponse(202, "ok");

  if (eventDomain(body) !== domain) return textResponse(400, "Bad Request");

  const headers = new Headers();
  headers.set("content-type", request.headers.get("content-type") ?? "text/plain");
  const userAgent = request.headers.get("user-agent");
  if (userAgent) headers.set("user-agent", userAgent);
  if (clientIp) headers.set("x-forwarded-for", clientIp);

  let upstream: Response;
  try {
    upstream = await fetchImpl(
      new Request(PLAUSIBLE_UPSTREAM_EVENT_URL, { method: "POST", headers, body }),
    );
  } catch (error) {
    console.error("Plausible event forward failed:", error);
    return textResponse(502, "Bad Gateway");
  }

  const upstreamBody = await upstream.text();
  if ([204, 205, 304].includes(upstream.status)) {
    return new Response(null, {
      status: upstream.status,
      headers: { "cache-control": "no-store" },
    });
  }
  return textResponse(upstream.status, upstreamBody);
}
