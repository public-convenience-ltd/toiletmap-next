import { PrismaClientInstance, toilets, Prisma } from "../../prisma";
import { RECENT_WINDOW_DAYS } from "../../common/constants";
import {
  areaSelection,
  buildAreaFromJoin,
  mapAuditRecordToReport,
  mapLoo,
  mapNearbyLoo,
} from "./mappers";
import { mapMutationToPrismaData } from "./mutation";
import { insertLoo, updateLoo } from "./persistence";
import {
  buildProximityQuery,
  buildSearchQueries,
  buildSelectByIdsQuery,
  createSearchWhereBuilder,
} from "./sql";
import type {
  LooMutationAttributes,
  LooResponse,
  NearbyLooResponse,
  ReportResponse,
  ReportSummaryResponse,
  LooSearchParams,
  LooMetricsResponse,
} from "./types";
import {
  RawLooRowSchema,
  RawNearbyLooRowSchema,
  type RawLooRow,
  type RawNearbyLooRow,
} from "./types";

/**
 * Converts a validated RawLooRow to a toilets object by extracting only toilets fields.
 */
const rawLooToToilets = (raw: RawLooRow): toilets => ({
  id: raw.id,
  created_at: raw.created_at ?? null,
  contributors: raw.contributors ?? [],
  accessible: raw.accessible ?? null,
  active: raw.active ?? null,
  attended: raw.attended ?? null,
  automatic: raw.automatic ?? null,
  baby_change: raw.baby_change ?? null,
  men: raw.men ?? null,
  name: raw.name ?? null,
  no_payment: raw.no_payment ?? null,
  notes: raw.notes ?? null,
  payment_details: raw.payment_details ?? null,
  radar: raw.radar ?? null,
  removal_reason: raw.removal_reason ?? null,
  women: raw.women ?? null,
  updated_at: raw.updated_at ?? null,
  urinal_only: raw.urinal_only ?? null,
  all_gender: raw.all_gender ?? null,
  children: raw.children ?? null,
  geohash: raw.geohash ?? null,
  verified_at: raw.verified_at ?? null,
  area_id: raw.area_id ?? null,
  opening_times: raw.opening_times ?? null,
  location: raw.location ?? null,
});

/**
 * Service for managing Loo (toilet) data.
 *
 * Handles all interactions with the database for loos, including:
 * - Reading loos by ID, proximity, or search criteria.
 * - Writing loos (create, update/upsert) with audit logging.
 * - Retrieving audit history (reports).
 *
 * This service delegates complex SQL generation to `sql.ts` and
 * data mapping to `mappers.ts` to keep the core logic clean.
 */
export class LooService {
  constructor(private readonly prisma: PrismaClientInstance) {}

  // ===========================================================================
  // READ OPERATIONS
  // ===========================================================================

  /**
   * Retrieves a single loo by its ID.
   * Returns null if the loo does not exist.
   */
  async getById(id: string): Promise<LooResponse | null> {
    const row = await this.prisma.toilets.findUnique({
      where: { id },
      include: { areas: areaSelection },
    });
    return row ? mapLoo(row) : null;
  }

  /**
   * Retrieves multiple loos by their IDs.
   * The order of the returned loos matches the order of the input IDs.
   */
  async getByIds(ids: string[]): Promise<LooResponse[]> {
    if (!ids.length) return [];

    const query = buildSelectByIdsQuery(ids);
    const rows = (await this.prisma.$queryRaw<RawLooRow[]>(query)) ?? [];

    return rows.map((loo) => {
      const validated = RawLooRowSchema.parse(loo);
      return mapLoo({
        ...rawLooToToilets(validated),
        areas: buildAreaFromJoin(validated.area_name, validated.area_type),
      });
    });
  }

  /**
   * Searches for loos based on various criteria (text search, filters, etc.).
   * Supports pagination.
   */
  async search(
    params: LooSearchParams
  ): Promise<{ data: LooResponse[]; total: number }> {
    const limit = Math.max(1, Math.min(params.limit, 200));
    const page = Math.max(1, params.page);
    const offset = (page - 1) * limit;

    const { dataQuery, countQuery } = buildSearchQueries({
      params,
      limit,
      offset,
    });

    const rows = (await this.prisma.$queryRaw<RawLooRow[]>(dataQuery)) ?? [];

    const countRows =
      (await this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>(
        countQuery
      )) ?? [];

    const total =
      countRows.length > 0 && countRows[0]?.count !== undefined
        ? Number(countRows[0].count)
        : 0;

    const data = rows.map((loo) => {
      const validated = RawLooRowSchema.parse(loo);
      return mapLoo({
        ...rawLooToToilets(validated),
        areas: buildAreaFromJoin(validated.area_name, validated.area_type),
      });
    });

    return { data, total };
  }

