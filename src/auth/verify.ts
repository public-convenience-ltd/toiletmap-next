import { verifyWithJwks } from "hono/jwt";
import { Auth0User, Env, RequestUser } from "../types";

const matchesAudience = (claim: unknown, expected: string): boolean => {
  if (!expected) {
    return true;
  }

  if (Array.isArray(claim)) {
    return claim.includes(expected);
  }

  if (typeof claim === "string") {
    if (claim === expected) {
      return true;
    }

    // Auth0 may return a comma or space-delimited string when multiple audiences are present
    const parts = claim
      .split(/[,\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.length > 1 ? parts.includes(expected) : false;
  }

  return false;
};

const verifyToken = async (
  token: string,
  audience: string,
  issuerBaseUrl: string
): Promise<Auth0User> => {
  const issuer = issuerBaseUrl.endsWith("/")
    ? issuerBaseUrl
    : `${issuerBaseUrl}/`;

  try {
    // Use Hono's built-in JWKS verification
    // JWKS are automatically fetched and cached
    const payload = await verifyWithJwks(token, {
      jwks_uri: `${issuerBaseUrl.replace(/\/$/, "")}/.well-known/jwks.json`,
    });

    // Validate audience claim (allow Auth0 multi-audience tokens)
    if (audience && !matchesAudience(payload.aud, audience)) {
      throw new Error(
        `Invalid audience: expected ${audience}, got ${payload.aud}`
      );
    }

    // Validate issuer claim
    if (payload.iss !== issuer) {
      throw new Error(`Invalid issuer: expected ${issuer}, got ${payload.iss}`);
    }

    return payload as unknown as Auth0User;
  } catch (error) {
    console.error("Token verification failed:", error);
    throw error;
  }
};

const normalizeUser = (user: Auth0User): RequestUser => {
  const subject = typeof user?.sub === "string" ? user.sub.trim() : null;
  if (!subject) {
    throw new Error("Auth0 token missing `sub` claim");
  }

  const normalizeString = (value?: string | null) =>
    typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : undefined;

  const normalizedPermissions = Array.isArray(user.permissions)
    ? user.permissions.filter(
        (permission): permission is string => typeof permission === "string"
      )
    : undefined;

  return {
    ...user,
    sub: subject,
    name: normalizeString(user.name) ?? undefined,
    nickname: normalizeString(user.nickname) ?? undefined,
    email: normalizeString(user.email) ?? undefined,
    permissions: normalizedPermissions,
  };
};

export const authenticateToken = async (
  token: string,
  env: Pick<Env, "AUTH0_AUDIENCE" | "AUTH0_ISSUER_BASE_URL">,
  audience?: string
): Promise<RequestUser> => {
  const user = await verifyToken(
    token,
    audience ?? env.AUTH0_AUDIENCE,
    env.AUTH0_ISSUER_BASE_URL
  );
  return normalizeUser(user);
};
