/**
 * Server-side helpers for talking to toiletmap-server.
 *
 * The browser never talks to toiletmap-server directly: it calls the
 * same-origin `/api/*` proxy (src/pages/api/[...path].ts), which forwards to
 * the upstream API. Upstream is reached via the `API` service binding when it
 * is configured (production) or over HTTP to `PUBLIC_API_URL` otherwise
 * (local dev and per-branch previews).
 *
 * Nothing in this module may be imported by browser islands.
 */

/** Minimal shape of the env this module needs (a subset of Cloudflare.Env). */
export interface ApiEnv {
  PUBLIC_API_URL: string;
  API?: { fetch: (request: Request) => Promise<Response> };
}

/**
 * A preview deployment of the client: `<branch or version>-toiletmap-client`
 * on the project's workers.dev subdomain, matched as the whole host.
 */
const PREVIEW_CLIENT_HOST =
  /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)-toiletmap-client\.gbtoiletmap\.workers\.dev$/;

/**
 * Returns the absolute base URL of the upstream API. If it's a preview
 * deployment of the client, it points to the matching preview deployment of
 * the server. Only an exact preview host counts: any other host, including
 * one that merely contains `-toiletmap-client`, uses `PUBLIC_API_URL`.
 */
export function getUpstreamApiUrl(env: Pick<ApiEnv, "PUBLIC_API_URL">, requestUrl: URL): string {
  const preview = requestUrl.protocol === "https:" && PREVIEW_CLIENT_HOST.exec(requestUrl.host);
  if (preview) {
    return `https://${preview[1]}-toiletmap-server.gbtoiletmap.workers.dev`;
  }

  // For production or local development, use the configured environment variable
  return env.PUBLIC_API_URL;
}

/**
 * Base URL handed to browser islands. Always "" so that every browser request
 * is relative (same-origin) and goes through the `/api/*` proxy.
 */
export const BROWSER_API_URL = "";

const joinUrl = (base: string, pathAndQuery: string): string => {
  const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  return `${cleanBase}${path}`;
};

/**
 * Sends a request to the upstream API from the server side, using the `API`
 * service binding when present and plain `fetch` otherwise.
 *
 * @param pathAndQuery - e.g. `/api/loos/abc?foo=bar`
 */
export function fetchApi(
  env: ApiEnv,
  requestUrl: URL,
  pathAndQuery: string,
  init?: RequestInit,
): Promise<Response> {
  const upstreamUrl = joinUrl(getUpstreamApiUrl(env, requestUrl), pathAndQuery);
  const request = new Request(upstreamUrl, init);
  if (env.API) {
    return env.API.fetch(request);
  }
  return fetch(request);
}

/** Methods that cannot change state; these skip the CSRF origin check. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Request headers copied from the browser request to upstream. Cookie is deliberately absent. */
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "user-agent",
];

/**
 * Response headers never passed back to the browser: cookies set by upstream
 * belong to the upstream origin, CORS headers are meaningless same-origin,
 * and encoding/length/hop-by-hop headers no longer describe the re-streamed body.
 */
const isStrippedResponseHeader = (name: string, keepCors = false): boolean => {
  const lower = name.toLowerCase();
  return (
    lower === "set-cookie" ||
    (!keepCors && lower.startsWith("access-control-")) ||
    lower === "content-security-policy" ||
    lower === "content-security-policy-report-only" ||
    lower === "content-encoding" ||
    lower === "content-length" ||
    lower === "transfer-encoding" ||
    lower === "connection" ||
    lower === "keep-alive"
  );
};

/**
 * Lock-down headers set on every proxy response. Proxied responses are JSON,
 * so nothing they return should ever be rendered as an active document on the
 * client origin; upstream CSP (e.g. the permissive one on /api/docs) is dropped.
 */
const PROXY_SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
};

