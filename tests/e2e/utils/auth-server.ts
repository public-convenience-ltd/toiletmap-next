import { createPublicKey, generateKeyPairSync, randomBytes } from 'crypto';
import type { JsonWebKey } from 'crypto';
import { createServer, Server } from 'http';
import jwt, { type JwtPayload } from 'jsonwebtoken';

type IssueTokenOptions = {
  audience?: string;
  expiresIn?: jwt.SignOptions['expiresIn'];
};

export class TestAuthServer {
  private server: Server | null = null;
  private readonly port: number;

  private readonly kid = `test-${randomBytes(4).toString('hex')}`;
  private readonly privateKeyPem: string;
  private readonly jwk: JsonWebKey & { kid: string; use: string; alg: string };

  constructor(port = 44555) {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const jwk = createPublicKey(publicKey).export({
      format: 'jwk',
    }) as JsonWebKey;

    this.privateKeyPem = privateKey;
    this.jwk = {
      ...jwk,
      kid: this.kid,
      use: 'sig',
      alg: 'RS256',
    };
    this.port = port;
  }

  async start() {
    if (this.server) return;

    this.server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/.well-known/jwks.json') {
        const payload = JSON.stringify({ keys: [this.jwk] });
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(payload);
        return;
      }

      res.statusCode = 404;
      res.end();
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(this.port, '127.0.0.1', resolve);
    });
  }

  get issuer() {
    return `http://127.0.0.1:${this.port}/`;
  }

  issueToken(
    payload: JwtPayload & { sub: string },
    options: IssueTokenOptions = {},
  ) {
    if (!this.server) {
      throw new Error('Auth server not started');
    }

    const audience = options.audience ?? process.env.AUTH0_AUDIENCE;
    if (!audience) {
      throw new Error('AUTH0_AUDIENCE is not set');
    }

    return jwt.sign(payload, this.privateKeyPem, {
      algorithm: 'RS256',
      audience,
      issuer: this.issuer,
      keyid: this.kid,
      expiresIn: options.expiresIn ?? '1h',
    });
  }

  async stop() {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
    this.server = null;
  }
}
