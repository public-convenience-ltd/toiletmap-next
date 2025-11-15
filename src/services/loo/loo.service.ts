import {
  Prisma,
  PrismaClient,
  toilets,
} from  "../../../prisma/src/generated/prisma/client";
import { prisma as defaultPrisma } from '../../prisma';
import {
  areaSelection,
  buildAreaFromJoin,
  mapAuditRecordToReport,
  mapLoo,
  mapNearbyLoo,
} from './mappers';
import { mapMutationToPrismaData } from './mutation';
import type {
  LooMutationAttributes,
  LooResponse,
  NearbyLooResponse,
  ReportResponse,
  ReportSummaryResponse,
  LooSearchParams,
  LooSearchSort,
} from './types';

const emptyTextArray = Prisma.sql`ARRAY[]::text[]`;

const buildContributorsInsertValue = (contributor: string | null | undefined) =>
  contributor
    ? Prisma.sql`ARRAY[${contributor}]`
    : emptyTextArray;

const buildContributorsUpdateClause = (contributor: string | null | undefined) =>
  contributor
    ? Prisma.sql`
        contributors = CASE
          WHEN array_length(contributors, 1) IS NULL THEN ARRAY[${contributor}]
          ELSE array_append(contributors, ${contributor})
        END
      `
    : null;

const geographyExpression = (
  location: LooMutationAttributes['location'],
) => {
  if (location === undefined) return null;
  if (location === null) return Prisma.sql`NULL`;
  return Prisma.sql`
    ST_SetSRID(
      ST_MakePoint(${location.lng}, ${location.lat}),
      4326
    )::geography
  `;
};

const SORT_ORDER_SQL: Record<LooSearchSort, Prisma.Sql> = {
  'updated-desc': Prisma.sql`loo.updated_at DESC NULLS LAST`,
  'updated-asc': Prisma.sql`loo.updated_at ASC NULLS LAST`,
  'created-desc': Prisma.sql`loo.created_at DESC NULLS LAST`,
  'created-asc': Prisma.sql`loo.created_at ASC NULLS LAST`,
  'verified-desc': Prisma.sql`loo.verified_at DESC NULLS LAST`,
  'verified-asc': Prisma.sql`loo.verified_at ASC NULLS LAST`,
  'name-asc': Prisma.sql`loo.name ASC NULLS LAST`,
  'name-desc': Prisma.sql`loo.name DESC NULLS LAST`,
};

const escapeForLike = (value: string) =>
  value.replace(/[%_\\]/g, (char) => `\\${char}`);

const likeCondition = (column: string, term: string) =>
  Prisma.sql`${Prisma.raw(column)} ILIKE ${term} ESCAPE '\\'`;

const addNullableBooleanCondition = (
  column: string,
  value: boolean | null | undefined,
  conditions: Prisma.Sql[],
) => {
  if (value === undefined) return;
  if (value === null) {
    conditions.push(Prisma.sql`${Prisma.raw(column)} IS NULL`);
    return;
  }
  conditions.push(Prisma.sql`${Prisma.raw(column)} = ${value}`);
};

const addBooleanCondition = (
  column: string,
  value: boolean | undefined,
  conditions: Prisma.Sql[],
) => {
  if (value === undefined) return;
  conditions.push(Prisma.sql`${Prisma.raw(column)} = ${value}`);
};

const toColumnValueSql = (column: string, value: unknown) => {
  if (column === 'opening_times' && value !== null) {
    return Prisma.sql`${JSON.stringify(value)}::jsonb`;
  }
  return Prisma.sql`${value}`;
};

const executeInsert = async (
  tx: Prisma.TransactionClient,
  id: string,
  data: Prisma.toiletsUncheckedCreateInput,
  mutation: LooMutationAttributes,
  contributor: string | null,
  now: Date,
) => {
  const columns = [
    Prisma.raw('id'),
    Prisma.raw('created_at'),
    Prisma.raw('updated_at'),
    Prisma.raw('contributors'),
  ];
  const values: Prisma.Sql[] = [
    Prisma.sql`${id}`,
    Prisma.sql`${now}`,
    Prisma.sql`${now}`,
    buildContributorsInsertValue(contributor),
  ];

  for (const [key, value] of Object.entries(data)) {
    columns.push(Prisma.raw(key));
    values.push(toColumnValueSql(key, value));
  }

  const geographySql = geographyExpression(mutation.location);
  if (geographySql) {
    columns.push(Prisma.raw('geography'));
    values.push(geographySql);
  }

  const insertSql = Prisma.sql`
    INSERT INTO toilets (${Prisma.join(columns)})
    VALUES (${Prisma.join(values)})
  `;

  await tx.$executeRaw(insertSql);
};

