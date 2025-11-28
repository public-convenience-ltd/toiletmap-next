import { RECENT_WINDOW_DAYS } from '../../common/constants';
import { Prisma, PrismaClientInstance } from '../../prisma';
import { mapAuditRecordToReport } from '../loo/mappers';
import type { ContributorReport, ContributorStats, ContributorSuggestion } from './types';

type RawCount = bigint | number | string | null | undefined;

const toNumber = (value: RawCount): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const toIsoString = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const escapeLikeTerm = (term: string) => term.replace(/([\\%_])/g, '\\$1');

export class UserInsightsService {
  constructor(private readonly prisma: PrismaClientInstance) {}

  async getContributorStats(handle: string): Promise<ContributorStats | null> {
    const normalized = handle.trim();
    if (!normalized) {
      return null;
    }

    const recentThreshold = new Date(
      Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const [summaryRow] = await this.prisma.$queryRaw<
      Array<{
        total_loos: RawCount;
        active_loos: RawCount;
        verified_loos: RawCount;
        recent_loos: RawCount;
      }>
    >(Prisma.sql`
      SELECT
        COUNT(*)::bigint AS total_loos,
        COUNT(*) FILTER (WHERE t.active IS TRUE)::bigint AS active_loos,
        COUNT(*) FILTER (WHERE t.verified_at IS NOT NULL)::bigint AS verified_loos,
        COUNT(*) FILTER (WHERE t.updated_at >= ${recentThreshold})::bigint AS recent_loos
      FROM toilets t
      WHERE t.contributors IS NOT NULL
        AND ${normalized} = ANY(t.contributors)
    `);

    const [eventRow] = await this.prisma.$queryRaw<
      Array<{
        total_events: RawCount;
        first_seen: Date | null;
        last_seen: Date | null;
      }>
    >(Prisma.sql`
      SELECT
        COUNT(*)::bigint AS total_events,
        MIN(ts) AS first_seen,
        MAX(ts) AS last_seen
      FROM audit.record_version rv
      WHERE rv.table_schema = 'public'
        AND rv.table_name = 'toilets'
        AND jsonb_typeof(rv.record -> 'contributors') = 'array'
        AND jsonb_array_length(rv.record -> 'contributors') > 0
        AND rv.record -> 'contributors' ->> (jsonb_array_length(rv.record -> 'contributors') - 1) = ${normalized}
    `);

    const areaRows = await this.prisma.$queryRaw<
      Array<{
        area_id: string | null;
        area_name: string | null;
        count: RawCount;
      }>
    >(Prisma.sql`
      SELECT
        t.area_id,
        a.name AS area_name,
        COUNT(*)::bigint AS count
      FROM toilets t
      LEFT JOIN areas a ON a.id = t.area_id
      WHERE t.contributors IS NOT NULL
        AND ${normalized} = ANY(t.contributors)
      GROUP BY t.area_id, a.name
      ORDER BY count DESC, a.name ASC
      LIMIT 5
    `);

    const looRows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string | null;
        updated_at: Date | null;
        verified_at: Date | null;
        area_name: string | null;
        area_type: string | null;
      }>
    >(Prisma.sql`
      SELECT
        t.id,
        t.name,
        t.updated_at,
        t.verified_at,
        a.name AS area_name,
        a.type AS area_type
      FROM toilets t
      LEFT JOIN areas a ON a.id = t.area_id
      WHERE t.contributors IS NOT NULL
        AND ${normalized} = ANY(t.contributors)
      ORDER BY t.updated_at DESC NULLS LAST, t.id ASC
      LIMIT 8
    `);

    const reportRows = await this.prisma.$queryRaw<
      Array<{
        id: bigint;
        record: Prisma.JsonValue;
        old_record: Prisma.JsonValue | null;
        ts: Date;
        loo_id: string | null;
        loo_name: string | null;
      }>
    >(Prisma.sql`
      SELECT
        rv.id,
        rv.record,
        rv.old_record,
        rv.ts,
        (rv.record ->> 'id') AS loo_id,
        (rv.record ->> 'name') AS loo_name
      FROM audit.record_version rv
      WHERE rv.table_schema = 'public'
        AND rv.table_name = 'toilets'
        AND jsonb_typeof(rv.record -> 'contributors') = 'array'
        AND jsonb_array_length(rv.record -> 'contributors') > 0
        AND rv.record -> 'contributors' ->> (jsonb_array_length(rv.record -> 'contributors') - 1) = ${normalized}
      ORDER BY rv.ts DESC
      LIMIT 20
    `);

    const recentReports: ContributorReport[] = reportRows.map((row) => {
      const base = mapAuditRecordToReport({
        id: row.id,
        record: row.record,
        old_record: row.old_record,
      });
      return {
        ...base,
        looId: row.loo_id,
        looName: row.loo_name,
        occurredAt: toIsoString(row.ts) ?? base.createdAt,
      };
    });

    return {
      summary: {
        handle: normalized,
        totalLoos: toNumber(summaryRow?.total_loos),
        activeLoos: toNumber(summaryRow?.active_loos),
        verifiedLoos: toNumber(summaryRow?.verified_loos),
        recentLoos: toNumber(summaryRow?.recent_loos),
        totalEvents: toNumber(eventRow?.total_events),
        firstSeenAt: toIsoString(eventRow?.first_seen),
        lastSeenAt: toIsoString(eventRow?.last_seen),
      },
      areas: areaRows.map((row) => ({
        areaId: row.area_id,
        name: row.area_name,
        count: toNumber(row.count),
      })),
      loos: looRows.map((row) => ({
        id: row.id,
        name: row.name,
        updatedAt: toIsoString(row.updated_at),
        verifiedAt: toIsoString(row.verified_at),
        areaName: row.area_name,
        areaType: row.area_type,
      })),
      recentReports,
    };
  }

