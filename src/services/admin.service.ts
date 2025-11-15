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

export type SuspiciousActivityResponse = {
  rapidUpdates: RapidUpdateActivity[];
  conflictingEdits: ConflictingEditActivity[];
  locationChanges: LocationChangeActivity[];
  massDeactivations: MassDeactivationActivity[];
};

export type RapidUpdateActivity = {
  looId: string;
  looName: string | null;
  updateCount: number;
  contributors: string[];
  firstUpdate: Date;
  lastUpdate: Date;
  timeSpanMinutes: number;
};

export type ConflictingEditActivity = {
  looId: string;
  looName: string | null;
  field: string;
  contributors: Array<{ name: string; value: unknown; timestamp: Date }>;
  conflictCount: number;
};

export type LocationChangeActivity = {
  looId: string;
  looName: string | null;
  contributor: string;
  timestamp: Date;
  oldLocation: { lat: number; lng: number } | null;
  newLocation: { lat: number; lng: number };
  distanceMeters: number;
};

export type MassDeactivationActivity = {
  contributor: string;
  deactivationCount: number;
  looIds: string[];
  firstDeactivation: Date;
  lastDeactivation: Date;
  timeSpanMinutes: number;
};

export type ContributorStatsResponse = {
  contributorId: string;
  totalEdits: number;
  looseEdited: number;
  firstEdit: Date;
  lastEdit: Date;
  recentActivity: {
    last7Days: number;
    last30Days: number;
  };
  editTypes: {
    creates: number;
    updates: number;
  };
  topFields: Array<{ field: string; count: number }>;
};

