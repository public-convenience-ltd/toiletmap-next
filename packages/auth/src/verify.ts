import { decode, verifyWithJwks } from "hono/jwt";
import type { Auth0User, AuthEnv, RequestUser } from "./types";

type Jwk = NonNullable<Parameters<typeof verifyWithJwks>[1]["keys"]>[number];

/**
 * The issuer's signing keys could not be fetched (network error, non-2xx or a
 * malformed JWKS), so the token could be neither accepted nor rejected.
 * Optional-auth routes treat the caller as anonymous; required-auth routes
 * refuse the request.
 */
export class JwksUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "JwksUnavailableError";
  }
}

/** How long a fetched JWKS is reused. Auth0 rotates keys rarely and keeps the old one published. */
const JWKS_TTL_MS = 10 * 60 * 1000;

/**
 * Minimum gap between two fetches of the same JWKS. A token with an unknown
 * `kid` refetches (a key may just have been rotated in), but no more often
 * than this, so random `kid`s cannot turn every request into a JWKS fetch.
 */
const JWKS_REFETCH_COOLDOWN_MS = 30 * 1000;

type JwksCacheEntry = { keys: Jwk[]; fetchedAt: number };

const jwksCache = new Map<string, JwksCacheEntry>();
const inflight = new Map<string, Promise<Jwk[]>>();

const fetchJwks = async (uri: string): Promise<Jwk[]> => {
  let response: Response;
  try {
    response = await fetch(uri);
  } catch (error) {
    throw new JwksUnavailableError(`Failed to fetch JWKS from ${uri}`, { cause: error });
  }
  if (!response.ok) {
    throw new JwksUnavailableError(`Failed to fetch JWKS from ${uri}: HTTP ${response.status}`);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    throw new JwksUnavailableError(`Invalid JWKS response from ${uri}`, { cause: error });
  }
  const keys = (data as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys)) {
    throw new JwksUnavailableError(`Invalid JWKS response from ${uri}: "keys" is not an array`);
  }
  return keys as Jwk[];
};

/** Fetches the JWKS once even when several verifications ask at the same time. */
const refreshJwks = (uri: string): Promise<Jwk[]> => {
  const pending = inflight.get(uri);
  if (pending) return pending;
  const request = fetchJwks(uri)
    .then((keys) => {
      jwksCache.set(uri, { keys, fetchedAt: Date.now() });
      return keys;
    })
    .finally(() => inflight.delete(uri));
  inflight.set(uri, request);
  return request;
};

/**
 * The issuer's signing keys, cached for {@link JWKS_TTL_MS}. Refetched early
 * when `kid` is not among them (at most once per {@link JWKS_REFETCH_COOLDOWN_MS}).
 */
const getSigningKeys = async (uri: string, kid: string | undefined): Promise<Jwk[]> => {
  const cached = jwksCache.get(uri);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < JWKS_TTL_MS) {
    const known = !kid || cached.keys.some((key) => key.kid === kid);
    if (known || now - cached.fetchedAt < JWKS_REFETCH_COOLDOWN_MS) return cached.keys;
  }
  return refreshJwks(uri);
};

/**
 * Whether the token's `aud` claim names `expected`: an exact string, or an
 * exact member of an array (RFC 7519 §4.1.3). Delimited strings such as
 * `"a b"` or `"a,b"` are a single audience, not a list.
 *
 * @internal exposed for unit testing only
 */
export const matchesAudience = (claim: unknown, expected: string): boolean => {
  if (!expected) return false;
  if (Array.isArray(claim)) return claim.some((value) => value === expected);
  return typeof claim === "string" && claim === expected;
};

/** @internal exposed for unit testing only */
export const normalizeUser = (user: Auth0User): RequestUser => {
  const sub = typeof user?.sub === "string" ? user.sub.trim() : null;
  if (!sub) throw new Error("Auth0 token missing `sub` claim");

  const norm = (v?: string | null) =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;

  const permissions = Array.isArray(user.permissions)
    ? user.permissions.filter((p): p is string => typeof p === "string")
    : undefined;

  return {
    ...user,
    sub,
    name: norm(user.name),
    nickname: norm(user.nickname),
    email: norm(user.email),
    permissions,
  };
};

/**
 * Verifies an Auth0-issued RS256 JWT and returns its normalised claims.
 *
 * Checks the signature against the issuer's JWKS (cached), then requires:
 * `exp` (a number, in the future), `iss` equal to the configured issuer, and
 * `aud` naming the expected audience (`audience`, or `AUTH0_AUDIENCE`). An
 * empty expected audience is a configuration error and rejects every token.
 *
 * Throws {@link JwksUnavailableError} when the signing keys cannot be fetched.
 */
export const authenticateToken = async (
  token: string,
  env: AuthEnv,
  audience?: string,
): Promise<RequestUser> => {
  const expectedAudience = audience ?? env.AUTH0_AUDIENCE;
  if (!expectedAudience) {
    throw new Error("No expected audience is configured; refusing to accept the token");
  }
  const issuerBaseUrl = env.AUTH0_ISSUER_BASE_URL;
  if (!issuerBaseUrl) {
    throw new Error("No Auth0 issuer is configured; refusing to accept the token");
  }
  const issuer = issuerBaseUrl.endsWith("/") ? issuerBaseUrl : `${issuerBaseUrl}/`;
  const jwksUri = `${issuer}.well-known/jwks.json`;

  const { header } = decode(token);
  const keys = await getSigningKeys(jwksUri, typeof header.kid === "string" ? header.kid : undefined);

  const payload = await verifyWithJwks(token, {
    keys,
    allowedAlgorithms: ["RS256"],
    verification: { iss: issuer },
  });

  // hono only checks `exp` when present; an Auth0 token always has one.
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    throw new Error("Token has no `exp` claim");
  }

  if (!matchesAudience(payload.aud, expectedAudience)) {
    throw new Error(`Invalid audience: expected ${expectedAudience}, got ${String(payload.aud)}`);
  }

  if (payload.iss !== issuer) {
    throw new Error(`Invalid issuer: expected ${issuer}, got ${String(payload.iss)}`);
  }

  return normalizeUser(payload as unknown as Auth0User);
};

/** @internal for tests: forget cached signing keys. */
export const __jwksTestUtils = {
  clear: () => {
    jwksCache.clear();
    inflight.clear();
  },
};
