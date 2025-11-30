import { Prisma } from "../../prisma";
import type { LooSearchParams, LooSearchSort } from "./types";

// Centralised SQL fragments for read-heavy loo operations.

const BASE_COLUMNS: readonly Prisma.Sql[] = [
  Prisma.sql`loo.id`,
  Prisma.sql`loo.name`,
  Prisma.sql`loo.created_at`,
  Prisma.sql`loo.updated_at`,
  Prisma.sql`loo.verified_at`,
  Prisma.sql`loo.geohash`,
  Prisma.sql`loo.accessible`,
  Prisma.sql`loo.active`,
  Prisma.sql`loo.all_gender`,
  Prisma.sql`loo.attended`,
  Prisma.sql`loo.automatic`,
  Prisma.sql`loo.baby_change`,
  Prisma.sql`loo.children`,
  Prisma.sql`loo.men`,
  Prisma.sql`loo.women`,
  Prisma.sql`loo.urinal_only`,
  Prisma.sql`loo.notes`,
  Prisma.sql`loo.no_payment`,
  Prisma.sql`loo.payment_details`,
  Prisma.sql`loo.removal_reason`,
  Prisma.sql`loo.opening_times`,
  Prisma.sql`loo.radar`,
  Prisma.sql`loo.location`,
  Prisma.sql`loo.area_id`,
  Prisma.sql`area.name AS area_name`,
  Prisma.sql`area.type AS area_type`,
];

const joinColumns = (columns: readonly Prisma.Sql[]) => Prisma.join(columns, ",\n      ");

const buildSelectClause = (extraColumns?: Prisma.Sql | Prisma.Sql[]) => {
  const extras = Array.isArray(extraColumns) ? extraColumns : extraColumns ? [extraColumns] : [];
  return Prisma.sql`
    SELECT
      ${joinColumns([...BASE_COLUMNS, ...extras])}
  `;
};

const LOO_FROM_WITH_AREA = Prisma.sql`
  FROM toilets loo
  LEFT JOIN areas area ON area.id = loo.area_id
`;

const SORT_ORDER_SQL: Record<LooSearchSort, Prisma.Sql> = {
  "updated-desc": Prisma.sql`loo.updated_at DESC NULLS LAST`,
  "updated-asc": Prisma.sql`loo.updated_at ASC NULLS LAST`,
  "created-desc": Prisma.sql`loo.created_at DESC NULLS LAST`,
  "created-asc": Prisma.sql`loo.created_at ASC NULLS LAST`,
  "verified-desc": Prisma.sql`loo.verified_at DESC NULLS LAST`,
  "verified-asc": Prisma.sql`loo.verified_at ASC NULLS LAST`,
  "name-asc": Prisma.sql`loo.name ASC NULLS LAST`,
  "name-desc": Prisma.sql`loo.name DESC NULLS LAST`,
};

const escapeForLike = (value: string) => value.replace(/[%_\\]/g, (char) => `\\${char}`);

/**
 * Whitelist of allowed column names for LIKE queries
 * This prevents SQL injection by ensuring only valid columns can be queried
 */
const ALLOWED_LIKE_COLUMNS = {
  "loo.name": Prisma.sql`loo.name`,
  "loo.geohash": Prisma.sql`loo.geohash`,
  "loo.notes": Prisma.sql`loo.notes`,
  "area.name": Prisma.sql`area.name`,
  "area.type": Prisma.sql`area.type`,
} as const;

type AllowedLikeColumn = keyof typeof ALLOWED_LIKE_COLUMNS;

/**
 * Safe LIKE condition builder using whitelisted columns
 */
const likeCondition = (column: AllowedLikeColumn, term: string) =>
  Prisma.sql`${ALLOWED_LIKE_COLUMNS[column]} ILIKE ${term} ESCAPE '\\'`;

/**
 * Whitelist of allowed column names for boolean conditions
 */
const ALLOWED_BOOLEAN_COLUMNS = {
  "loo.active": Prisma.sql`loo.active`,
  "loo.accessible": Prisma.sql`loo.accessible`,
  "loo.all_gender": Prisma.sql`loo.all_gender`,
  "loo.radar": Prisma.sql`loo.radar`,
  "loo.baby_change": Prisma.sql`loo.baby_change`,
  "loo.no_payment": Prisma.sql`loo.no_payment`,
} as const;

type AllowedBooleanColumn = keyof typeof ALLOWED_BOOLEAN_COLUMNS;

/**
 * Safe boolean condition builder using whitelisted columns
 */
const addNullableBooleanCondition = (
  column: AllowedBooleanColumn,
  value: boolean | null | undefined,
  conditions: Prisma.Sql[],
) => {
  if (value === undefined) return;
  const columnSql = ALLOWED_BOOLEAN_COLUMNS[column];
  if (value === null) {
    conditions.push(Prisma.sql`${columnSql} IS NULL`);
    return;
  }
  conditions.push(Prisma.sql`${columnSql} = ${value}`);
};