export type ContributorLeaderboardResponse = {
  topContributors: Array<{
    name: string;
    totalEdits: number;
    looseEdited: number;
    rank: number;
  }>;
  recentContributors: Array<{
    name: string;
    edits: number;
    since: Date;
  }>;
  stats: {
    totalContributors: number;
    activeContributors7d: number;
    activeContributors30d: number;
  };
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
      this.getTopContributorsForStats(),

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
   * Get contributor statistics for dashboard
   */
  private async getTopContributorsForStats(): Promise<{
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

  /**
   * Get suspicious activity across all categories
   */
  async getSuspiciousActivity(options?: {
    hoursWindow?: number;
    minRapidUpdates?: number;
    minLocationChangeMeters?: number;
    minMassDeactivations?: number;
  }): Promise<SuspiciousActivityResponse> {
    const {
      hoursWindow = 24,
      minRapidUpdates = 5,
      minLocationChangeMeters = 1000,
      minMassDeactivations = 5,
    } = options ?? {};

    const [rapidUpdates, conflictingEdits, locationChanges, massDeactivations] =
      await Promise.all([
        this.getRapidUpdates(hoursWindow, minRapidUpdates),
        this.getConflictingEdits(hoursWindow),
        this.getLocationChanges(hoursWindow, minLocationChangeMeters),
        this.getMassDeactivations(hoursWindow, minMassDeactivations),
      ]);

    return {
      rapidUpdates,
      conflictingEdits,
      locationChanges,
      massDeactivations,
    };
  }

  /**
   * Detect rapid updates to the same loo in a short time window
   */
  private async getRapidUpdates(
    hoursWindow: number,
    minUpdates: number,
  ): Promise<RapidUpdateActivity[]> {
    const cutoffTime = new Date(Date.now() - hoursWindow * 60 * 60 * 1000);

    const result = await this.prisma.$queryRaw<
      Array<{
        loo_id: string;
        loo_name: string | null;
        update_count: bigint;
        contributors: string[];
        first_update: Date;
        last_update: Date;
      }>
    >`
      SELECT
        (rv.record->>'id') as loo_id,
        (rv.record->>'name') as loo_name,
        COUNT(*) as update_count,
        ARRAY_AGG(DISTINCT (
          rv.record->'contributors'->>-1
        )) FILTER (WHERE rv.record->'contributors'->>-1 IS NOT NULL) as contributors,
        MIN(rv.ts) as first_update,
        MAX(rv.ts) as last_update
      FROM audit.record_version rv
      WHERE rv.ts >= ${cutoffTime}
        AND rv.op IN ('INSERT', 'UPDATE')
        AND rv.record->>'id' IS NOT NULL
        AND rv.table_name = 'toilets'
      GROUP BY (rv.record->>'id'), (rv.record->>'name')
      HAVING COUNT(*) >= ${minUpdates}
      ORDER BY update_count DESC, last_update DESC
      LIMIT 100
    `;

    return result.map((row) => {
      const timeSpanMs =
        new Date(row.last_update).getTime() -
        new Date(row.first_update).getTime();
      return {
        looId: row.loo_id,
        looName: row.loo_name,
        updateCount: Number(row.update_count),
        contributors: row.contributors.filter((c) => c != null),
        firstUpdate: new Date(row.first_update),
        lastUpdate: new Date(row.last_update),
        timeSpanMinutes: Math.round(timeSpanMs / 60000),
      };
    });
  }

  /**
   * Detect conflicting edits from different contributors
   */
  private async getConflictingEdits(
    hoursWindow: number,
  ): Promise<ConflictingEditActivity[]> {
    const cutoffTime = new Date(Date.now() - hoursWindow * 60 * 60 * 1000);

    // Find loos that have been edited by multiple contributors with different values for key fields
    const result = await this.prisma.$queryRaw<
      Array<{
        loo_id: string;
        loo_name: string | null;
        field: string;
        values: Array<{ contributor: string; value: unknown; ts: Date }>;
      }>
    >`
      WITH recent_updates AS (
        SELECT
          (rv.record->>'id') as loo_id,
          (rv.record->>'name') as loo_name,
          (rv.record->'contributors'->>-1) as contributor,
          rv.record,
          rv.ts
        FROM audit.record_version rv
        WHERE rv.ts >= ${cutoffTime}
          AND rv.op IN ('INSERT', 'UPDATE')
          AND rv.record->>'id' IS NOT NULL
          AND rv.table_name = 'toilets'
          AND rv.record->'contributors'->>-1 IS NOT NULL
      ),
      field_changes AS (
        SELECT
          loo_id,
          loo_name,
          'active' as field,
          jsonb_build_object(
            'contributor', contributor,
            'value', record->'active',
            'ts', ts
          ) as change_info
        FROM recent_updates
        WHERE record ? 'active'
        UNION ALL
        SELECT
          loo_id,
          loo_name,
          'accessible' as field,
          jsonb_build_object(
            'contributor', contributor,
            'value', record->'accessible',
            'ts', ts
          ) as change_info
        FROM recent_updates
        WHERE record ? 'accessible'
        UNION ALL
        SELECT
          loo_id,
          loo_name,
          'babyChange' as field,
          jsonb_build_object(
            'contributor', contributor,
            'value', record->'babyChange',
            'ts', ts
          ) as change_info
        FROM recent_updates
        WHERE record ? 'babyChange'
      )
      SELECT
        loo_id,
        loo_name,
        field,
        jsonb_agg(change_info ORDER BY (change_info->>'ts')::timestamptz DESC) as values
      FROM field_changes
      GROUP BY loo_id, loo_name, field
      HAVING COUNT(DISTINCT change_info->>'value') > 1
        AND COUNT(DISTINCT change_info->>'contributor') > 1
      ORDER BY jsonb_array_length(jsonb_agg(change_info)) DESC
      LIMIT 100
    `;

    return result.map((row) => ({
      looId: row.loo_id,
      looName: row.loo_name,
      field: row.field,
      contributors: (row.values as any[]).map((v) => ({
        name: v.contributor,
        value: v.value,
        timestamp: new Date(v.ts),
      })),
      conflictCount: new Set((row.values as any[]).map((v) => v.value)).size,
    }));
  }

  /**
   * Detect unexpected location changes
   */
  private async getLocationChanges(
    hoursWindow: number,
    minDistanceMeters: number,
  ): Promise<LocationChangeActivity[]> {
    const cutoffTime = new Date(Date.now() - hoursWindow * 60 * 60 * 1000);

    const result = await this.prisma.$queryRaw<
      Array<{
        loo_id: string;
        loo_name: string | null;
        contributor: string;
        ts: Date;
        old_lat: number | null;
        old_lng: number | null;
        new_lat: number;
        new_lng: number;
        distance_meters: number;
      }>
    >`
      SELECT
        (rv.record->>'id') as loo_id,
        (rv.record->>'name') as loo_name,
        (rv.record->'contributors'->>-1) as contributor,
        rv.ts,
        CAST(rv.old_record->'location'->>'lat' AS DOUBLE PRECISION) as old_lat,
        CAST(rv.old_record->'location'->>'lng' AS DOUBLE PRECISION) as old_lng,
        CAST(rv.record->'location'->>'lat' AS DOUBLE PRECISION) as new_lat,
        CAST(rv.record->'location'->>'lng' AS DOUBLE PRECISION) as new_lng,
        ST_Distance(
          ST_SetSRID(ST_MakePoint(
            CAST(rv.old_record->'location'->>'lng' AS DOUBLE PRECISION),
            CAST(rv.old_record->'location'->>'lat' AS DOUBLE PRECISION)
          ), 4326)::geography,
          ST_SetSRID(ST_MakePoint(
            CAST(rv.record->'location'->>'lng' AS DOUBLE PRECISION),
            CAST(rv.record->'location'->>'lat' AS DOUBLE PRECISION)
          ), 4326)::geography
        ) as distance_meters
      FROM audit.record_version rv
      WHERE rv.ts >= ${cutoffTime}
        AND rv.op = 'UPDATE'
        AND rv.record->>'id' IS NOT NULL
        AND rv.table_name = 'toilets'
        AND rv.record ? 'location'
        AND rv.old_record ? 'location'
        AND rv.record->'location' IS NOT NULL
        AND rv.old_record->'location' IS NOT NULL
        AND rv.record->'location' != rv.old_record->'location'
        AND rv.record->'contributors'->>-1 IS NOT NULL
      ORDER BY distance_meters DESC
      LIMIT 100
    `;

    return result
      .filter((row) => row.distance_meters >= minDistanceMeters)
      .map((row) => ({
        looId: row.loo_id,
        looName: row.loo_name,
        contributor: row.contributor,
        timestamp: new Date(row.ts),
        oldLocation:
          row.old_lat && row.old_lng
            ? { lat: row.old_lat, lng: row.old_lng }
            : null,
        newLocation: { lat: row.new_lat, lng: row.new_lng },
        distanceMeters: Math.round(row.distance_meters),
      }));
  }

  /**
   * Detect mass deactivations by a single contributor
   */
  private async getMassDeactivations(
    hoursWindow: number,
    minDeactivations: number,
  ): Promise<MassDeactivationActivity[]> {
    const cutoffTime = new Date(Date.now() - hoursWindow * 60 * 60 * 1000);

    const result = await this.prisma.$queryRaw<
      Array<{
        contributor: string;
        deactivation_count: bigint;
        loo_ids: string[];
        first_deactivation: Date;
        last_deactivation: Date;
      }>
    >`
      SELECT
        (rv.record->'contributors'->>-1) as contributor,
        COUNT(*) as deactivation_count,
        ARRAY_AGG(rv.record->>'id') as loo_ids,
        MIN(rv.ts) as first_deactivation,
        MAX(rv.ts) as last_deactivation
      FROM audit.record_version rv
      WHERE rv.ts >= ${cutoffTime}
        AND rv.op = 'UPDATE'
        AND rv.table_name = 'toilets'
        AND (rv.record->>'active')::boolean = false
        AND (rv.old_record->>'active')::boolean = true
        AND rv.record->'contributors'->>-1 IS NOT NULL
      GROUP BY (rv.record->'contributors'->>-1)
      HAVING COUNT(*) >= ${minDeactivations}
      ORDER BY deactivation_count DESC
      LIMIT 100
    `;

    return result.map((row) => {
      const timeSpanMs =
        new Date(row.last_deactivation).getTime() -
        new Date(row.first_deactivation).getTime();
      return {
        contributor: row.contributor,
        deactivationCount: Number(row.deactivation_count),
        looIds: row.loo_ids,
        firstDeactivation: new Date(row.first_deactivation),
        lastDeactivation: new Date(row.last_deactivation),
        timeSpanMinutes: Math.round(timeSpanMs / 60000),
      };
    });
  }

  /**
   * Get detailed contributor statistics
   */
  async getContributorStats(contributorId: string): Promise<ContributorStatsResponse | null> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get basic stats
    const basicStats = await this.prisma.$queryRaw<
      Array<{
        total_edits: bigint;
        loos_edited: bigint;
        first_edit: Date;
        last_edit: Date;
        edits_last_7_days: bigint;
        edits_last_30_days: bigint;
        creates: bigint;
        updates: bigint;
      }>
    >`
      WITH contributor_edits AS (
        SELECT
          rv.record->>'id' as loo_id,
          rv.ts,
          rv.op
        FROM audit.record_version rv
        WHERE rv.table_name = 'toilets'
          AND rv.op IN ('INSERT', 'UPDATE')
          AND rv.record->'contributors'->>-1 = ${contributorId}
      )
      SELECT
        COUNT(*) as total_edits,
        COUNT(DISTINCT loo_id) as loos_edited,
        MIN(ts) as first_edit,
        MAX(ts) as last_edit,
        COUNT(*) FILTER (WHERE ts >= ${sevenDaysAgo}) as edits_last_7_days,
        COUNT(*) FILTER (WHERE ts >= ${thirtyDaysAgo}) as edits_last_30_days,
        COUNT(*) FILTER (WHERE op = 'INSERT') as creates,
        COUNT(*) FILTER (WHERE op = 'UPDATE') as updates
      FROM contributor_edits
    `;

    if (!basicStats[0] || Number(basicStats[0].total_edits) === 0) {
      return null;
    }

    const stats = basicStats[0];

    // Get top edited fields
    const topFields = await this.prisma.$queryRaw<
      Array<{ field: string; count: bigint }>
    >`
      WITH field_edits AS (
        SELECT
          jsonb_object_keys(rv.record) as field
        FROM audit.record_version rv
        WHERE rv.table_name = 'toilets'
          AND rv.record->'contributors'->>-1 = ${contributorId}
          AND rv.op = 'UPDATE'
      )
      SELECT
        field,
        COUNT(*) as count
      FROM field_edits
      WHERE field NOT IN ('id', 'contributors', 'updated_at', 'created_at')
      GROUP BY field
      ORDER BY count DESC
      LIMIT 10
    `;

    return {
      contributorId,
      totalEdits: Number(stats.total_edits),
      looseEdited: Number(stats.loos_edited),
      firstEdit: new Date(stats.first_edit),
      lastEdit: new Date(stats.last_edit),
      recentActivity: {
        last7Days: Number(stats.edits_last_7_days),
        last30Days: Number(stats.edits_last_30_days),
      },
      editTypes: {
        creates: Number(stats.creates),
        updates: Number(stats.updates),
      },
      topFields: topFields.map((row) => ({
        field: row.field,
        count: Number(row.count),
      })),
    };
  }

  /**
   * Get contributor leaderboard with fun stats
   */
  async getContributorLeaderboard(): Promise<ContributorLeaderboardResponse> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get top contributors all-time
    const topContributors = await this.prisma.$queryRaw<
      Array<{
        contributor: string;
        total_edits: bigint;
        loos_edited: bigint;
      }>
    >`
      SELECT
        rv.record->'contributors'->>-1 as contributor,
        COUNT(*) as total_edits,
        COUNT(DISTINCT rv.record->>'id') as loos_edited
      FROM audit.record_version rv
      WHERE rv.table_name = 'toilets'
        AND rv.op IN ('INSERT', 'UPDATE')
        AND rv.record->'contributors'->>-1 IS NOT NULL
      GROUP BY rv.record->'contributors'->>-1
      ORDER BY total_edits DESC
      LIMIT 20
    `;

    // Get recent contributors (last 7 days)
    const recentContributors = await this.prisma.$queryRaw<
      Array<{
        contributor: string;
        edits: bigint;
        first_edit: Date;
      }>
    >`
      SELECT
        rv.record->'contributors'->>-1 as contributor,
        COUNT(*) as edits,
        MIN(rv.ts) as first_edit
      FROM audit.record_version rv
      WHERE rv.table_name = 'toilets'
        AND rv.op IN ('INSERT', 'UPDATE')
        AND rv.record->'contributors'->>-1 IS NOT NULL
        AND rv.ts >= ${sevenDaysAgo}
      GROUP BY rv.record->'contributors'->>-1
      ORDER BY edits DESC
      LIMIT 10
    `;

    // Get overall contributor counts
    const contributorCounts = await this.prisma.$queryRaw<
      Array<{
        total_contributors: bigint;
        active_7d: bigint;
        active_30d: bigint;
      }>
    >`
      SELECT
        COUNT(DISTINCT rv.record->'contributors'->>-1) as total_contributors,
        COUNT(DISTINCT rv.record->'contributors'->>-1) FILTER (WHERE rv.ts >= ${sevenDaysAgo}) as active_7d,
        COUNT(DISTINCT rv.record->'contributors'->>-1) FILTER (WHERE rv.ts >= ${thirtyDaysAgo}) as active_30d
      FROM audit.record_version rv
      WHERE rv.table_name = 'toilets'
        AND rv.op IN ('INSERT', 'UPDATE')
        AND rv.record->'contributors'->>-1 IS NOT NULL
    `;

    const counts = contributorCounts[0];

    return {
      topContributors: topContributors.map((row, index) => ({
        name: row.contributor,
        totalEdits: Number(row.total_edits),
        looseEdited: Number(row.loos_edited),
        rank: index + 1,
      })),
      recentContributors: recentContributors.map((row) => ({
        name: row.contributor,
        edits: Number(row.edits),
        since: new Date(row.first_edit),
      })),
      stats: {
        totalContributors: Number(counts?.total_contributors ?? 0),
        activeContributors7d: Number(counts?.active_7d ?? 0),
        activeContributors30d: Number(counts?.active_30d ?? 0),
      },
    };
  }
}

export const adminService = new AdminService();
