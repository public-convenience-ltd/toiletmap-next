import { createMiddleware } from 'hono/factory';
import jwt, { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { AppVariables, Auth0User, Env, RequestUser } from '../types';

const getJwksUri = (issuerBaseUrl: string) => {
  const base = issuerBaseUrl.endsWith('/')
    ? issuerBaseUrl.replace(/\/+$/, '')
    : issuerBaseUrl;
  return `${base}/.well-known/jwks.json`;
};

const verifyToken = (
  token: string,
  audience: string,
  issuerBaseUrl: string,
) =>
  new Promise<Auth0User>((resolve, reject) => {
    const issuer = issuerBaseUrl.endsWith('/')
      ? issuerBaseUrl
      : `${issuerBaseUrl}/`;

    const client = jwksClient({
      jwksUri: getJwksUri(issuerBaseUrl),
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 10 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });

    const getKey = (header: JwtHeader, callback: SigningKeyCallback) => {
      if (!header.kid) {
        return callback(
          new Error('Missing kid in token header'),
          undefined,
        );
      }

      client.getSigningKey(header.kid, (err, key) => {
        if (err) {
          return callback(err, undefined);
        }

        if (!key) {
          return callback(new Error('No signing key returned'), undefined);
        }

        const signingKey = key.getPublicKey();
        return callback(null, signingKey);
      });
    };

    jwt.verify(
      token,
      getKey,
      {
        audience,
        issuer,
        algorithms: ['RS256'],
      },
      (err, decoded) => {
        if (err) {
          return reject(err);
        }

        resolve(decoded as Auth0User);
      },
    );
  });

export const requireAuth = createMiddleware<{
  Variables: AppVariables;
  Bindings: Env;
}>(async (c, next) => {
  const authorizationHeader =
    c.req.header('authorization') ?? c.req.header('Authorization');

  if (!authorizationHeader?.startsWith('Bearer ')) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  const token = authorizationHeader.slice(7).trim();

  if (!token) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  try {
    const user = await verifyToken(
      token,
      c.env.AUTH0_AUDIENCE,
      c.env.AUTH0_ISSUER_BASE_URL,
    );
    const subject = typeof user?.sub === 'string' ? user.sub.trim() : null;
    if (!subject) {
      console.error('Auth0 token missing `sub` claim');
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const normalizedPermissions = Array.isArray(user.permissions)
      ? user.permissions.filter(
          (permission): permission is string => typeof permission === 'string',
        )
      : undefined;

    const normalizedUser: RequestUser = {
      ...user,
      sub: subject,
      permissions: normalizedPermissions,
    };

    c.set('user', normalizedUser);
  } catch (error) {
    console.error('Auth0 verification failed', error);
    return c.json({ message: 'Unauthorized' }, 401);
  }

  return next();
});
