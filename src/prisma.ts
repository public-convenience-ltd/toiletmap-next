import { PrismaPg } from "@prisma/adapter-pg";
import { withAccelerate } from "@prisma/extension-accelerate";
import { PrismaClient } from "./generated/prisma/client";

const adapter = new PrismaPg({
  connectionString: process.env.POSTGRES_URI,
});

const prismaClientSingleton = () => {
  const prisma = new PrismaClient({
    adapter,
    log: ["info"],
  });

  prisma.$extends(withAccelerate());

  return prisma;
};

export type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientSingleton | undefined;
};

export const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

export { Prisma, toilets, areas } from "./generated/prisma/client";

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;