import { env } from 'cloudflare:test';
import { beforeAll, afterAll } from 'vitest';
import { createPrismaClient, type PrismaClientInstance } from '../../src/prisma';
import { ensureDatabaseConnection } from './utils/database';
import { startAuthServer, type IssueTokenFn } from './utils/auth-server';

const state: {
  prisma: PrismaClientInstance | null;
  issueToken: IssueTokenFn | null;
  stopAuthServer: (() => Promise<void>) | null;
} = {
  prisma: null,
  issueToken: null,
  stopAuthServer: null,
};

const getDatabaseUrl = () => {
  const url =
    process.env.POSTGRES_TEST_URI ??
    process.env.POSTGRES_URI ??
    env.POSTGRES_URI;
  if (!url) {
    throw new Error(
      'Set POSTGRES_URI in your environment before running integration tests.',
    );
  }
  return url;
};

beforeAll(async () => {
  const databaseUrl = getDatabaseUrl();
  env.POSTGRES_URI = databaseUrl;

  const audience = process.env.AUTH0_AUDIENCE ?? 'https://integration.toiletmap/api';
  env.AUTH0_AUDIENCE = audience;

  const authServer = await startAuthServer({ audience });
  env.AUTH0_ISSUER_BASE_URL = authServer.issuer;
  env.AUTH0_PROFILE_KEY = 'app_metadata';

  const prisma = createPrismaClient(databaseUrl);
  state.prisma = prisma;
  state.issueToken = authServer.issueToken;
  state.stopAuthServer = authServer.stop;
});

afterAll(async () => {
  if (state.prisma) {
    await state.prisma.$disconnect();
  }
  if (state.stopAuthServer) {
    await state.stopAuthServer();
  }
});

export const getTestContext = () => {
  if (!state.prisma || !state.issueToken) {
    throw new Error('Integration test context is not ready yet.');
  }
  return {
    prisma: state.prisma,
    issueToken: state.issueToken,
  };
};
