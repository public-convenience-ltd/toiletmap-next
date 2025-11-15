import { PrismaClient, Prisma } from '../generated/prisma-client';
import { prisma as defaultPrisma } from '../prisma';

export type AdminStatsResponse = {
  overview: {
    totalLoos: number;
    activeLoos: number;
    accessibleLoos: number;
    verifiedLoos: number;
  };
  contributors: {
    total: number;
    topContributors: Array<{ name: string; count: number }>;
  };
  activity: {
    recentUpdates: number;
    updatesLast30Days: number;
    updatesLast7Days: number;
  };
};

export type AdminMapLooResponse = {
  id: string;
  location: { lat: number; lng: number };
  active: boolean;
  accessible: boolean | null;
  babyChange: boolean | null;
  radar: boolean | null;
  noPayment: boolean | null;
  name: string | null;
  areaName: string | null;
};

/**
 * Service for admin-only operations requiring elevated permissions
 */
export class AdminService {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  /**
   * Get comprehensive statistics for the admin dashboard
   */
  async getStatistics(): Promise<AdminStatsResponse> {
    const [
      totalLoos,
      activeLoos,
      accessibleLoos,
      verifiedLoos,
      contributorStats,
      recentActivity,
    ] = await Promise.all([
      // Total loos
      this.prisma.toilets.count(),

      // Active loos
      this.prisma.toilets.count({ where: { active: true } }),

      // Accessible loos
      this.prisma.toilets.count({ where: { accessible: true } }),

      // Verified loos
      this.prisma.toilets.count({ where: { verified_at: { not: null } } }),

      // Contributor statistics
      this.getContributorStats(),

      // Recent activity
      this.getRecentActivity(),
    ]);

    return {
      overview: {
        totalLoos,
        activeLoos,
        accessibleLoos,
        verifiedLoos,
      },
      contributors: contributorStats,
      activity: recentActivity,
    };
  }

  /**
   * Get compressed loo data for map visualization
   * Only includes essential fields to minimize payload size
   */
  async getMapData(filters?: {
    active?: boolean;
    accessible?: boolean;
  }): Promise<AdminMapLooResponse[]> {
    const where: Prisma.toiletsWhereInput = {
      geography: { not: null },
    };

    if (typeof filters?.active === 'boolean') {
      where.active = filters.active;
    }

    if (typeof filters?.accessible === 'boolean') {
      where.accessible = filters.accessible;
    }

    // Use raw query for better performance with large datasets
    const query = Prisma.sql`
      SELECT
        t.id,
        ST_Y(t.geography::geometry) AS lat,
        ST_X(t.geography::geometry) AS lng,
        t.active,
        t.accessible,
        t.baby_change AS "babyChange",
        t.radar,
        t.no_payment AS "noPayment",
        t.name,
        a.name AS "areaName"
      FROM toilets t
      LEFT JOIN areas a ON t.area_id = a.id
      WHERE t.geography IS NOT NULL
      ${filters?.active !== undefined ? Prisma.sql`AND t.active = ${filters.active}` : Prisma.empty}
      ${filters?.accessible !== undefined ? Prisma.sql`AND t.accessible = ${filters.accessible}` : Prisma.empty}
      ORDER BY t.updated_at DESC
    `;

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        lat: number;
        lng: number;
        active: boolean;
        accessible: boolean | null;
        babyChange: boolean | null;
        radar: boolean | null;
        noPayment: boolean | null;
        name: string | null;
        areaName: string | null;
      }>
    >(query);

    return rows.map((row) => ({
      id: row.id,
      location: { lat: row.lat, lng: row.lng },
      active: row.active,
      accessible: row.accessible,
      babyChange: row.babyChange,
      radar: row.radar,
      noPayment: row.noPayment,
      name: row.name,
      areaName: row.areaName,
    }));
  }

  /**
   * Get contributor statistics
   */
  private async getContributorStats(): Promise<{
    total: number;
    topContributors: Array<{ name: string; count: number }>;
  }> {
    // Get unique contributors from the contributors array field
    const result = await this.prisma.$queryRaw<
      Array<{ contributor: string; count: bigint }>
    >`
      SELECT
        contributor,
        COUNT(*) as count
      FROM (
        SELECT DISTINCT ON (id, contributor)
          id,
          UNNEST(contributors) as contributor
        FROM toilets
        WHERE contributors IS NOT NULL AND array_length(contributors, 1) > 0
      ) AS unique_contributors
      WHERE contributor IS NOT NULL
      GROUP BY contributor
      ORDER BY count DESC
      LIMIT 10
    `;

    const topContributors = result.map((row) => ({
      name: row.contributor,
      count: Number(row.count),
    }));

    // Get total unique contributors
    const totalResult = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT contributor) as count
      FROM (
        SELECT UNNEST(contributors) as contributor
        FROM toilets
        WHERE contributors IS NOT NULL AND array_length(contributors, 1) > 0
      ) AS all_contributors
      WHERE contributor IS NOT NULL
    `;

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      total,
      topContributors,
    };
  }

  /**
   * Get recent activity metrics
   */
  private async getRecentActivity(): Promise<{
    recentUpdates: number;
    updatesLast30Days: number;
    updatesLast7Days: number;
  }> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [updatesLast7Days, updatesLast30Days, recentUpdates] =
      await Promise.all([
        this.prisma.toilets.count({
          where: { updated_at: { gte: sevenDaysAgo } },
        }),
        this.prisma.toilets.count({
          where: { updated_at: { gte: thirtyDaysAgo } },
        }),
        this.prisma.toilets.count({
          where: { updated_at: { not: null } },
        }),
      ]);

    return {
      recentUpdates,
      updatesLast30Days,
      updatesLast7Days,
    };
  }
}

export const adminService = new AdminService();
