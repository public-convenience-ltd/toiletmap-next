import { createMiddleware } from 'hono/factory';
import jwt, { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { env } from '../env';
import { AppVariables, Auth0User } from '../types';

const client = jwksClient({
  jwksUri: env.auth0.jwksUri,
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

    const signingKey = key.getPublicKey();
    return callback(null, signingKey);
  });
};

const verifyToken = (token: string) =>
  new Promise<Auth0User>((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        audience: env.auth0.audience,
        issuer: env.auth0.issuerBaseUrl,
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

export const requireAuth = createMiddleware<{ Variables: AppVariables }>(
  async (c, next) => {
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
      const user = await verifyToken(token);
      c.set('user', user);
    } catch (error) {
      console.error('Auth0 verification failed', error);
      return c.json({ message: 'Unauthorized' }, 401);
    }

    return next();
  },
);
