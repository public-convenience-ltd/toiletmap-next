import { Prisma, PrismaClientInstance, toilets } from '../../prisma';
import {
  areaSelection,
  buildAreaFromJoin,
  mapAuditRecordToReport,
  mapLoo,
  mapNearbyLoo,
} from './mappers';
import { mapMutationToPrismaData } from './mutation';
import { insertLoo, updateLoo } from './persistence';
import {
  buildProximityQuery,
  buildSearchQueries,
  buildSelectByIdsQuery,
  type RawLooRow,
  type RawNearbyLooRow,
} from './sql';
import type {
  LooMutationAttributes,
  LooResponse,
  NearbyLooResponse,
  ReportResponse,
  ReportSummaryResponse,
  LooSearchParams,
} from './types';

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
  constructor(private readonly prisma: PrismaClientInstance) { }

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
    const rows =
      (await this.prisma.$queryRaw<RawLooRow[]>(query)) ?? [];

    return rows.map((loo) =>
      mapLoo({
        ...(loo as toilets),
        areas: buildAreaFromJoin(loo.area_name, loo.area_type),
      }),
    );
  }

  /**
   * Searches for loos based on various criteria (text search, filters, etc.).
   * Supports pagination.
   */
  async search(
    params: LooSearchParams,
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
        countQuery,
      )) ?? [];

    const total =
      countRows.length > 0 && countRows[0]?.count !== undefined
        ? Number(countRows[0].count)
        : 0;

    const data = rows.map((loo) =>
      mapLoo({
        ...(loo as toilets),
        areas: buildAreaFromJoin(loo.area_name, loo.area_type),
      }),
    );

    return { data, total };
  }

  /**
   * Finds loos whose geohash starts with the given string.
   * Useful for map-based tiling or broad area searches.
   */
  async getWithinGeohash(
    geohash: string,
    active?: boolean | null,
  ): Promise<LooResponse[]> {
    const where = {
      geohash: { startsWith: geohash },
      ...(typeof active === 'boolean' ? { active: { equals: active } } : {}),
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
    radius: number,
  ): Promise<NearbyLooResponse[]> {
    const query = buildProximityQuery(lat, lng, radius);
    const loos =
      (await this.prisma.$queryRaw<RawNearbyLooRow[]>(query)) ?? [];

    return loos.map((loo) =>
      mapNearbyLoo({
        ...(loo as toilets),
        areas: buildAreaFromJoin(loo.area_name, loo.area_type),
        distance: loo.distance,
      }),
    );
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
    options: { hydrate?: boolean } = {},
  ): Promise<ReportResponse[] | ReportSummaryResponse[]> {
    const { hydrate = false } = options;
    const reportRecords = await this.prisma.record_version.findMany({
      where: { record: { path: ['id'], equals: id } },
      select: { record: true, old_record: true, id: true, ts: true },
      orderBy: { ts: 'desc' },
    });

    // We filter out system location updates as they are not user-contributed
    // and are left over from our old system where we recorded a separate
    // location report for each loo.
    const mapped = reportRecords
      .map((entry) => mapAuditRecordToReport(entry))
      .filter((report) => !report.contributor.endsWith('-location'));

    if (hydrate) return mapped;

    return mapped.map(
      ({ id: reportId, contributor, createdAt, isSystemReport, diff }) => ({
        id: reportId,
        contributor,
        createdAt,
        isSystemReport,
        diff,
      }),
    );
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
    const now = new Date();
    const dataForCreate = mapMutationToPrismaData(mutation, {
      forCreate: true,
    }) as Prisma.toiletsUncheckedCreateInput;

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
    contributor: string | null,
  ): Promise<LooResponse | null> {
    const now = new Date();
    const dataForCreate = mapMutationToPrismaData(mutation, {
      forCreate: true,
    }) as Prisma.toiletsUncheckedCreateInput;
    const dataForUpdate = mapMutationToPrismaData(mutation, {
      forCreate: false,
    }) as Prisma.toiletsUncheckedUpdateInput;

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
