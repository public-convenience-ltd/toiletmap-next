import "dotenv/config";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll } from "vitest";
import { createPrismaClient, type PrismaClientInstance } from "../../src/prisma";
import { type AuthServer, type IssueTokenFn, startAuthServer } from "./utils/auth-server";
import { cleanupManager } from "./utils/cleanup";
import { getTestDatabaseUrl, testProcessEnv } from "./utils/env";

const state: {
  issueToken: IssueTokenFn | null;
  stopAuthServer: (() => Promise<void>) | null;
  prisma: PrismaClientInstance | null;
} = {
  issueToken: null,
  stopAuthServer: null,
  prisma: null,
};

const MIGRATIONS_DIR = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));

/**
 * Fails fast when the local database is missing migrations from
 * `supabase/migrations`, which otherwise surfaces as confusing Prisma
 * "column does not exist" errors deep inside unrelated tests.
 *
 * Skipped when the database has no Supabase migration history table
 * (e.g. a plain Postgres pointed at via the connection-string override).
 */
const assertMigrationsApplied = async (prisma: PrismaClientInstance) => {
  const [{ tracked }] = await prisma.$queryRaw<{ tracked: boolean }[]>`
    SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS tracked
  `;
  if (!tracked) return;

  const applied = await prisma.$queryRaw<{ version: string }[]>`
    SELECT version FROM supabase_migrations.schema_migrations
  `;
  const appliedVersions = new Set(applied.map((row) => row.version));
  const missing = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .filter((file) => !appliedVersions.has(file.split("_")[0] ?? ""));

  if (missing.length > 0) {
    throw new Error(
      `Local database is missing migrations: ${missing.join(", ")}. ` +
        "Run `pnpm exec supabase migration up --local` in apps/toiletmap-server " +
        "(non-destructive), or `pnpm supabase:reset` to rebuild the database.",
    );
  }
};

beforeAll(async () => {
  const databaseUrl = getTestDatabaseUrl();

  const audience = testProcessEnv.AUTH0_AUDIENCE ?? "https://integration.toiletmap/api";
  testProcessEnv.AUTH0_AUDIENCE = audience;

  const authServer: AuthServer = await startAuthServer({ audience });
  testProcessEnv.AUTH0_ISSUER_BASE_URL = authServer.issuer;
  testProcessEnv.AUTH0_PROFILE_KEY = "app_metadata";
  testProcessEnv.AUTH0_CLIENT_ID = "integration-test-client-id";

  // In-memory stand-in for the Cloudflare `caches.default` Cache API.
  const cacheStore = new Map<string, Response>();
  const cacheKey = (request: RequestInfo | URL) =>
    typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
  const defaultCache: Pick<Cache, "match" | "put" | "delete"> = {
    match: (request) => Promise.resolve(cacheStore.get(cacheKey(request))?.clone()),
    put: (request, response) => {
      cacheStore.set(cacheKey(request), response.clone());
      return Promise.resolve();
    },
    delete: (request) => Promise.resolve(cacheStore.delete(cacheKey(request))),
  };
  Object.defineProperty(globalThis, "caches", {
    value: { default: defaultCache },
    configurable: true,
    writable: true,
  });

  const prisma = createPrismaClient(databaseUrl);
  let ready = false;
  try {
    try {
      // With the pg driver adapter `$connect()` is lazy, so a round-trip is
      // needed to tell an unreachable database apart from other failures.
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      throw new Error(
        `Could not reach the test database at ${new URL(databaseUrl).host}. ` +
          "Start local Supabase with `pnpm supabase:start` in apps/toiletmap-server.",
        { cause: error },
      );
    }
    // Migration-check failures (missing migrations, query errors) propagate as-is.
    await assertMigrationsApplied(prisma);
    ready = true;
  } finally {
    if (!ready) {
      await prisma.$disconnect();
      await authServer.stop();
    }
  }
  state.prisma = prisma;

  state.issueToken = authServer.issueToken;
  state.stopAuthServer = authServer.stop;
});

afterAll(async () => {
  if (state.stopAuthServer) {
    await state.stopAuthServer();
  }
  if (state.prisma) {
    // Create a privileged client for cleanup
    const adminUrl = new URL(getTestDatabaseUrl());
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
