import { PrismaPg } from "@prisma/adapter-pg";
import type {
  PrismaClient as PrismaClientType,
  Prisma as PrismaNamespace,
} from "./generated/prisma/client";

// Use test-compatible client in Node.js test environment, Cloudflare client otherwise
const isTestEnv =
  process.env.NODE_ENV === "test" || process.env.VITEST === "true";
const clientModule = isTestEnv
  ? await import("../test/integration/generated/client/client")
  : await import("./generated/prisma/client");

const { PrismaClient, Prisma } = clientModule as {
  PrismaClient: typeof PrismaClientType;
  Prisma: typeof PrismaNamespace;
};

export const createPrismaClient = (databaseUrl: string): PrismaClientType => {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
  });

  const prisma = new PrismaClient({
    adapter,
    log: ["info"],
  });

  return prisma;
};

export type PrismaClientInstance = ReturnType<typeof createPrismaClient>;

export { Prisma };
export type { toilets, areas } from "./generated/prisma/client";
