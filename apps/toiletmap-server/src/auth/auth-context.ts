import type { Context } from "hono";
import type { AppVariables, AuthSource, Env, RequestUser } from "../types";
import { logger } from "../utils/logger";
import { clearSessionCookies, getSession, type SessionData } from "./session";
import { fetchUserInfo as fetchAuth0UserInfo } from "./userinfo";
import { authenticateToken, JwksUnavailableError } from "./verify";

type AuthenticatedContext = Context<{ Bindings: Env; Variables: AppVariables }>;

export interface AuthResult {
  user: RequestUser;
  token: string;
  source: AuthSource;
  session?: SessionData | null;
}

export interface AuthOptions {
  audience?: string;
  fetchUserInfo?: boolean;
}

const getAuthorizationHeader = (c: AuthenticatedContext) =>
  c.req.header("authorization") ?? c.req.header("Authorization") ?? null;

const extractBearerToken = (headerValue: string | null) => {
  if (!headerValue?.startsWith("Bearer ")) {
    return null;
  }
  const token = headerValue.slice(7).trim();
  return token || null;
};

/** Whether the request sends `Authorization: Bearer <token>`. */
export const hasBearerToken = (c: AuthenticatedContext): boolean =>
  extractBearerToken(getAuthorizationHeader(c)) !== null;

type ProfileSource = Record<string, unknown> | null | undefined;

const mergeProfile = (user: RequestUser, profile?: ProfileSource): RequestUser => {
  if (!profile) {
    return user;
  }

  const sanitizedProfile = Object.fromEntries(
    Object.entries(profile).filter(
      ([, value]) =>
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null ||
        value === undefined,
    ),
  );

  return {
    ...user,
    ...sanitizedProfile,
    sub: user.sub,
    profile: {
      ...(user.profile ?? {}),
      ...sanitizedProfile,
    },
  };
};

/** The profile claims taken from a verified id_token. */
const ID_TOKEN_PROFILE_CLAIMS = ["name", "nickname", "email"] as const;

const shouldFetchUserInfo = (options?: AuthOptions) => options?.fetchUserInfo !== false;

const errorDetails = (error: unknown) =>
  error instanceof Error
    ? { errorName: error.name, errorMessage: error.message }
    : { errorMessage: String(error) };

/**
 * The profile claims (name, nickname, email) of the session's id_token, once
 * verified (signature, issuer, audience = AUTH0_CLIENT_ID, expiry) and only
 * when it belongs to the same user as the access token. `null` otherwise.
 */
const profileFromIdToken = async (
  c: AuthenticatedContext,
  idToken: string | undefined,
  sub: string,
): Promise<Record<string, string> | null> => {
  if (!idToken) return null;
  try {
    const claims = await authenticateToken(idToken, c.env, c.env.AUTH0_CLIENT_ID);
    if (claims.sub !== sub) {
      logger.warn("Session id_token belongs to a different user; ignoring its profile");
      return null;
    }
    const profile: Record<string, string> = {};
    for (const key of ID_TOKEN_PROFILE_CLAIMS) {
      const value = claims[key];
      if (typeof value === "string" && value) profile[key] = value;
    }
    return profile;
  } catch (error) {
    logger.warn(
      "Session id_token could not be verified; ignoring its profile",
      errorDetails(error),
    );
    return null;
  }
};

const enrichUser = async (
  c: AuthenticatedContext,
  user: RequestUser,
  params: {
    accessToken?: string | null;
    idToken?: string;
    options?: AuthOptions;
  },
): Promise<RequestUser> => {
  const idTokenProfile = await profileFromIdToken(c, params.idToken, user.sub);
  if (idTokenProfile) {
    return mergeProfile(user, idTokenProfile);
  }

  if (!shouldFetchUserInfo(params.options)) {
    return user;
  }

  const profile = await fetchAuth0UserInfo(params.accessToken, c.env.AUTH0_ISSUER_BASE_URL);
  if (!profile) {
    return user;
  }

  return mergeProfile(user, profile);
};

const authenticateBearer = async (
  c: AuthenticatedContext,
  token: string,
  options?: AuthOptions,
): Promise<AuthResult> => {
  const user = await authenticateToken(token, c.env, options?.audience ?? c.env.AUTH0_AUDIENCE);
  return {
    user: await enrichUser(c, user, {
      accessToken: token,
      options,
    }),
    token,
    source: "authorization-header",
  };
};

/**
 * Authenticates a cookie session by its access token alone. The id_token is
 * never a credential: it only supplies profile claims. A session whose access
 * token does not verify is cleared, except when the signing keys could not be
 * fetched (an Auth0 outage says nothing about the session).
 */
const authenticateWithSession = async (
  c: AuthenticatedContext,
  session: SessionData,
  options?: AuthOptions,
): Promise<AuthResult | null> => {
  let user: RequestUser;
  try {
    user = await authenticateToken(
      session.accessToken,
      c.env,
      options?.audience ?? c.env.AUTH0_AUDIENCE,
    );
  } catch (error) {
    if (error instanceof JwksUnavailableError) throw error;
    logger.warn("Session access token verification failed, clearing session", errorDetails(error));
    clearSessionCookies(c);
    return null;
  }

  return {
    user: await enrichUser(c, user, {
      accessToken: session.accessToken,
      idToken: session.idToken,
      options,
    }),
    token: session.accessToken,
    source: "session-access-token",
    session,
  };
};

export const authenticateRequest = (
  c: AuthenticatedContext,
  options?: AuthOptions,
): Promise<AuthResult | null> => {
  const headerToken = extractBearerToken(getAuthorizationHeader(c));
  if (headerToken) {
    return authenticateBearer(c, headerToken, options);
  }

  const session = getSession(c);
  if (!session) {
    return Promise.resolve(null);
  }

  return authenticateWithSession(c, session, options);
};