const applySecurityHeaders = (headers: Headers): Headers => {
  for (const [name, value] of Object.entries(PROXY_SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return headers;
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: applySecurityHeaders(
      new Headers({ "content-type": "application/json; charset=utf-8" }),
    ),
  });

/**
 * Upstream path prefixes the browser actually needs. Everything else on
 * toiletmap-server (e.g. `/api/docs` Swagger UI, admin routes) is not exposed
 * on the client origin. Keep in sync with browser `fetch` calls under src/.
 */
const ALLOWED_API_PREFIXES = ["/api/loos"];

/**
 * Exact paths of public, unauthenticated POST endpoints. Unlike the prefixes
 * above they may be called without an `Origin` header, because the Flutter
 * app (a native HTTP client, not a browser) sends none. To keep that safe:
 * - a request that does send `Origin` must still be same-origin, and a
 *   browser-flagged cross-site request (`Sec-Fetch-Site`) is refused;
 * - the access-token cookie is never attached, so a request without `Origin`
 *   carries no ambient credentials and there is nothing for CSRF to abuse
 *   (anyone can already POST the same body to the server directly).
 */
const PUBLIC_POST_PATHS = new Set(["/api/feedback"]);

/**
 * Exact paths of public read-only endpoints: GET and HEAD only, anything else
 * gets a 405 without contacting upstream. `/api/geocode` is the place search
 * (postcodes.io, then Nominatim, run server-side).
 */
const PUBLIC_GET_PATHS = new Set(["/api/geocode"]);

/**
 * Returns true when `pathname` (a URL pathname, still percent-encoded) may be
 * proxied upstream. Rejects anything that could be reinterpreted as a
 * different path upstream: dot segments (raw or encoded), encoded slashes or
 * backslashes, raw backslashes, and empty segments (`//`).
 */
export function isAllowedApiPath(pathname: string): boolean {
  if (pathname.includes("\\") || pathname.includes("//")) return false;
  if (/%(2f|5c)/i.test(pathname)) return false;

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (decoded.split("/").some((segment) => segment === "." || segment === "..")) {
    return false;
  }

  if (PUBLIC_POST_PATHS.has(pathname) || PUBLIC_GET_PATHS.has(pathname)) return true;

  return ALLOWED_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * CSRF rule for state-changing requests: `Origin` must equal the client's own
 * origin. The one exception is a POST to a {@link PUBLIC_POST_PATHS} path with
 * no `Origin` at all (native apps), unless the browser marked it cross-site.
 */
const passesOriginCheck = (request: Request, url: URL, method: string): boolean => {
  const origin = request.headers.get("origin");
  if (origin) return origin === url.origin;
  if (method !== "POST" || !PUBLIC_POST_PATHS.has(url.pathname)) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === null || fetchSite === "same-origin" || fetchSite === "none";
};

/**
 * Largest body the `/api/*` proxy reads (refused with 413 while reading, so
 * nothing bigger is ever buffered). Upstream allows 128 KiB for feedback and
 * 64 KiB for loo writes and enforces those itself.
 */
export const PROXY_MAX_BODY_BYTES = 128 * 1024;

export interface ProxyOptions {
  /** Browser request hitting `/api/*` on the client worker. */
  request: Request;
  env: ApiEnv;
  /** Value of the httpOnly `access_token` cookie, if any. */
  accessToken?: string | null;
  /** Client IP as seen by the client worker (cf-connecting-ip). */
  clientIp?: string | null;
}

/**
 * Proxies a same-origin `/api/*` browser request to toiletmap-server.
 *
 * - Only allow-listed paths (see `isAllowedApiPath`) are forwarded; anything
 *   else gets a 404 JSON response without contacting upstream.
 * - Forwards method, body, query string and a small allow-list of headers.
 *   Bodies over {@link PROXY_MAX_BODY_BYTES} get a 413 while being read.
 * - Never forwards the browser's Cookie header.
 * - State-changing methods require `Origin` to equal the client's own origin
 *   (CSRF protection) and get `Authorization: Bearer <access_token>` attached
 *   server-side from the httpOnly cookie, so the token never reaches page JS.
 *   Public read-only paths (`PUBLIC_GET_PATHS`, e.g. `/api/geocode`) accept
 *   only GET and HEAD.
 *   Public POST endpoints (`PUBLIC_POST_PATHS`, e.g. `/api/feedback`) also
 *   accept a missing `Origin` (native apps) and never get the token.
 * - Returns upstream status/body/headers (cache headers included) minus
 *   `set-cookie`, `access-control-*` and upstream CSP; every response gets a
 *   strict `content-security-policy` and `x-content-type-options: nosniff`.
 */
export async function proxyApiRequest({
  request,
  env,
  accessToken,
  clientIp,
}: ProxyOptions): Promise<Response> {
  const url = new URL(request.url);
  if (!isAllowedApiPath(url.pathname)) {
    return jsonResponse(404, { message: "Not Found" });
  }

  const method = request.method.toUpperCase();
  const isSafe = SAFE_METHODS.has(method);

  if (PUBLIC_GET_PATHS.has(url.pathname) && method !== "GET" && method !== "HEAD") {
    const response = jsonResponse(405, { message: "Method Not Allowed" });
    response.headers.set("allow", "GET, HEAD");
    return response;
  }

  if (!isSafe && !passesOriginCheck(request, url, method)) {
    return jsonResponse(403, { message: "Forbidden" });
  }

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // Public endpoints are unauthenticated: never attach the cookie's token.
  if (!isSafe && accessToken && !PUBLIC_POST_PATHS.has(url.pathname)) {
    headers.set("authorization", `Bearer ${accessToken}`);
  }
  if (clientIp) {
    headers.set("cf-connecting-ip", clientIp);
    // Do not trust any incoming X-Forwarded-For: the browser controls it.
    headers.set("x-forwarded-for", clientIp);
  }

  const hasBody = method !== "GET" && method !== "HEAD";
  let body: ArrayBuffer | undefined;
  if (hasBody) {
    const tooLarge = () => jsonResponse(413, { message: "Request body is too large" });
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > PROXY_MAX_BODY_BYTES) return tooLarge();
    // Content-Length may be missing (chunked) or wrong: count while reading.
    const read = await readBodyWithLimit(request, PROXY_MAX_BODY_BYTES);
    if (!read) return tooLarge();
    body = read;
  }

  return forwardUpstream({ env, url, upstreamPath: url.pathname, method, headers, body });
}

/**
 * Sends the prepared request upstream and relays the response: status, body
 * and headers minus {@link isStrippedResponseHeader}, plus the proxy's
 * lock-down headers. Upstream failures become a 502.
 */
async function forwardUpstream({
  env,
  url,
  upstreamPath,
  method,
  headers,
  body,
  keepCors = false,
}: {
  env: ApiEnv;
  url: URL;
  upstreamPath: string;
  method: string;
  headers: Headers;
  body: ArrayBuffer | undefined;
  keepCors?: boolean;
}): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetchApi(env, url, `${upstreamPath}${url.search}`, {
      method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      redirect: "manual",
    });
  } catch (error) {
    console.error("API proxy upstream request failed:", error);
    return jsonResponse(502, { message: "The Toilet Map API is unavailable. Please try again." });
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!isStrippedResponseHeader(name, keepCors)) responseHeaders.append(name, value);
  });
  applySecurityHeaders(responseHeaders);

  const nullBody = method === "HEAD" || [204, 205, 304].includes(upstream.status);
  return new Response(nullBody ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

// ---------------------------------------------------------------------------
// Legacy GraphQL compatibility route
// ---------------------------------------------------------------------------

/**
 * The legacy GraphQL API lived at `www.toiletmap.org.uk/api` (the Flutter app
 * calls `GET /api/?query=`; other clients POST to `/api`). Exactly these two
 * paths are proxied to toiletmap-server's read-only `/api/graphql`. Nothing
 * else under `/api` matches (`/api/feedback` included).
 */
export function isLegacyGraphqlPath(pathname: string): boolean {
  return pathname === "/api" || pathname === "/api/";
}

const LEGACY_GRAPHQL_UPSTREAM_PATH = "/api/graphql";

const LEGACY_GRAPHQL_METHODS = new Set(["GET", "HEAD", "POST", "OPTIONS"]);

/**
 * Headers the legacy endpoint needs: content negotiation, plus `Origin` and
 * the preflight headers because upstream answers CORS for cross-origin
 * callers (the GraphQL explorer, third-party sites). No cookies, no tokens.
 */
const LEGACY_GRAPHQL_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "user-agent",
  "origin",
  "access-control-request-method",
  "access-control-request-headers",
];

