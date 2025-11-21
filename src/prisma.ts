import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export const createPrismaClient = () => {
  const adapter = new PrismaPg({
    connectionString: process.env.POSTGRES_URI,
  });

  const prisma = new PrismaClient({
    adapter,
    log: ["info"],
  });

  return prisma;
};

export type PrismaClientInstance = ReturnType<typeof createPrismaClient>;

export { Prisma, toilets, areas } from "./generated/prisma/client";