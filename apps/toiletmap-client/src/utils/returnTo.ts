/**
 * Helpers for sending people back where they were after signing in, and for sizing the
 * session cookies to the access token's lifetime.
 *
 * Safe to import from both the worker (auth endpoints) and browser islands.
 */

/** Name of the short-lived httpOnly cookie that carries `returnTo` through the Auth0 round trip. */
export const RETURN_TO_COOKIE = "auth_return_to";

/** Used when a token has no readable `exp` claim. */
export const DEFAULT_SESSION_MAX_AGE_SECONDS = 3600;

const MAX_RETURN_TO_LENGTH = 2048;
const PLACEHOLDER_ORIGIN = "https://return-to.invalid";

/**
 * Accept `value` only if it is a same-origin relative path such as `/loos/abc/edit?x=1`.
 * Returns the normalised path (pathname + search + hash) or null.
 *
 * Rejects anything that a browser could resolve to another origin: absolute URLs,
 * protocol-relative `//host`, backslash tricks (`/\host`, which browsers treat as `//host`),
 * other schemes, and control characters (which URL parsing strips, e.g. `/\t/host`).
 */
export function safeReturnTo(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > MAX_RETURN_TO_LENGTH) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;

  let parsed: URL;
  try {
    parsed = new URL(value, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (parsed.origin !== PLACEHOLDER_ORIGIN) return null;
  const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  // Normalisation (e.g. "/./" segments) must not produce a protocol-relative path either.
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  return path;
}

/** `/auth/login`, carrying `returnTo` when it is a safe same-origin path. */
export function loginHref(returnTo?: string | null): string {
  const safe = safeReturnTo(returnTo);
  return safe ? `/auth/login?returnTo=${encodeURIComponent(safe)}` : "/auth/login";
}

/**
 * The page the browser is on, as a same-origin path, or `fallback` when that can't be read
 * (e.g. in tests that stub `window.location`).
 */
export function currentPath(fallback: string): string {
  try {
    const { pathname, search } = window.location;
    const path = safeReturnTo(`${pathname ?? ""}${search ?? ""}`);
    if (path) return path;
  } catch {
    // fall through
  }
  return fallback;
}

const decodeBase64Url = (segment: string): string => {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
};

/**
 * The decoded claims of a JWT, or null when it isn't a readable JWT. The signature is NOT
 * checked: callers only use claims for cookie lifetimes and copy, never to decide whether a
 * token is trusted (the API verifies tokens on every request).
 */
function jwtPayload(token: string | null | undefined): Record<string, unknown> | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as unknown;
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The `exp` claim of a JWT, in seconds since the epoch, or null when it can't be read. */
export function jwtExpiry(token: string | null | undefined): number | null {
  const exp = jwtPayload(token)?.exp;
  return typeof exp === "number" && Number.isFinite(exp) ? exp : null;
}

/**
 * Cookie `maxAge` (seconds) matching the token's remaining lifetime: `exp - now`, or
 * DEFAULT_SESSION_MAX_AGE_SECONDS when the token has no readable `exp`. An already-expired
 * token yields 0, so the cookie is not kept.
 */
export function sessionMaxAge(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): number {
  const exp = jwtExpiry(token);
  if (exp === null) return DEFAULT_SESSION_MAX_AGE_SECONDS;
  return Math.max(0, Math.floor(exp - nowMs / 1000));
}
