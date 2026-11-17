import { MAX_SEARCH_LIMIT, MIN_SEARCH_LIMIT, RECENT_WINDOW_DAYS } from "../../common/constants";
import { Prisma, type PrismaClientInstance } from "../../prisma";
import type { LooDiffBase } from "./diff";
import {
  areaSelection,
  buildAreaFromJoin,
  compressedLooSelect,
  compressLooRow,
  isMapVisible,
  mapAuditRecordToReport,
  mapLoo,
  mapNearbyLoo,
  rawLooToToilets,
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
  CompressedLoo,
  LooMetricsResponse,
  LooMutationAttributes,
  LooResponse,
  LooSearchParams,
  NearbyLooResponse,
  ReportResponse,
  ReportSummaryResponse,
} from "./types";
import {
  type RawLooRow,
  RawLooRowSchema,
  type RawNearbyLooRow,
  RawNearbyLooRowSchema,
} from "./types";

type DbClient = PrismaClientInstance | Prisma.TransactionClient;

/** How far the sync cursor trails the database clock. See {@link LooService.getSyncCursor}. */
const SYNC_CURSOR_OVERLAP_SECONDS = 120;
const SYNC_CURSOR_OVERLAP = Prisma.raw(`interval '${SYNC_CURSOR_OVERLAP_SECONDS} seconds'`);

/**
 * Fingerprint of the toilets table (see {@link LooService.getDatasetVersion})
 * plus the sync cursor read with it.
 */
export type DatasetVersion = {
  /** Newest `updated_at`, epoch ms (0 for an empty table). */
  maxUpdatedAt: number;
  count: number;
  /** Sum of every `updated_at` in epoch microseconds, as a decimal string. */
  updatedAtSum: string;
  cursor: string;
};

/** A loo as read for mutation purposes: the public response plus its raw `areaId`. */
export type LooMutationBase = LooDiffBase & { areaId: string | null };

