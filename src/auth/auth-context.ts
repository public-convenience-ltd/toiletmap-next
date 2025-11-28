import { Context } from 'hono';
import { AppVariables, Env, RequestUser } from '../types';
import { authenticateToken } from './verify';
import { clearSessionCookies, getSession, SessionData, SessionUser } from './session';
import { fetchUserInfo as fetchAuth0UserInfo } from './userinfo';
import { logger } from '../utils/logger';

type AuthenticatedContext = Context<{ Bindings: Env; Variables: AppVariables }>;

type AuthSource =
  | 'authorization-header'
  | 'session-access-token'
  | 'session-id-token';

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
  c.req.header('authorization') ?? c.req.header('Authorization') ?? null;

const extractBearerToken = (headerValue: string | null) => {
  if (!headerValue?.startsWith('Bearer ')) {
    return null;
  }
  const token = headerValue.slice(7).trim();
  return token || null;
};

type ProfileSource = SessionUser | Record<string, unknown> | null | undefined;

const mergeProfile = (
  user: RequestUser,
  profile?: ProfileSource,
): RequestUser => {
  if (!profile) {
    return user;
  }

  const sanitizedProfile = Object.fromEntries(
    Object.entries(profile).filter(
      ([, value]) =>
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
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

const shouldFetchUserInfo = (options?: AuthOptions) =>
  options?.fetchUserInfo !== false;

const enrichUser = async (
  c: AuthenticatedContext,
  user: RequestUser,
  params: {
    accessToken?: string | null;
    sessionProfile?: SessionUser | null;
    options?: AuthOptions;
  },
): Promise<RequestUser> => {
  if (params.sessionProfile) {
    return mergeProfile(user, params.sessionProfile);
  }

  if (!shouldFetchUserInfo(params.options)) {
    return user;
  }

  const profile = await fetchAuth0UserInfo(
    params.accessToken,
    c.env.AUTH0_ISSUER_BASE_URL,
  );
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
  const user = await authenticateToken(
    token,
    c.env,
    options?.audience ?? c.env.AUTH0_AUDIENCE,
  );
  return {
    user: await enrichUser(c, user, {
      accessToken: token,
      options,
    }),
    token,
    source: 'authorization-header',
  };
};

const authenticateWithSession = async (
  c: AuthenticatedContext,
  session: SessionData,
  options?: AuthOptions,
): Promise<AuthResult | null> => {
  if (session.accessToken) {
    try {
      const user = await authenticateToken(
        session.accessToken,
        c.env,
        options?.audience ?? c.env.AUTH0_AUDIENCE,
      );
      return {
        user: await enrichUser(c, user, {
          accessToken: session.accessToken,
          sessionProfile: session.user,
          options,
        }),
        token: session.accessToken,
        source: 'session-access-token',
        session,
      };
    } catch (error) {
      if (!session.idToken) {
        throw error;
      }
      if (error instanceof Error) {
        logger.warn('Session access token verification failed, falling back to id_token', {
          errorName: error.name,
          errorMessage: error.message,
        });
      } else {
        logger.warn('Session access token verification failed, falling back to id_token', {
          errorMessage: String(error),
        });
      }
    }
  }

  if (session.idToken) {
    try {
      const user = await authenticateToken(
        session.idToken,
        c.env,
        c.env.AUTH0_CLIENT_ID,
      );
      return {
        user: await enrichUser(c, user, {
          sessionProfile: session.user,
          options,
        }),
        token: session.idToken,
        source: 'session-id-token',
        session,
      };
    } catch (error) {
      if (error instanceof Error) {
        logger.warn('Session id token verification failed, clearing session', {
          errorName: error.name,
          errorMessage: error.message,
        });
      } else {
        logger.warn('Session id token verification failed, clearing session', {
          errorMessage: String(error),
        });
      }
      clearSessionCookies(c);
      return null;
    }
  }

  return null;
};

export const authenticateRequest = async (
  c: AuthenticatedContext,
  options?: AuthOptions,
): Promise<AuthResult | null> => {
  const headerToken = extractBearerToken(getAuthorizationHeader(c));
  if (headerToken) {
    return authenticateBearer(c, headerToken, options);
  }

  const session = getSession(c);
  if (!session) {
    return null;
  }

  return authenticateWithSession(c, session, options);
};
