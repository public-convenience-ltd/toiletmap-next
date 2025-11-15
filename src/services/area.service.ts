import { prisma } from '../prisma';

/**
 * Fetches all administrative areas that can be associated with loos.
 * Kept as a tiny service so route handlers stay focused on HTTP concerns.
 */
export const listAreas = () =>
  prisma.areas.findMany({
    select: {
      name: true,
      type: true,
    },
  });
