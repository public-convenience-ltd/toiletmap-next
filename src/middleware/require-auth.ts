import { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { AppVariables, Env } from '../types';
import { authenticateToken } from '../auth/verify';
import { getSession } from '../auth/session';

const readAuthorizationHeader = (value?: string | null) =>
  value ?? null;

const extractBearerToken = (headerValue: string | null) => {
  console.log(headerValue)
  if (!headerValue?.startsWith('Bearer ')) {
    return null;
  }
  const token = headerValue.slice(7).trim();
  return token || null;
};

const authenticateRequest = async (
  c: Context<{ Variables: AppVariables; Bindings: Env }>
) => {
  const headerValue =
    c.req.header('authorization') ?? c.req.header('Authorization');
  const headerToken = extractBearerToken(readAuthorizationHeader(headerValue));

  if (headerToken) {
    return await authenticateToken(headerToken, c.env);
  }

  const session = getSession(c);
  if (session) {
    // Try Access Token first
    if (session.accessToken) {
      try {
        return await authenticateToken(session.accessToken, c.env);
      } catch (error) {
        // If ID token is available, try that
        if (!session.idToken) throw error;
        console.log('Access token verification failed, trying ID token');
      }
    }

    // Try ID Token
    if (session.idToken) {
      return await authenticateToken(
        session.idToken,
        c.env,
        c.env.AUTH0_CLIENT_ID
      );
    }
  }

  return null;
};

export const optionalAuth = createMiddleware<{
  Variables: AppVariables;
  Bindings: Env;
}>(async (c, next) => {
  try {
    const user = await authenticateRequest(c);
    if (user) {
      c.set('user', user);
    }
  } catch (error) {
    console.error('Optional Auth0 verification failed', error);
    return c.json({ message: 'Unauthorized' }, 401);
  }

  return next();
});

export const requireAuth = createMiddleware<{
  Variables: AppVariables;
  Bindings: Env;
}>(async (c, next) => {
  try {
    const user = await authenticateRequest(c);
    if (!user) {
      return c.json({ message: 'Unauthorized' }, 401);
    }
    c.set('user', user);
  } catch (error) {
    console.error('Auth0 verification failed', error);
    return c.json({ message: 'Unauthorized' }, 401);
  }

  return next();
});