/** Bodies above this are refused here, while reading (upstream allows 32 KiB). */
export const LEGACY_GRAPHQL_MAX_BODY_BYTES = 64 * 1024;

/**
 * The proxy's own legacy GraphQL errors. Like upstream's, any origin may read
 * them (`Access-Control-Allow-Origin: *`, never credentials).
 */
const legacyGraphqlError = (status: number, message: string): Response => {
  const response = jsonResponse(status, { errors: [{ message }] });
  response.headers.set("access-control-allow-origin", "*");
  return response;
};

/**
 * Reads a request body, giving up (and cancelling the stream) as soon as it
 * passes `maxBytes`, so a chunked body without `Content-Length` is never
 * buffered beyond the limit. Returns null when the body is too large.
 */
export async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<ArrayBuffer | null> {
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {
        // Already errored or closed: nothing left to release.
      });
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

/**
 * Proxies `/api` and `/api/` to the read-only legacy GraphQL endpoint.
 *
 * A deliberate exception to {@link proxyApiRequest}'s rules: these requests
 * come from apps and other origins, never from this site's pages, and the
 * endpoint rejects every mutation, so
 * - there is no CSRF `Origin` check on POST;
 * - no cookie is forwarded and no access token is attached, ever;
 * - upstream `Access-Control-*` headers are passed through (CORS is
 *   upstream's decision).
 * The client IP is forwarded like every other proxied route, so upstream
 * rate limiting still applies per caller.
 */
