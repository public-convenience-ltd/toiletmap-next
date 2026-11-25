import { z } from "zod";
import {
  DEFAULT_PROXIMITY_RADIUS,
  LOO_ID_PATTERN,
  MAX_GEOHASH_PREFIX_LENGTH,
  MAX_IDS_PER_REQUEST,
  MAX_PROXIMITY_RADIUS,
  MAX_SEARCH_OFFSET,
  MAX_SEARCH_PAGE,
  MIN_GEOHASH_PREFIX_LENGTH,
  PROXIMITY_COORDINATE_DECIMALS,
  RECENT_WINDOW_DAYS,
} from "../../common/constants";
import {
  booleanField,
  booleanFilterSchema,
  createNumberParam,
  normalizeOptionalOption,
  normalizeOptionalString,
  nullableTrimmed,
  openingTimesSchema,
  optionalTrimmedFilter,
  triStateFilterSchema,
} from "../../common/schemas";
import { LOO_ID_LENGTH } from "../../services/loo";
import { LooSearchSortOptions, REMOVAL_CATEGORIES } from "../../services/loo/types";

const LOO_ID_MESSAGE = `must be a ${LOO_ID_LENGTH} character hexadecimal id`;

/**
 * The one loo id schema, for path parameters, `?ids=`, `exclude`, body ids,
 * `areaId` and `duplicateOf`: trimmed and lowercased, then exactly
 * {@link LOO_ID_PATTERN} (24 hex characters). Anything else is a 400 before
 * it reaches a query.
 */
export const looIdSchema = z.string().trim().toLowerCase().regex(LOO_ID_PATTERN, LOO_ID_MESSAGE);

const COORDINATE_SCALE = 10 ** PROXIMITY_COORDINATE_DECIMALS;

/** Rounds to {@link PROXIMITY_COORDINATE_DECIMALS} places (about 1 m); `+ 0` turns -0 into 0. */
const roundCoordinate = (value: number) =>
  Math.round(value * COORDINATE_SCALE) / COORDINATE_SCALE + 0;

export const proximitySchema = z
  .object({
    lat: z.coerce
      .number()
      .min(-90, "lat must be within -90 and 90")
      .max(90, "lat must be within -90 and 90")
      .transform(roundCoordinate),
    lng: z.coerce
      .number()
      .min(-180, "lng must be within -180 and 180")
      .max(180, "lng must be within -180 and 180")
      .transform(roundCoordinate),
    radius: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_PROXIMITY_RADIUS, `radius must be <= ${MAX_PROXIMITY_RADIUS} meters`)
      .default(DEFAULT_PROXIMITY_RADIUS),
    /** `true` also returns removed (inactive) loos, e.g. to offer "Is it back? Restore it". */
    includeInactive: z
      .preprocess(
        (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
        z.enum(["true", "false"]).optional(),
      )
      .transform((value) => value === "true"),
    /** A loo id to leave out of the results (the loo being edited). */
    exclude: looIdSchema.optional(),
  })
  .strict();

/**
 * A location in a write: finite WGS84 degrees. Non-admin writes must also
 * fall inside `SERVICE_AREA_BOUNDS`, checked by the route (see write-guards.ts).
 */
const mutationCoordinatesSchema = z
  .object({
    lat: z
      .number()
      .finite()
      .min(-90, "lat must be within -90 and 90")
      .max(90, "lat must be within -90 and 90"),
    lng: z
      .number()
      .finite()
      .min(-180, "lng must be within -180 and 180")
      .max(180, "lng must be within -180 and 180"),
  })
  .strict();

/**
 * Fields every caller may send in POST/PUT bodies. Non-admins may not send
 * `active` or `removalReason`, nor `location: null` (see write-guards.ts):
 * they report and restore instead. `removalCategory` and `duplicateOf` are
 * set only by report/restore, so no body may carry them.
 */