  async searchContributors(term: string, limit = 8): Promise<ContributorSuggestion[]> {
    const normalized = term.trim();
    if (!normalized) {
      return [];
    }
    const pattern = `%${escapeLikeTerm(normalized)}%`;
    const prefix = `${escapeLikeTerm(normalized)}%`;

    const rows = await this.prisma.$queryRaw<
      Array<{ handle: string; contributions: RawCount }>
    >(Prisma.sql`
      WITH contributor_usage AS (
        SELECT btrim(value) AS handle
        FROM toilets t
        CROSS JOIN LATERAL unnest(COALESCE(t.contributors, ARRAY[]::text[])) AS value
        WHERE value IS NOT NULL
          AND btrim(value) <> ''
      )
      SELECT handle, COUNT(*)::bigint AS contributions
      FROM contributor_usage
      WHERE handle ILIKE ${pattern} ESCAPE '\\'
      GROUP BY handle
      ORDER BY
        CASE WHEN handle ILIKE ${prefix} ESCAPE '\\' THEN 0 ELSE 1 END,
        contributions DESC,
        handle ASC
      LIMIT ${limit}
    `);

    return rows.map((row) => ({
      handle: row.handle,
      contributions: toNumber(row.contributions),
    }));
  }

  async getPopularContributors(limit = 8): Promise<ContributorSuggestion[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ handle: string; contributions: RawCount }>
    >(Prisma.sql`
      WITH contributor_usage AS (
        SELECT btrim(value) AS handle
        FROM toilets t
        CROSS JOIN LATERAL unnest(COALESCE(t.contributors, ARRAY[]::text[])) AS value
        WHERE value IS NOT NULL
          AND btrim(value) <> ''
      )
      SELECT handle, COUNT(*)::bigint AS contributions
      FROM contributor_usage
      GROUP BY handle
      ORDER BY contributions DESC, handle ASC
      LIMIT ${limit}
    `);

    return rows.map((row) => ({
      handle: row.handle,
      contributions: toNumber(row.contributions),
    }));
  }
}
