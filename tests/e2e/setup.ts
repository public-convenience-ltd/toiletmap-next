import { existsSync } from 'fs';
import { resolve } from 'path';
import { config as loadEnv } from 'dotenv';
import { beforeAll, afterAll } from 'vitest';
import { TestAuthServer } from './utils/auth-server';

const projectRoot = resolve(__dirname, '../..');
const envCandidates = [
  '.env.test.local',
  '.env.test',
  '.env.local',
  '.env',
].map((file) => resolve(projectRoot, file));

for (const file of envCandidates) {
  if (existsSync(file)) {
    loadEnv({ path: file, override: false });
  }
}

if (!process.env.POSTGRES_URI) {
  throw new Error(
    'POSTGRES_URI must be set. Start Supabase (pnpm supabase:start) and ensure your .env file exists.',
  );
}

process.env.NODE_ENV ??= 'test';
process.env.AUTH0_AUDIENCE ??= 'toiletmap-e2e';
process.env.AUTH0_PROFILE_KEY ??= '';

const randomAuthPort = 45000 + Math.floor(Math.random() * 5000);
const authServer = new TestAuthServer(randomAuthPort);
process.env.AUTH0_ISSUER_BASE_URL = authServer.issuer;

const startPromise = authServer.start();

declare global {
  // eslint-disable-next-line no-var
  var __AUTH_SERVER__: TestAuthServer | undefined;
}

beforeAll(async () => {
  await startPromise;
  globalThis.__AUTH_SERVER__ = authServer;
});

afterAll(async () => {
  await authServer.stop();
  globalThis.__AUTH_SERVER__ = undefined;
});
