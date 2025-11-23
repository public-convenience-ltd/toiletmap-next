import jwt, { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { Auth0User, Env, RequestUser } from '../types';

const getJwksUri = (issuerBaseUrl: string) => {
    const base = issuerBaseUrl.endsWith('/')
        ? issuerBaseUrl.replace(/\/+$/, '')
        : issuerBaseUrl;
    return `${base}/.well-known/jwks.json`;
};

export const verifyToken = (
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

export const normalizeUser = (user: Auth0User): RequestUser => {
    const subject = typeof user?.sub === 'string' ? user.sub.trim() : null;
    if (!subject) {
        throw new Error('Auth0 token missing `sub` claim');
    }

    const normalizedPermissions = Array.isArray(user.permissions)
        ? user.permissions.filter(
            (permission): permission is string =>
                typeof permission === 'string',
        )
        : undefined;

    return {
        ...user,
        sub: subject,
        permissions: normalizedPermissions,
    };
};

export const authenticateToken = async (
    token: string,
    env: Pick<Env, 'AUTH0_AUDIENCE' | 'AUTH0_ISSUER_BASE_URL'>,
    audience?: string,
): Promise<RequestUser> => {
    const user = await verifyToken(
        token,
        audience ?? env.AUTH0_AUDIENCE,
        env.AUTH0_ISSUER_BASE_URL,
    );
    return normalizeUser(user);
};
