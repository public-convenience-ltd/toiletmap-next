import { PrismaPg } from "@prisma/adapter-pg";
import type { PrismaClient as PrismaClientType } from "./generated/prisma/client";

// Directly import and re-export Prisma namespace for type resolution
import { Prisma } from "./generated/prisma/client";
export { Prisma };

// Use test-compatible client in Node.js test environment, Cloudflare client otherwise
const isTestEnv =
  process.env.NODE_ENV === "test" || process.env.VITEST === "true";
const clientModule = isTestEnv
  ? await import("../test/integration/generated/client/client")
  : await import("./generated/prisma/client");

const { PrismaClient } = clientModule as {
  PrismaClient: typeof PrismaClientType;
};

/**
 * Create a Prisma client with connection pooling. Each invocation returns a
 * fresh client so Cloudflare Workers do not keep open TCP connections when an
 * isolate is suspended.
 */
export const createPrismaClient = (databaseUrl: string): PrismaClientType => {
  const adapter = new PrismaPg({ connectionString: databaseUrl });

  const prisma = new PrismaClient({
    adapter,
    log: isTestEnv ? [] : ["info"], // Reduce log noise in tests
  });

  return prisma;
};

export type PrismaClientInstance = ReturnType<typeof createPrismaClient>;

export type { toilets, areas } from "./generated/prisma/client";
