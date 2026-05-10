import { verifyWithJwks } from "hono/jwt";
import type { Auth0User, AuthEnv, RequestUser } from "./types";

const matchesAudience = (claim: unknown, expected: string): boolean => {
  if (!expected) return true;
  if (Array.isArray(claim)) return claim.includes(expected);
  if (typeof claim === "string") {
    if (claim === expected) return true;
    const parts = claim
      .split(/[,\s]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    return parts.length > 1 ? parts.includes(expected) : false;
  }
  return false;
};

const normalizeUser = (user: Auth0User): RequestUser => {
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

export const authenticateToken = async (
  token: string,
  env: AuthEnv,
  audience?: string,
): Promise<RequestUser> => {
  const expectedAudience = audience ?? env.AUTH0_AUDIENCE;
  const issuerBaseUrl = env.AUTH0_ISSUER_BASE_URL;
  const issuer = issuerBaseUrl.endsWith("/") ? issuerBaseUrl : `${issuerBaseUrl}/`;

  const payload = await verifyWithJwks(token, {
    jwks_uri: `${issuerBaseUrl.replace(/\/$/, "")}/.well-known/jwks.json`,
    allowedAlgorithms: ["RS256"],
  });

  if (expectedAudience && !matchesAudience(payload.aud, expectedAudience)) {
    throw new Error(`Invalid audience: expected ${expectedAudience}, got ${payload.aud}`);
  }

  if (payload.iss !== issuer) {
    throw new Error(`Invalid issuer: expected ${issuer}, got ${payload.iss}`);
  }

  return normalizeUser(payload as unknown as Auth0User);
};
