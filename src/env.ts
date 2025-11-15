import { config as loadEnv } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

const projectRoot = resolve(__dirname, '..');
const candidateEnvFiles = [
  resolve(projectRoot, '.env.local'),
  resolve(projectRoot, '.env'),
];

for (const file of candidateEnvFiles) {
  if (existsSync(file)) {
    loadEnv({ path: file, override: false });
  }
}

const requiredVars = [
  'POSTGRES_URI',
  'AUTH0_ISSUER_BASE_URL',
  'AUTH0_AUDIENCE',
] as const;

type RequiredVar = (typeof requiredVars)[number];

const missingVars = requiredVars.filter((key) => !process.env[key]);

if (missingVars.length > 0) {
  throw new Error(
    `Missing required environment variables for hono-api: ${missingVars.join(', ')}`,
  );
}

const optionalEnv = (key: string): string | null => {
  const value = process.env[key];
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const issuerBaseUrl = (() => {
  const base = process.env.AUTH0_ISSUER_BASE_URL as string;
  return base.endsWith('/') ? base : `${base}/`;
})();

const issuerBaseUrlWithoutTrailingSlash = issuerBaseUrl.replace(
  /\/+$/,
  '',
);

export const env = {
  port: Number.parseInt(process.env.PORT ?? '4001', 10),
  postgresUri: process.env.POSTGRES_URI as string,
  auth0: {
    audience: process.env.AUTH0_AUDIENCE as string,
    issuerBaseUrl,
    jwksUri: `${issuerBaseUrlWithoutTrailingSlash}/.well-known/jwks.json`,
    dataExplorer: {
      clientId: optionalEnv('AUTH0_DATA_EXPLORER_CLIENT_ID'),
      scope:
        optionalEnv('AUTH0_DATA_EXPLORER_SCOPE') ??
        'openid profile email offline_access',
      redirectUri: optionalEnv('AUTH0_DATA_EXPLORER_REDIRECT_URI'),
    },
  },
};
