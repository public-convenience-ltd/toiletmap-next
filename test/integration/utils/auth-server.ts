import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

export type IssueTokenFn = (claims?: Record<string, unknown>) => string;

export type AuthServer = {
  issuer: string;
  issueToken: IssueTokenFn;
  stop: () => Promise<void>;
};

type StartAuthServerOptions = {
  audience: string;
};

/**
 * Starts a tiny JWKS server so integration tests can exercise the Auth0 middleware end-to-end.
 */
export const startAuthServer = async (
  options: StartAuthServerOptions,
): Promise<AuthServer> => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  const kid = randomUUID();
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, string>;
  const publicJwk = {
    ...jwk,
    kid,
    alg: 'RS256',
    use: 'sig',
  };

  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/.well-known/jwks.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'Not Found' }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  const issuer = `http://127.0.0.1:${address.port}`;
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs1' });

  const issueToken: IssueTokenFn = (claims = {}) => {
    const defaults = {
      sub: 'auth0|integration-test-user',
      nickname: 'integration-test-user',
      name: 'Integration Tester',
      app_metadata: {
        nickname: 'integration-tester',
      },
    } satisfies Record<string, unknown>;

    const { aud, ...restClaims } = claims;
    const payload = { ...defaults, ...restClaims };

    return jwt.sign(payload, privateKeyPem, {
      algorithm: 'RS256',
      keyid: kid,
      audience: (aud as string) || options.audience,
      issuer: `${issuer}/`,
    });
  };

  return {
    issuer: `${issuer}/`,
    issueToken,
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      }),
  };
};
