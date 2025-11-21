import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

const clientCache = new Map<string, PrismaClient>();

export const createPrismaClient = (databaseUrl: string) => {
  const cached = clientCache.get(databaseUrl);
  if (cached) {
    return cached;
  }

  const adapter = new PrismaPg({
    connectionString: databaseUrl,
  });

  const prisma = new PrismaClient({
    adapter,
    log: ["info"],
  });

  clientCache.set(databaseUrl, prisma);
  return prisma;
};

export type PrismaClientInstance = ReturnType<typeof createPrismaClient>;

export { Prisma, type toilets, type areas } from "./generated/prisma/client";
