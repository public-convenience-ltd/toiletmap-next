import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export const createPrismaClient = (databaseUrl: string) => {
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

export { Prisma, type toilets, type areas } from "./generated/prisma/client";