export async function proxyLegacyGraphqlRequest({
  request,
  env,
  clientIp,
}: Omit<ProxyOptions, "accessToken">): Promise<Response> {
  const url = new URL(request.url);
  if (!isLegacyGraphqlPath(url.pathname)) {
    return jsonResponse(404, { message: "Not Found" });
  }

  const method = request.method.toUpperCase();
  if (!LEGACY_GRAPHQL_METHODS.has(method)) {
    const response = legacyGraphqlError(405, `Method ${method} is not allowed.`);
    response.headers.set("allow", "GET, POST");
    return response;
  }

  const headers = new Headers();
  for (const name of LEGACY_GRAPHQL_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  if (clientIp) {
    headers.set("cf-connecting-ip", clientIp);
    // Do not trust any incoming X-Forwarded-For: the caller controls it.
    headers.set("x-forwarded-for", clientIp);
  }

  let body: ArrayBuffer | undefined;
  if (method === "POST") {
    const tooLarge = () => legacyGraphqlError(413, "Request body is too large.");
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > LEGACY_GRAPHQL_MAX_BODY_BYTES) return tooLarge();
    // Content-Length may be missing (chunked) or wrong: count while reading.
    const read = await readBodyWithLimit(request, LEGACY_GRAPHQL_MAX_BODY_BYTES);
    if (!read) return tooLarge();
    body = read;
  }

  return forwardUpstream({
    env,
    url,
    upstreamPath: LEGACY_GRAPHQL_UPSTREAM_PATH,
    method,
    headers,
    body,
    keepCors: true,
  });
}