type SearchFilterParams = Pick<
  LooSearchParams,
  | "search"
  | "areaName"
  | "areaType"
  | "active"
  | "accessible"
  | "allGender"
  | "radar"
  | "babyChange"
  | "noPayment"
  | "verified"
  | "hasLocation"
>;

const buildSearchFilterConditions = (params: SearchFilterParams) => {
  const conditions: Prisma.Sql[] = [];

  if (params.search) {
    const likeTerm = `%${escapeForLike(params.search)}%`;
    conditions.push(
      Prisma.sql`(
        LOWER(loo.id) = LOWER(${params.search}) OR
        ${likeCondition("loo.name", likeTerm)} OR
        ${likeCondition("loo.geohash", likeTerm)} OR
        ${likeCondition("loo.notes", likeTerm)}
      )`,
    );
  }

  if (params.areaName) {
    const likeTerm = `%${escapeForLike(params.areaName)}%`;
    conditions.push(likeCondition("area.name", likeTerm));
  }

  if (params.areaType) {
    const likeTerm = `%${escapeForLike(params.areaType)}%`;
    conditions.push(likeCondition("area.type", likeTerm));
  }

  addNullableBooleanCondition("loo.active", params.active, conditions);
  addNullableBooleanCondition("loo.accessible", params.accessible, conditions);
  addNullableBooleanCondition("loo.all_gender", params.allGender, conditions);
  addNullableBooleanCondition("loo.radar", params.radar, conditions);
  addNullableBooleanCondition("loo.baby_change", params.babyChange, conditions);
  addNullableBooleanCondition("loo.no_payment", params.noPayment, conditions);

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

  return conditions;
};

const buildWhereClauseFromConditions = (conditions: Prisma.Sql[]) =>
  conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.sql``;

const extractSearchFilters = (params: LooSearchParams): SearchFilterParams => ({
  search: params.search,
  areaName: params.areaName,
  areaType: params.areaType,
  active: params.active,
  accessible: params.accessible,
  allGender: params.allGender,
  radar: params.radar,
  babyChange: params.babyChange,
  noPayment: params.noPayment,
  verified: params.verified,
  hasLocation: params.hasLocation,
});

export const createSearchWhereBuilder = (params: LooSearchParams) => {
  const filterParams = extractSearchFilters(params);
  const baseConditions = buildSearchFilterConditions(filterParams);

  return (extra?: Prisma.Sql | Prisma.Sql[]) => {
    const extras = extra ? (Array.isArray(extra) ? extra : [extra]) : [];
    return buildWhereClauseFromConditions([...baseConditions, ...extras]);
  };
};

type BuildSearchQueryArgs = {
  params: LooSearchParams;
  limit: number;
  offset: number;
};

/**
 * Builds the SQL queries for searching loos with pagination.
 * Returns both the data query and the count query.
 */
export const buildSearchQueries = ({ params, limit, offset }: BuildSearchQueryArgs) => {
  const buildWhere = createSearchWhereBuilder(params);
  const orderExpression = SORT_ORDER_SQL[params.sort] ?? SORT_ORDER_SQL["updated-desc"];
  const orderSql = Prisma.sql`ORDER BY ${Prisma.join([orderExpression, Prisma.sql`loo.id ASC`])}`;
  const whereClause = buildWhere();

  const dataQuery = Prisma.sql`
    ${buildSelectClause()}
    ${LOO_FROM_WITH_AREA}
    ${whereClause}
    ${orderSql}
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  const countQuery = Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    ${LOO_FROM_WITH_AREA}
    ${whereClause}
  `;

  return { dataQuery, countQuery };
};

/**
 * Builds a SQL query to select loos by a list of IDs.
 * Preserves the order of IDs in the result.
 */
export const buildSelectByIdsQuery = (ids: readonly string[]) => {
  if (!ids.length) throw new Error("buildSelectByIdsQuery requires ids");
  return Prisma.sql`
    ${buildSelectClause()}
    ${LOO_FROM_WITH_AREA}
    WHERE loo.id = ANY(${ids})
    ORDER BY array_position(${ids}, loo.id)
  `;
};

/**
 * Builds a SQL query to find loos within a certain radius of a point.
 * Uses PostGIS `ST_DistanceSphere` for calculation.
 */
export const buildProximityQuery = (lat: number, lng: number, radius: number) => {
  const distanceSql = Prisma.sql`ST_DistanceSphere(
    loo.geography::geometry,
    ST_MakePoint(${lng}, ${lat})
  )`;

  return Prisma.sql`
    ${buildSelectClause(Prisma.sql`${distanceSql} AS distance`)}
    ${LOO_FROM_WITH_AREA}
    WHERE ${distanceSql} <= ${radius}
  `;
};
