import type { Prisma } from '../../generated/prisma-client';
import { PrismaClient, toilets } from '../../generated/prisma-client';
import { prisma as defaultPrisma } from '../../prisma';
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
 * Coordinates read/write interactions with loos while delegating heavy SQL
 * building to focused helpers for testability and security.
 */
export class LooService {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  async getById(id: string): Promise<LooResponse | null> {
    const row = await this.prisma.toilets.findUnique({
      where: { id },
      include: { areas: areaSelection },
    });
    return row ? mapLoo(row) : null;
  }

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

  async getReports(id: string, options: { hydrate: true }): Promise<ReportResponse[]>;
  async getReports(id: string, options?: { hydrate?: false }): Promise<ReportSummaryResponse[]>;
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

    const reloaded = await this.reloadLoo(id);
    return reloaded ? mapLoo(reloaded) : null;
  }

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
      const updatedCount = await updateLoo({
        tx,
        id,
        data: dataForUpdate,
        mutation,
        contributor,
        now,
      });

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

    const reloaded = await this.reloadLoo(id);
    return reloaded ? mapLoo(reloaded) : null;
  }

  async deleteById(id: string) {
    return this.prisma.toilets.delete({ where: { id } });
  }

  private reloadLoo(id: string) {
    return this.prisma.toilets.findUnique({
      where: { id },
      include: { areas: areaSelection },
    });
  }
}
