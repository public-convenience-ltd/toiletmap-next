/**
 * Query resolvers for the legacy GraphQL API. Each one validates its
 * arguments the way the legacy API did, calls one service method and maps
 * the result; there is no business logic here.
 *
 * Errors: a plain `Error` is masked to "Unexpected error." (what the legacy
 * API returned for its own failures, e.g. an unknown `loo` id or a bad page
 * size). A `GraphQLError` keeps its message; those are only used for the
 * limits this endpoint adds, so callers can see what to change.
 */
import { GraphQLError } from "graphql";
import type { PrismaClientInstance } from "../../prisma";
import { getToiletStatistics, listAreas } from "../../services/area.service";
import type { LooService } from "../../services/loo";
import type { LooResponse } from "../../services/loo/types";
import { LEGACY_GRAPHQL_LIMITS } from "./limits";
import { compressLegacyFullLoo, compressLegacyLoo, toLegacyLoo, toLegacyReports } from "./mappers";

export type LegacyGraphqlContext = {
  looService: LooService;
  /** Lazily created client for the area queries (the loo service keeps its own). */
  getPrisma: () => PrismaClientInstance;
  /** Geohash root fields with a prefix shorter than {@link LEGACY_GRAPHQL_LIMITS.minPreciseGeohashLength} run so far. */
  broadGeohashReads: number;
};

type LooFilterInput = {
  active?: boolean | null;
  noPayment?: boolean | null;
  text?: string | null;
  fromDate?: Date | null;
  toDate?: Date | null;
  contributors?: Array<string | null> | null;
  areaName?: string | null;
};

type LoosArgs = {
  filters: LooFilterInput;
  pagination?: { limit?: number | null; page?: number | null } | null;
  sort?: "NEWEST_FIRST" | "OLDEST_FIRST" | null;
};

type ProximityArgs = { from: { lat: number; lng: number; maxDistance?: number | null } };

type GeohashArgs = { geohash: string; active?: boolean | null };

/**
 * The legacy `getLoosWithinGeohash`: `startsWith(geohash)` and
 * `active = <arg>`, where an explicit null means `active IS NULL`.
 */
const loosWithinGeohash = async (
  context: LegacyGraphqlContext,
  { geohash, active }: GeohashArgs,
): Promise<LooResponse[]> => {
  const { looService } = context;
  // An empty prefix would match every toilet in the country.
  if (!geohash) throw new GraphQLError("geohash must not be empty.");
  // Short prefixes cover huge areas (the legacy web map asked for 2-character
  // cells when zoomed out), so a request may hold only one of them. Checked
  // here rather than in the cost rule because the prefix is often a variable.
  const { minPreciseGeohashLength, maxBroadGeohashFields } = LEGACY_GRAPHQL_LIMITS;
  if (geohash.length < minPreciseGeohashLength) {
    context.broadGeohashReads += 1;
    if (context.broadGeohashReads > maxBroadGeohashFields) {
      throw new GraphQLError(
        `Only ${maxBroadGeohashFields} geohash query with a prefix shorter than ${minPreciseGeohashLength} characters is allowed per request.`,
      );
    }
  }
  if (typeof active === "boolean") return looService.getWithinGeohash(geohash, active);
  const loos = await looService.getWithinGeohash(geohash);
  return loos.filter((loo) => loo.active === null);
};

export const queryResolvers = {
  loo: async (args: { id?: string | null }, { looService }: LegacyGraphqlContext) => {
    if (args.id == null) throw new Error("loo requires an id");
    const loo = await looService.getById(args.id);
    // Legacy mapped the missing row anyway and failed; keep that response.
    if (!loo) throw new Error("Loo not found");
    return toLegacyLoo(loo);
  },

  loos: async ({ filters, pagination, sort }: LoosArgs, { looService }: LegacyGraphqlContext) => {
    const limit = pagination?.limit;
    const page = pagination?.page;
    // Same checks as legacy: negative values and pages over 100 are refused.
    if (typeof limit !== "number" || typeof page !== "number" || limit < 0 || page < 0) {
      throw new Error("Invalid pagination params");
    }
    if (limit > LEGACY_GRAPHQL_LIMITS.maxPageSize) {
      throw new Error("Pagination size limit exceeded.");
    }
    // Legacy page 0 failed on Prisma's negative `skip`, except with limit 0
    // (a count-only query), which returned an empty page.
    if (page < 1 && limit > 0) throw new Error("Invalid pagination params");

    // `contributors` was accepted but never applied by the legacy API.
    const { data, total } = await looService.searchLegacy({
      active: filters.active,
      noPayment: filters.noPayment,
      nameContains: filters.text || undefined,
      areaName: filters.areaName || undefined,
      updatedFrom: filters.fromDate ?? undefined,
      updatedTo: filters.toDate ?? undefined,
      order: sort === "OLDEST_FIRST" ? "asc" : "desc",
      limit,
      offset: Math.max(0, (page - 1) * limit),
    });

    return {
      loos: data.map(toLegacyLoo),
      total,
      page,
      limit,
      // With limit 0 this is Infinity (or NaN): like legacy, `pages` then
      // fails Int serialization on its own and the rest of the page is kept.
      pages: Math.ceil(total / limit),
    };
  },

  statistics: (_args: unknown, { getPrisma }: LegacyGraphqlContext) =>
    getToiletStatistics(getPrisma()),

  loosByProximity: async ({ from }: ProximityArgs, { looService }: LegacyGraphqlContext) => {
    const { lat, lng, maxDistance } = from;
    // Legacy compared `distance <= null`, which matches nothing.
    if (maxDistance == null || maxDistance < 0) return [];
    if (maxDistance > LEGACY_GRAPHQL_LIMITS.maxDistance) {
      throw new GraphQLError(
        `maxDistance must be at most ${LEGACY_GRAPHQL_LIMITS.maxDistance} metres.`,
      );
    }
    // Legacy returned removed loos too, and inner-joined areas, so a loo
    // outside every area was left out.
    const loos = await looService.getByProximity(lat, lng, maxDistance, { includeInactive: true });
    return loos.filter((loo) => loo.area.length > 0).map(toLegacyLoo);
  },

  looNamesByIds: async (
    { idList }: { idList?: Array<string | null> | null },
    { looService }: LegacyGraphqlContext,
  ) => {
    // Legacy turned a missing list into "every toilet"; refuse instead.
    if (idList == null) throw new GraphQLError("idList is required.");
    const ids = [...new Set(idList.filter((id): id is string => typeof id === "string" && !!id))];
    if (ids.length > LEGACY_GRAPHQL_LIMITS.maxIds) {
      throw new GraphQLError(`idList may contain at most ${LEGACY_GRAPHQL_LIMITS.maxIds} ids.`);
    }
    const loos = await looService.getByIds(ids);
    return loos.map(({ id, name }) => ({ id, name }));
  },

  areas: (_args: unknown, { getPrisma }: LegacyGraphqlContext) => listAreas(getPrisma()),

  loosByGeohash: async (args: GeohashArgs, context: LegacyGraphqlContext) =>
    (await loosWithinGeohash(context, args)).map(compressLegacyLoo),

  fullLoosByGeohash: async (args: GeohashArgs, context: LegacyGraphqlContext) =>
    (await loosWithinGeohash(context, args)).map(compressLegacyFullLoo),

  reportsForLoo: async ({ id }: { id: string }, { looService }: LegacyGraphqlContext) =>
    toLegacyReports(await looService.getAuditSnapshots(id)),
};