export const baseMutationSchema = z
  .object({
    name: nullableTrimmed(200),
    areaId: looIdSchema.nullable().optional(),
    accessible: booleanField,
    // `active` is a soft-delete flag: it must be an explicit true/false. A null
    // would silently hide the toilet from the map with no recorded reason.
    active: z.boolean().optional(),
    allGender: booleanField,
    attended: booleanField,
    automatic: booleanField,
    babyChange: booleanField,
    children: booleanField,
    men: booleanField,
    women: booleanField,
    urinalOnly: booleanField,
    radar: booleanField,
    notes: nullableTrimmed(2000),
    noPayment: booleanField,
    paymentDetails: nullableTrimmed(2000),
    removalReason: nullableTrimmed(2000),
    openingTimes: openingTimesSchema.optional(),
    // allow clearing with null (admins only) and omit with undefined
    location: mutationCoordinatesSchema.nullable().optional(),
  })
  .strict();

/** POST body. Only admins may choose the `id`; everyone else gets a generated one. */
export const createMutationSchema = baseMutationSchema.extend({
  id: looIdSchema.optional(),
});

/**
 * PUT body. `baseUpdatedAt` is the `updatedAt` the client loaded before editing;
 * when supplied and the record has changed since, the server responds 409.
 * It is a concurrency token only and is stripped before reaching the service.
 */
export const updateMutationSchema = baseMutationSchema.extend({
  baseUpdatedAt: z.iso
    .datetime({ offset: true, message: "baseUpdatedAt must be an ISO-8601 datetime" })
    .optional(),
});

const optionalBaseUpdatedAt = z.iso
  .datetime({ offset: true, message: "baseUpdatedAt must be an ISO-8601 datetime" })
  .optional();

/**
 * POST /loos/:id/report. `details` is required for `other`, `duplicateOf` for
 * `duplicate` (and only allowed there).
 */
export const reportSchema = z
  .object({
    reason: z.enum(REMOVAL_CATEGORIES, {
      message: `reason must be one of: ${REMOVAL_CATEGORIES.join(", ")}`,
    }),
    details: z
      .string()
      .trim()
      .max(2000, "details must be at most 2000 characters")
      .optional()
      .transform((value) => (value ? value : undefined)),
    duplicateOf: looIdSchema.optional(),
    baseUpdatedAt: optionalBaseUpdatedAt,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.reason === "other" && !value.details) {
      ctx.addIssue({
        code: "custom",
        path: ["details"],
        message: "Tell us what is wrong with this toilet",
      });
    }
    if (value.reason === "duplicate" && !value.duplicateOf) {
      ctx.addIssue({
        code: "custom",
        path: ["duplicateOf"],
        message: "Choose the toilet this one duplicates",
      });
    }
    if (value.reason !== "duplicate" && value.duplicateOf !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["duplicateOf"],
        message: "duplicateOf is only allowed when the reason is duplicate",
      });
    }
  });

/** POST /loos/:id/restore */
export const restoreSchema = z
  .object({
    details: z
      .string()
      .trim()
      .max(2000, "details must be at most 2000 characters")
      .optional()
      .transform((value) => (value ? value : undefined)),
    baseUpdatedAt: optionalBaseUpdatedAt,
  })
  .strict();

/**
 * Every query schema below is `.strict()`: an unknown parameter is a 400, so
 * junk parameters cannot be used to vary cache keys or smuggle options.
 */
const searchQueryShape = z
  .object({
    search: z.preprocess(normalizeOptionalString, optionalTrimmedFilter(200)),
    areaName: z.preprocess(normalizeOptionalString, optionalTrimmedFilter(200)),
    areaType: z.preprocess(normalizeOptionalString, optionalTrimmedFilter(100)),
    active: triStateFilterSchema,
    accessible: triStateFilterSchema,
    allGender: triStateFilterSchema,
    radar: triStateFilterSchema,
    babyChange: triStateFilterSchema,
    noPayment: triStateFilterSchema,
    verified: booleanFilterSchema,
    hasLocation: booleanFilterSchema,
    sort: z
      .preprocess(normalizeOptionalOption, z.enum(LooSearchSortOptions).default("updated-desc"))
      .default("updated-desc"),
    limit: createNumberParam(1, 200, 50),
    page: createNumberParam(1, MAX_SEARCH_PAGE, 1),
  })
  .strict();