  /**
   * Computes aggregate insights for search filters to support admin dashboards.
   */
  async getSearchMetrics(
    params: LooSearchParams,
    options: { recentWindowDays?: number } = {}
  ): Promise<LooMetricsResponse> {
    const recentWindowDays =
      options.recentWindowDays ?? RECENT_WINDOW_DAYS;
    const recentThreshold = new Date(
      Date.now() - recentWindowDays * 24 * 60 * 60 * 1000
    );
    const { buildWhere } = createSearchWhereBuilder(params);
    const fromClause = Prisma.sql`
      FROM toilets loo
      LEFT JOIN areas area ON area.id = loo.area_id
    `;

    const countQuery = (extra?: Prisma.Sql) => Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      ${fromClause}
      ${buildWhere(extra)}
    `;

    const areaQuery = Prisma.sql`
      SELECT
        loo.area_id,
        area.name AS area_name,
        COUNT(*)::bigint AS count
      ${fromClause}
      ${buildWhere()}
      GROUP BY loo.area_id, area.name
      ORDER BY count DESC
      LIMIT 5
    `;

    const [
      totalRows,
      activeRows,
      verifiedRows,
      accessibleRows,
      babyChangeRows,
      radarRows,
      freeRows,
      recentRows,
      areaRows,
    ] = await this.prisma.$transaction([
      this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>(
        countQuery()
      ),
      this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>(
        countQuery(Prisma.sql`loo.active = TRUE`)
      ),
      this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>(
        countQuery(Prisma.sql`loo.verified_at IS NOT NULL`)
      ),
      this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>(
        countQuery(Prisma.sql`loo.accessible = TRUE`)
      ),
      this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>(
        countQuery(Prisma.sql`loo.baby_change = TRUE`)
      ),
      this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>(
        countQuery(Prisma.sql`loo.radar = TRUE`)
      ),
      this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>(
        countQuery(Prisma.sql`loo.no_payment = TRUE`)
      ),
      this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>(
        countQuery(Prisma.sql`loo.updated_at >= ${recentThreshold}`)
      ),
      this.prisma.$queryRaw<
        Array<{ area_id: string | null; area_name: string | null; count: bigint | number | string }>
      >(areaQuery),
    ]);

    const toNumber = (
      rows?: Array<{ count: bigint | number | string }> | null
    ) => {
      const list = rows ?? [];
      const raw = list[0]?.count ?? 0;
      return typeof raw === "bigint" ? Number(raw) : Number(raw ?? 0);
    };

    const parseAreaCount = (row: {
      area_id: string | null;
      area_name: string | null;
      count: bigint | number | string;
    }) => ({
      areaId: row.area_id,
      name:
        row.area_name ??
        (row.area_id ? "Unknown area" : "Unassigned area"),
      count:
        typeof row.count === "bigint"
          ? Number(row.count)
          : Number(row.count ?? 0),
    });

    return {
      recentWindowDays,
      totals: {
        filtered: toNumber(totalRows),
        active: toNumber(activeRows),
        verified: toNumber(verifiedRows),
        accessible: toNumber(accessibleRows),
        babyChange: toNumber(babyChangeRows),
        radar: toNumber(radarRows),
        freeAccess: toNumber(freeRows),
        recent: toNumber(recentRows),
      },
      areas: (areaRows ?? []).map(parseAreaCount),
    };
  }

  /**
   * Finds loos whose geohash starts with the given string.
   * Useful for map-based tiling or broad area searches.
   */
  async getWithinGeohash(
    geohash: string,
    active?: boolean | null
  ): Promise<LooResponse[]> {
    const where = {
      geohash: { startsWith: geohash },
      ...(typeof active === "boolean" ? { active: { equals: active } } : {}),
    } as const;

    const rows = await this.prisma.toilets.findMany({
      where,
      include: { areas: areaSelection },
    });
    return rows.map(mapLoo);
  }

  /**
   * Finds loos within a specified radius (in meters) of a coordinate.
   * Uses PostGIS spherical distance calculation.
   */
  async getByProximity(
    lat: number,
    lng: number,
    radius: number
  ): Promise<NearbyLooResponse[]> {
    const query = buildProximityQuery(lat, lng, radius);
    const loos = (await this.prisma.$queryRaw<RawNearbyLooRow[]>(query)) ?? [];

    return loos.map((loo) => {
      const validated = RawNearbyLooRowSchema.parse(loo);
      return mapNearbyLoo({
        ...rawLooToToilets(validated),
        areas: buildAreaFromJoin(validated.area_name, validated.area_type),
        distance: validated.distance,
      });
    });
  }

  /**
   * Retrieves the audit history (reports) for a specific loo.
   *
   * @param id - The ID of the loo.
   * @param options.hydrate - If true, fully hydrates the report with diffs.
   *                          If false, returns a summary.
   */
  async getReports(
    id: string,
    options: { hydrate?: boolean; includeContributors?: boolean } = {},
  ): Promise<ReportResponse[] | ReportSummaryResponse[]> {
    const {
      hydrate = false,
      includeContributors = false,
    } = options;
    const reportRecords = await this.prisma.record_version.findMany({
      where: { record: { path: ["id"], equals: id } },
      select: { record: true, old_record: true, id: true },
      orderBy: { ts: "asc" },
    });

    // We filter out system location updates as they are not user-contributed
    // and are left over from our old system where we recorded a separate
    // location report for each loo.
    const mapped = reportRecords
      .map((entry) => mapAuditRecordToReport(entry))
      .filter(
        (report) =>
          !report.contributor ||
          !report.contributor.endsWith("-location"),
      );

    const sanitized = includeContributors
      ? mapped
      : mapped.map((report) => ({ ...report, contributor: null }));

    if (hydrate) return sanitized;

    return sanitized.map(({ id: reportId, contributor, createdAt, diff }) => ({
      id: reportId,
      contributor,
      createdAt,
      diff,
    }));
  }

  // ===========================================================================
  // WRITE OPERATIONS
  // ===========================================================================

  /**
   * Creates a new loo.
   *
   * @param id - The ID for the new loo.
   * @param mutation - The attributes to set on the loo.
   * @param contributor - The user creating the loo (for audit trail).
   */
  async create(
    id: string,
    mutation: LooMutationAttributes,
    contributor: string | null
  ): Promise<LooResponse | null> {
    const now = new Date();
    const dataForCreate = mapMutationToPrismaData(mutation, {
      forCreate: true,
    });

    await this.prisma.$transaction(async (tx) => {
      await insertLoo({
        tx,
        id,
        data: dataForCreate,
        mutation,
        contributor,
        now,
      });
    });

    return this.getById(id);
  }

  /**
   * Updates an existing loo, or creates it if it doesn't exist (Upsert).
   *
   * This method uses a "try update, then insert" strategy within a transaction
   * to ensure atomicity. This is preferred over `prisma.upsert` because we need
   * to handle custom audit logging logic via `updateLoo` and `insertLoo` helpers.
   *
   * @param id - The ID of the loo to upsert.
   * @param mutation - The attributes to update/set.
   * @param contributor - The user performing the action.
   */
  async upsert(
    id: string,
    mutation: LooMutationAttributes,
    contributor: string | null
  ): Promise<LooResponse | null> {
    const now = new Date();
    const dataForCreate = mapMutationToPrismaData(mutation, {
      forCreate: true,
    });
    const dataForUpdate = mapMutationToPrismaData(mutation, {
      forCreate: false,
    });

    await this.prisma.$transaction(async (tx) => {
      // 1. Attempt to update the existing record.
      //    The updateLoo helper handles the audit log creation.
      const updatedCount = await updateLoo({
        tx,
        id,
        data: dataForUpdate,
        mutation,
        contributor,
        now,
      });

      // 2. If no rows were updated, it means the loo doesn't exist.
      //    So we insert a new record instead.
      if (updatedCount === 0) {
        await insertLoo({
          tx,
          id,
          data: dataForCreate,
          mutation,
          contributor,
          now,
        });
      }
    });

    return this.getById(id);
  }
}