export type UpdateExistingResult =
  | { status: "updated"; loo: LooResponse | null }
  | { status: "not_found" }
  | { status: "conflict" };

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
  private looCache = new Map<string, LooResponse>();
  private readonly MAX_CACHE_SIZE = 100;

  constructor(private readonly prisma: PrismaClientInstance) {}

  /**
   * Performs a database health check.
   * @returns Promise that resolves if database is healthy, rejects otherwise.
   */
  async healthCheck(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1 as health_check`;
  }

  // ===========================================================================
  // READ OPERATIONS
  // ===========================================================================

  /**
   * Retrieves a single loo by its ID.
   * Returns null if the loo does not exist.
   */
  async getById(id: string): Promise<LooResponse | null> {
    const cached = this.looCache.get(id);
    if (cached) {
      return cached;
    }

    const row = await this.prisma.toilets.findUnique({
      where: { id },
      include: { areas: areaSelection },
    });

    if (!row) return null;

    const loo = mapLoo(row);

    // Simple LRU: delete if exists (to refresh order), then set
    if (this.looCache.has(id)) {
      this.looCache.delete(id);
    } else if (this.looCache.size >= this.MAX_CACHE_SIZE) {
      // Delete oldest (first) item
      const firstKey = this.looCache.keys().next().value;
      if (firstKey) this.looCache.delete(firstKey);
    }

    this.looCache.set(id, loo);
    return loo;
  }

  /**
   * Reads a loo fresh from the database (bypassing the per-request cache) for
   * use as the comparison base of a mutation. Includes the raw `areaId`, which
   * the public response omits. Pass a transaction client to read within it.
   */
  async getMutationBase(id: string, db: DbClient = this.prisma): Promise<LooMutationBase | null> {
    const row = await db.toilets.findUnique({
      where: { id },
      include: { areas: areaSelection },
    });
    if (!row) return null;
    return { ...mapLoo(row), areaId: row.area_id ?? null };
  }

  /**
   * Retrieves multiple loos by their IDs.
   * The order of the returned loos matches the order of the input IDs.
   */
  async getByIds(ids: string[]): Promise<LooResponse[]> {
    if (!ids.length) return [];

    const query = buildSelectByIdsQuery(ids);
    const rows = (await this.prisma.$queryRaw<RawLooRow[]>(query)) ?? [];

    return rows.map((loo: RawLooRow) => {
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
  async search(params: LooSearchParams): Promise<{ data: LooResponse[]; total: number }> {
    const limit = Math.max(MIN_SEARCH_LIMIT, Math.min(params.limit, MAX_SEARCH_LIMIT));
    const page = Math.max(1, params.page);
    const offset = (page - 1) * limit;

    const { dataQuery, countQuery } = buildSearchQueries({
      params,
      limit,
      offset,
    });

    const rows = (await this.prisma.$queryRaw<RawLooRow[]>(dataQuery)) ?? [];

    const countRows =
      (await this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>(countQuery)) ?? [];

    const total =
      countRows.length > 0 && countRows[0]?.count !== undefined ? Number(countRows[0].count) : 0;

    const data = rows.map((loo: RawLooRow) => {
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
  /**
   * Computes aggregate insights for search filters to support admin dashboards.
   */
  async getSearchMetrics(
    params: LooSearchParams,
    options: { recentWindowDays?: number } = {},
  ): Promise<LooMetricsResponse> {
    const recentWindowDays = options.recentWindowDays ?? RECENT_WINDOW_DAYS;
    const recentThreshold = new Date(Date.now() - recentWindowDays * 24 * 60 * 60 * 1000);
    const buildWhere = createSearchWhereBuilder(params);
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
      this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>(countQuery()),
      this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>(
        countQuery(Prisma.sql`loo.active = TRUE`),
      ),
      this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>(
        countQuery(Prisma.sql`loo.verified_at IS NOT NULL`),
      ),
      this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>(
        countQuery(Prisma.sql`loo.accessible = TRUE`),
      ),
      this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>(
        countQuery(Prisma.sql`loo.baby_change = TRUE`),
      ),
      this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>(
        countQuery(Prisma.sql`loo.radar = TRUE`),
      ),
      this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>(
        countQuery(Prisma.sql`loo.no_payment = TRUE`),
      ),
      this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>(
        countQuery(Prisma.sql`loo.updated_at >= ${recentThreshold}`),
      ),
      this.prisma.$queryRaw<
        Array<{
          area_id: string | null;
          area_name: string | null;
          count: bigint | number | string;
        }>
      >(areaQuery),
    ]);

    const toNumber = (rows?: Array<{ count: bigint | number | string }> | null) => {
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
      name: row.area_name ?? (row.area_id ? "Unknown area" : "Unassigned area"),
      count: typeof row.count === "bigint" ? Number(row.count) : Number(row.count ?? 0),
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
  async getWithinGeohash(geohash: string, active?: boolean | null): Promise<LooResponse[]> {
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
   * Finds loos whose geohash starts with the given string and returns a compressed format.
   * Optimized for map rendering.
   */
  async getWithinGeohashCompressed(
    geohash: string,
    active?: boolean | null,
  ): Promise<CompressedLoo[]> {
    const where = {
      geohash: { startsWith: geohash },
      ...(typeof active === "boolean" ? { active: { equals: active } } : {}),
    } as const;

    const rows = await this.prisma.toilets.findMany({
      where,
      select: compressedLooSelect,
    });

    return rows.map(compressLooRow);
  }

  /**
   * Finds loos whose geohash starts with the given string and returns a summary format.
   * Includes more details than compressed but less than full.
   */
  async getWithinGeohashSummary(geohash: string, active?: boolean | null): Promise<LooResponse[]> {
    const where = {
      geohash: { startsWith: geohash },
      ...(typeof active === "boolean" ? { active: { equals: active } } : {}),
    } as const;

    const rows = await this.prisma.toilets.findMany({
      where,
      include: { areas: areaSelection },
    });
    // For now, we map to full LooResponse but we could optimize this to return a subset
    // if we defined a specific LooSummary type. Given the user's request for "most useful info",
    // returning the standard LooResponse (which is already somewhat summarized compared to raw DB)
    // is a good starting point.
    return rows.map(mapLoo);
  }

  /**
   * Retrieves all loos in a compressed format.
   * Optimized for bulk map rendering.
   */
  async getAllCompressed(): Promise<CompressedLoo[]> {
    const rows = await this.prisma.toilets.findMany({
      where: {
        active: true,
        geohash: { not: null },
      },
      select: compressedLooSelect,
    });

    return rows.map(compressLooRow);
  }

  /**
   * Retrieves all active loos with full details.
   * WARNING: This is a heavy operation.
   */
  async getAll(): Promise<LooResponse[]> {
    const rows = await this.prisma.toilets.findMany({
      where: {
        active: true,
        geohash: { not: null },
      },
      include: { areas: areaSelection },
    });

    return rows.map(mapLoo);
  }

  /**
   * Reads the sync cursor from the database clock: `now() - 120 seconds`.
   *
   * Callers must read it *before* the query whose results it describes. Any
   * write not visible to that query commits after the cursor was read, and its
   * `updated_at` (also the database clock, see `persistence.ts`) can trail its
   * commit by at most the length of its transaction, far less than the 120s
   * overlap. So `/updates?since=<cursor>` always re-delivers it. The overlap
   * also re-delivers some rows the client already has; clients apply deltas
   * idempotently.
   */
  async getSyncCursor(): Promise<string> {
    const [row] = await this.prisma.$queryRaw<Array<{ cursor: Date }>>(
      Prisma.sql`SELECT now() - ${SYNC_CURSOR_OVERLAP} AS cursor`,
    );
    if (!row) throw new Error("Failed to read sync cursor");
    return new Date(row.cursor).toISOString();
  }

  /**
   * A cheap fingerprint of the whole toilets table, plus a sync cursor read in
   * the same statement (so before any dump query that follows).
   *
   * Every write bumps `updated_at` (deactivations included; rows are never
   * hard-deleted in normal operation). `max(updated_at)` and the row count
   * alone miss a write that leaves the maximum where it was: one to a row that
   * is not the newest, or a transaction that commits after a later-started one
   * (its `updated_at` is its start time, below the other's). So the version
   * also carries the sum of every `updated_at` in microseconds, which moves
   * whenever any single row's `updated_at` does.
   *
   * The sum is taken over intervals and converted once at the end, which costs
   * well under a millisecond extra on ~16k rows (per-row `extract` was ~2ms,
   * an md5 over ids and timestamps ~10ms). Used for the dump's ETag and
   * edge-cache key.
   */
  async getDatasetVersion(): Promise<DatasetVersion> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        cursor: Date;
        max_updated_at: Date | null;
        count: bigint | number;
        updated_at_sum: string | null;
      }>
    >(Prisma.sql`
      SELECT
        now() - ${SYNC_CURSOR_OVERLAP} AS cursor,
        max(updated_at) AS max_updated_at,
        count(*)::bigint AS count,
        (extract(epoch FROM sum(updated_at - timestamptz 'epoch')) * 1000000)::numeric(40, 0)::text
          AS updated_at_sum
      FROM toilets
    `);
    if (!row) throw new Error("Failed to read dataset version");
    return {
      maxUpdatedAt: row.max_updated_at ? new Date(row.max_updated_at).getTime() : 0,
      count: Number(row.count),
      updatedAtSum: row.updated_at_sum ?? "0",
      cursor: new Date(row.cursor).toISOString(),
    };
  }

  /**
   * Retrieves map changes since a server-issued cursor: loos now on the map
   * (`upserted`) and loos that left it, by deactivation or losing their
   * location (`deleted`).
   */
  async getUpdates(since: Date): Promise<{ upserted: CompressedLoo[]; deleted: string[] }> {
    const rows = await this.prisma.toilets.findMany({
      where: {
        updated_at: { gt: since },
      },
      select: compressedLooSelect,
    });

    const upserted: CompressedLoo[] = [];
    const deleted: string[] = [];

    for (const row of rows) {
      if (isMapVisible(row)) {
        upserted.push(compressLooRow(row));
      } else {
        deleted.push(row.id);
      }
    }

    return { upserted, deleted };
  }

  /**
   * Finds loos within a specified radius (in meters) of a coordinate.
   * Uses PostGIS spherical distance calculation.
   */
  async getByProximity(lat: number, lng: number, radius: number): Promise<NearbyLooResponse[]> {
    const query = buildProximityQuery(lat, lng, radius);
    const loos = (await this.prisma.$queryRaw<RawNearbyLooRow[]>(query)) ?? [];

    return loos.map((loo: RawNearbyLooRow) => {
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
    const { hydrate = false, includeContributors = false } = options;
    const reportRecords = await this.prisma.record_version.findMany({
      where: { record: { path: ["id"], equals: id } },
      select: { record: true, old_record: true, id: true },
      orderBy: { ts: "asc" },
    });

    // We filter out system location updates as they are not user-contributed
    // and are left over from our old system where we recorded a separate
    // location report for each loo.
    const mapped = reportRecords
      .map((entry: Parameters<typeof mapAuditRecordToReport>[0]) => mapAuditRecordToReport(entry))
      .filter((report: ReportResponse) => !report.contributor?.endsWith("-location"));

    const sortedReports = [...mapped].sort((a, b) => {
      const timeA = Date.parse(a.createdAt);
      const timeB = Date.parse(b.createdAt);

      if (!Number.isNaN(timeA) && !Number.isNaN(timeB) && timeA !== timeB) {
        return timeA - timeB;
      }

      return a.id.localeCompare(b.id);
    });

    const sanitizedReports = includeContributors
      ? sortedReports
      : sortedReports.map((report) => ({ ...report, contributor: null }));

    if (hydrate) return sanitizedReports;

    return sanitizedReports.map(({ id: reportId, contributor, createdAt, diff }) => ({
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
    contributor: string | null,
  ): Promise<LooResponse | null> {
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
      });
    });

    return this.getById(id);
  }

  /**
   * Inserts a new loo inside a caller-owned transaction. The caller is
   * responsible for reloading the record after the transaction commits.
   */
  async createInTransaction(
    tx: Prisma.TransactionClient,
    id: string,
    mutation: LooMutationAttributes,
    contributor: string | null,
  ): Promise<void> {
    await insertLoo({
      tx,
      id,
      data: mapMutationToPrismaData(mutation, { forCreate: true }),
      mutation,
      contributor,
    });
    this.looCache.delete(id);
  }

  /**
   * Strictly updates an existing loo. Unlike {@link upsert}, this never inserts:
   * if the loo does not exist the result is `not_found`.
   *
   * @param options.expectedUpdatedAt - Optimistic-concurrency token (the
   *   `updatedAt` the change was computed against). When supplied and the row
   *   has been modified since, nothing is written and the result is `conflict`.
   * @param options.tx - Run inside a caller-owned transaction. The returned
   *   `loo` is then read through that transaction.
   */
  async updateExisting(
    id: string,
    mutation: LooMutationAttributes,
    contributor: string | null,
    options: { expectedUpdatedAt?: string | null; tx?: Prisma.TransactionClient } = {},
  ): Promise<UpdateExistingResult> {
    const { expectedUpdatedAt, tx: outerTx } = options;
    const expected =
      expectedUpdatedAt === undefined
        ? undefined
        : expectedUpdatedAt === null
          ? null
          : new Date(expectedUpdatedAt);

    const run = async (tx: Prisma.TransactionClient): Promise<UpdateExistingResult> => {
      const updatedCount = await updateLoo({
        tx,
        id,
        data: mapMutationToPrismaData(mutation, { forCreate: false }),
        mutation,
        contributor,
        expectedUpdatedAt: expected,
      });
      this.looCache.delete(id);

      if (updatedCount > 0) return { status: "updated", loo: null };

      const stillExists = await tx.toilets.findUnique({ where: { id }, select: { id: true } });
      return stillExists ? { status: "conflict" } : { status: "not_found" };
    };

    if (outerTx) {
      const result = await run(outerTx);
      if (result.status !== "updated") return result;
      const base = await this.getMutationBase(id, outerTx);
      if (!base) return { status: "updated", loo: null };
      const { areaId: _areaId, ...loo } = base;
      return { status: "updated", loo };
    }

    const result = await this.prisma.$transaction(run);
    if (result.status !== "updated") return result;
    return { status: "updated", loo: await this.getById(id) };
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
    contributor: string | null,
  ): Promise<LooResponse | null> {
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
      });

      // Invalidate cache
      this.looCache.delete(id);

      // 2. If no rows were updated, it means the loo doesn't exist.
      //    So we insert a new record instead.
      if (updatedCount === 0) {
        await insertLoo({
          tx,
          id,
          data: dataForCreate,
          mutation,
          contributor,
        });
      }
    });

    return this.getById(id);
  }
}