/** The search query; the offset it implies is capped at {@link MAX_SEARCH_OFFSET}. */
export const searchQuerySchema = searchQueryShape.superRefine((value, ctx) => {
  if ((value.page - 1) * value.limit > MAX_SEARCH_OFFSET) {
    ctx.addIssue({
      code: "custom",
      path: ["page"],
      message: `page is too far in: (page - 1) * limit must be at most ${MAX_SEARCH_OFFSET}`,
    });
  }
});

export const metricsQuerySchema = searchQueryShape.extend({
  recentWindowDays: createNumberParam(1, 365, RECENT_WINDOW_DAYS),
});

// Path parameter validation schemas
export const looIdParamSchema = z
  .object({
    id: looIdSchema,
  })
  .strict();

/**
 * Geohash alphabet (base32 without a, i, l and o). Restricting the prefix to
 * it also means it can never contain a LIKE wildcard (`%`, `_`) or escape
 * character (`\\`), so the `startsWith` prefix match is always literal.
 */
const GEOHASH_PREFIX_PATTERN = new RegExp(
  `^[0-9bcdefghjkmnpqrstuvwxyz]{${MIN_GEOHASH_PREFIX_LENGTH},${MAX_GEOHASH_PREFIX_LENGTH}}$`,
);

export const geohashParamSchema = z
  .object({
    geohash: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        GEOHASH_PREFIX_PATTERN,
        `geohash must be ${MIN_GEOHASH_PREFIX_LENGTH}-${MAX_GEOHASH_PREFIX_LENGTH} geohash (base32) characters`,
      ),
  })
  .strict();

// Query parameter validation schemas
export const geohashQuerySchema = z
  .object({
    active: z
      .preprocess(
        (value) => {
          if (typeof value !== "string") return value;
          const normalized = value.trim().toLowerCase();
          if (normalized === "true") return "true";
          if (normalized === "false") return "false";
          if (normalized === "any" || normalized === "all") return "any";
          return "true";
        },
        z.enum(["true", "false", "any"]).default("true"),
      )
      .transform((value) => (value === "any" ? null : value === "true")),
    compressed: z
      .preprocess((value) => {
        if (typeof value !== "string") return value;
        return value.trim().toLowerCase();
      }, z.enum(["true", "false"]).optional())
      .transform((value) => value === "true"),
    summary: z
      .preprocess((value) => {
        if (typeof value !== "string") return value;
        return value.trim().toLowerCase();
      }, z.enum(["true", "false"]).optional())
      .transform((value) => value === "true"),
  })
  .strict();

export const dumpQuerySchema = z
  .object({
    rich: z
      .preprocess((value) => {
        if (typeof value !== "string") return value;
        return value.trim().toLowerCase();
      }, z.enum(["true", "false"]).optional())
      .transform((value) => value === "true"),
  })
  .strict();

export const reportsQuerySchema = z
  .object({
    hydrate: z
      .preprocess((value) => {
        if (typeof value !== "string") return value;
        return value.trim().toLowerCase();
      }, z.enum(["true", "false"]).optional())
      .transform((value) => value === "true"),
  })
  .strict();

export const idsQuerySchema = z
  .object({
    ids: z
      .union([z.string(), z.array(z.string())])
      .transform((value) => {
        const rawIds = Array.isArray(value) ? value : [value];
        const ids = rawIds
          .flatMap((v) => v.split(","))
          .map((v) => v.trim().toLowerCase())
          .filter((v) => v.length > 0);
        // Duplicates add nothing; the first occurrence keeps its place in the order.
        return [...new Set(ids)];
      })
      .refine((ids) => ids.length > 0, {
        message: "Provide ids query parameter (comma separated or repeated) to fetch loos",
      })
      .refine((ids) => ids.length <= MAX_IDS_PER_REQUEST, {
        message: `At most ${MAX_IDS_PER_REQUEST} ids per request`,
      })
      .refine((ids) => ids.every((id) => LOO_ID_PATTERN.test(id)), {
        message: `Each id ${LOO_ID_MESSAGE}`,
      }),
  })
  .strict();

export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type MetricsQuery = z.infer<typeof metricsQuerySchema>;

export const updatesQuerySchema = z
  .object({
    since: z.string().datetime({ message: "Invalid ISO date string for 'since' parameter" }),
  })
  .strict();
