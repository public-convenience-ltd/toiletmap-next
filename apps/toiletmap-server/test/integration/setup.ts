import "dotenv/config";
import { afterAll, beforeAll } from "vitest";
import { createPrismaClient, type PrismaClientInstance } from "../../src/prisma";
import { type AuthServer, type IssueTokenFn, startAuthServer } from "./utils/auth-server";

const state: {
  issueToken: IssueTokenFn | null;
  stopAuthServer: (() => Promise<void>) | null;
  prisma: PrismaClientInstance | null;
} = {
  issueToken: null,
  stopAuthServer: null,
  prisma: null,
};

/**
 * Gets database URL for tests.
 * Uses CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TEST_HYPERDRIVE (matches TEST_HYPERDRIVE binding)
 * Falls back to default local Supabase connection.
 */
const getDatabaseUrl = () => {
  return (
    process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TEST_HYPERDRIVE ||
    "postgresql://postgres:postgres@localhost:54322/postgres"
  );
};

beforeAll(async () => {
  const databaseUrl = getDatabaseUrl();

  const audience = process.env.AUTH0_AUDIENCE ?? "https://integration.toiletmap/api";
  process.env.AUTH0_AUDIENCE = audience;

  const authServer: AuthServer = await startAuthServer({ audience });
  process.env.AUTH0_ISSUER_BASE_URL = authServer.issuer;
  process.env.AUTH0_PROFILE_KEY = "app_metadata";
  process.env.AUTH0_CLIENT_ID = "integration-test-client-id";

  const prisma = createPrismaClient(databaseUrl);
  await prisma.$connect();
  state.prisma = prisma;

  state.issueToken = authServer.issueToken;
  state.stopAuthServer = authServer.stop;
});

import { cleanupManager } from "./utils/cleanup";

afterAll(async () => {
  if (state.stopAuthServer) {
    await state.stopAuthServer();
  }
  if (state.prisma) {
    // Create a privileged client for cleanup
    const databaseUrl = getDatabaseUrl();
    const adminUrl = new URL(databaseUrl);
    adminUrl.username = "postgres";
    adminUrl.password = "postgres";

    const adminPrisma = createPrismaClient(adminUrl.toString());
    await adminPrisma.$connect();
    await cleanupManager.cleanup(adminPrisma);
    await adminPrisma.$disconnect();

    await state.prisma.$disconnect();
  }
});

export const getTestContext = () => {
  if (!state.issueToken || !state.prisma) {
    throw new Error("Integration test context is not ready yet.");
  }
  return {
    issueToken: state.issueToken,
    prisma: state.prisma,
  };
};

export const getPrismaClient = (): PrismaClientInstance => {
  if (!state.prisma) {
    throw new Error("Prisma client is not initialised for integration tests.");
  }
  return state.prisma;
};
