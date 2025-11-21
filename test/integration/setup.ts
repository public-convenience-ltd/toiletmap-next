import 'dotenv/config';
import { beforeAll, afterAll } from 'vitest';
import { startAuthServer, type IssueTokenFn } from './utils/auth-server';

const state: {
  issueToken: IssueTokenFn | null;
  stopAuthServer: (() => Promise<void>) | null;
} = {
  issueToken: null,
  stopAuthServer: null,
};

const getDatabaseUrl = () => {
  const url = process.env.POSTGRES_TEST_URI ?? process.env.POSTGRES_URI;
  if (!url) {
    throw new Error(
      'Set POSTGRES_URI in your environment before running integration tests.',
    );
  }
  return url;
};

const waitForSidecar = async () => {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    try {
      const res = await fetch('http://localhost:3001/healthcheck');
      if (res.ok) return;
      console.log('Sidecar healthcheck status:', res.status);
    } catch (e) {
      console.log('Sidecar connection failed:', e.message);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Sidecar failed to start');
};

beforeAll(async () => {
  const databaseUrl = getDatabaseUrl();
  process.env.POSTGRES_URI = databaseUrl;

  const audience = process.env.AUTH0_AUDIENCE ?? 'https://integration.toiletmap/api';
  process.env.AUTH0_AUDIENCE = audience;

  const authServer = await startAuthServer({ audience });
  process.env.AUTH0_ISSUER_BASE_URL = authServer.issuer;
  process.env.AUTH0_PROFILE_KEY = 'app_metadata';

  await waitForSidecar();

  state.issueToken = authServer.issueToken;
  state.stopAuthServer = authServer.stop;
});

afterAll(async () => {
  if (state.stopAuthServer) {
    await state.stopAuthServer();
  }
});

export const getTestContext = () => {
  if (!state.issueToken) {
    throw new Error('Integration test context is not ready yet.');
  }
  return {
    issueToken: state.issueToken,
  };
};