const executeUpdate = async (
  tx: Prisma.TransactionClient,
  id: string,
  data: Prisma.toiletsUncheckedUpdateInput,
  mutation: LooMutationAttributes,
  contributor: string | null,
  now: Date,
) => {
  const assignments: Prisma.Sql[] = [Prisma.sql`updated_at = ${now}`];

  for (const [key, value] of Object.entries(data)) {
    assignments.push(
      Prisma.sql`${Prisma.raw(key)} = ${toColumnValueSql(key, value)}`,
    );
  }

  const geographySql = geographyExpression(mutation.location);
  if (geographySql) {
    assignments.push(Prisma.sql`geography = ${geographySql}`);
  }

  const contributorSql = buildContributorsUpdateClause(contributor);
  if (contributorSql) assignments.push(contributorSql);

  const updateSql = Prisma.sql`
    UPDATE toilets
    SET ${Prisma.join(assignments)}
    WHERE id = ${id}
  `;

  const result = await tx.$executeRaw(updateSql);
  return Number(result);
};

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

    const rows =
      (await this.prisma.$queryRaw<
        Array<
          (toilets & { area_name?: string; area_type?: string }) & { id: string }
        >
      >`SELECT
        loo.id,
        loo.name,
        loo.created_at,
        loo.updated_at,
        loo.verified_at,
        loo.geohash,
        loo.accessible,
        loo.active,
        loo.all_gender,
        loo.attended,
        loo.automatic,
        loo.baby_change,
        loo.children,
        loo.men,
        loo.women,
        loo.urinal_only,
        loo.notes,
        loo.no_payment,
        loo.payment_details,
        loo.removal_reason,
        loo.opening_times,
        loo.radar,
        loo.location,
        area.name as area_name,
        area.type as area_type
      FROM toilets loo
      LEFT JOIN areas area ON area.id = loo.area_id
      WHERE loo.id = ANY(${ids})
      ORDER BY array_position(${ids}, loo.id)
    `) ?? [];

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

    const conditions: Prisma.Sql[] = [];

    if (params.search) {
      const likeTerm = `%${escapeForLike(params.search)}%`;
      conditions.push(
        Prisma.sql`(
          LOWER(loo.id) = LOWER(${params.search}) OR
          ${likeCondition('loo.name', likeTerm)} OR
          ${likeCondition('loo.geohash', likeTerm)} OR
          ${likeCondition('loo.notes', likeTerm)}
        )`,
      );
    }

    if (params.areaName) {
      const likeTerm = `%${escapeForLike(params.areaName)}%`;
      conditions.push(likeCondition('area.name', likeTerm));
    }

    if (params.areaType) {
      const likeTerm = `%${escapeForLike(params.areaType)}%`;
      conditions.push(likeCondition('area.type', likeTerm));
    }

    addNullableBooleanCondition('loo.active', params.active, conditions);
    addNullableBooleanCondition('loo.accessible', params.accessible, conditions);
    addNullableBooleanCondition('loo.all_gender', params.allGender, conditions);
    addNullableBooleanCondition('loo.radar', params.radar, conditions);
    addNullableBooleanCondition('loo.baby_change', params.babyChange, conditions);
    addNullableBooleanCondition('loo.no_payment', params.noPayment, conditions);

    if (params.verified !== undefined) {
      conditions.push(
        params.verified
          ? Prisma.sql`loo.verified_at IS NOT NULL`
          : Prisma.sql`loo.verified_at IS NULL`,
      );
    }

    if (params.hasLocation !== undefined) {
      conditions.push(
        params.hasLocation
          ? Prisma.sql`loo.geography IS NOT NULL`
          : Prisma.sql`loo.geography IS NULL`,
      );
    }

    const orderExpression =
      SORT_ORDER_SQL[params.sort] ?? SORT_ORDER_SQL['updated-desc'];
    const orderSql = Prisma.sql`ORDER BY ${Prisma.join([
      orderExpression,
      Prisma.sql`loo.id ASC`,
    ])}`;

    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.sql``;

    const fromClause = Prisma.sql`
      FROM toilets loo
      LEFT JOIN areas area ON area.id = loo.area_id
    `;

    const dataQuery = Prisma.sql`
      SELECT
        loo.id,
        loo.name,
        loo.created_at,
        loo.updated_at,
        loo.verified_at,
        loo.geohash,
        loo.accessible,
        loo.active,
        loo.all_gender,
        loo.attended,
        loo.automatic,
        loo.baby_change,
        loo.children,
        loo.men,
        loo.women,
        loo.urinal_only,
        loo.notes,
        loo.no_payment,
        loo.payment_details,
        loo.removal_reason,
        loo.opening_times,
        loo.radar,
        loo.location,
        area.name as area_name,
        area.type as area_type
      ${fromClause}
      ${whereClause}
      ${orderSql}
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const rows =
      (await this.prisma.$queryRaw<
        Array<
          (toilets & { area_name?: string; area_type?: string }) & { id: string }
        >
      >(dataQuery)) ?? [];

    const countQuery = Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      ${fromClause}
      ${whereClause}
    `;

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
    const loos =
      (await this.prisma.$queryRaw<
        Array<
          (toilets & { area_name?: string; area_type?: string }) & {
            distance: number;
          }
        >
      >`
      SELECT
        loo.id, loo.name, loo.active, loo.men, loo.women, loo.no_payment, loo.notes, loo.opening_times,
        loo.payment_details, loo.accessible, loo.all_gender, loo.attended, loo.automatic, loo.location,
        loo.baby_change, loo.children, loo.created_at, loo.removal_reason, loo.radar, loo.urinal_only,
        loo.verified_at, loo.updated_at, loo.geohash,
        ST_DistanceSphere(loo.geography::geometry, ST_MakePoint(${lng}, ${lat})) as distance,
        area.name as area_name,
        area.type as area_type
      FROM toilets loo
      LEFT JOIN areas area ON area.id = loo.area_id
      WHERE ST_DistanceSphere(loo.geography::geometry, ST_MakePoint(${lng}, ${lat})) <= ${radius}
    `) ?? [];

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
      await executeInsert(tx, id, dataForCreate, mutation, contributor, now);
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
      const updatedCount = await executeUpdate(
        tx,
        id,
        dataForUpdate,
        mutation,
        contributor,
        now,
      );

      if (updatedCount === 0) {
        await executeInsert(
          tx,
          id,
          dataForCreate,
          mutation,
          contributor,
          now,
        );
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
