import type { PrismaClientInstance } from '../../../src/prisma';

export const ensureDatabaseConnection = async (
  prisma: PrismaClientInstance,
) => {
  await prisma.$queryRaw`SELECT 1 as connection_test`;
};
