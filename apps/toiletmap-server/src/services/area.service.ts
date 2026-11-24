import { Prisma, type PrismaClientInstance } from "../prisma";

/**
 * Fetches all administrative areas that can be associated with loos.
 * Kept as a tiny service so route handlers stay focused on HTTP concerns.
 */
export const listAreas = (prisma: PrismaClientInstance) =>
  prisma.areas.findMany({
    select: {
      name: true,
      type: true,
    },
  });

export type AreaToiletCount = { name: string | null; active: number; removed: number };

export type ToiletStatistics = {
  /** Every toilets row. */
  total: number;
  /** `active = true`. */
  active: number;
  /** `active = false` (rows with a null `active` count in `total` only). */
  removed: number;
  /** One entry per area, including areas with no toilets, ordered by name. */
  areaToiletCount: AreaToiletCount[];
};

/**
 * Dataset-wide toilet counts, overall and per area (the legacy GraphQL
 * `statistics` query). Two aggregate statements in one transaction.
 */
export const getToiletStatistics = async (
  prisma: PrismaClientInstance,
): Promise<ToiletStatistics> => {
  const [totals, perArea] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ total: number; active: number; removed: number }>>(Prisma.sql`
      SELECT
        count(*)::int AS total,
        (count(*) FILTER (WHERE active IS TRUE))::int AS active,
        (count(*) FILTER (WHERE active IS FALSE))::int AS removed
      FROM toilets
    `),
    prisma.$queryRaw<AreaToiletCount[]>(Prisma.sql`
      SELECT
        area.name,
        (count(loo.id) FILTER (WHERE loo.active IS TRUE))::int AS active,
        (count(loo.id) FILTER (WHERE loo.active IS FALSE))::int AS removed
      FROM areas area
      LEFT JOIN toilets loo ON loo.area_id = area.id
      GROUP BY area.id, area.name
      ORDER BY area.name ASC NULLS LAST, area.id ASC
    `),
  ]);

  const [row] = totals;
  return {
    total: row?.total ?? 0,
    active: row?.active ?? 0,
    removed: row?.removed ?? 0,
    areaToiletCount: perArea.map(({ name, active, removed }) => ({ name, active, removed })),
  };
};
