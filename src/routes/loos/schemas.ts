import { z } from "zod";
import { LOO_ID_LENGTH } from "../../services/loo";
import {
  RECENT_WINDOW_DAYS,
  DEFAULT_PROXIMITY_RADIUS,
  MAX_PROXIMITY_RADIUS,
} from "../../common/constants";
import {
  CoordinatesSchema,
  LooSearchSortOptions,
} from "../../services/loo/types";
import {
  booleanField,
  booleanFilterSchema,
  createNumberParam,
  normalizeOptionalOption,
  normalizeOptionalString,
  nullableTrimmed,
  optionalTrimmedFilter,
  triStateFilterSchema,
  openingTimesSchema,
} from "../../common/schemas";

export const proximitySchema = z
  .object({
    lat: z.coerce
      .number()
      .min(-90, "lat must be within -90 and 90")
      .max(90, "lat must be within -90 and 90"),
    lng: z.coerce
      .number()
      .min(-180, "lng must be within -180 and 180")
      .max(180, "lng must be within -180 and 180"),
    radius: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_PROXIMITY_RADIUS, `radius must be <= ${MAX_PROXIMITY_RADIUS} meters`)
      .default(DEFAULT_PROXIMITY_RADIUS),
  })
  .strict();

export const baseMutationSchema = z
  .object({
    name: nullableTrimmed(200),
    areaId: z
      .string()
      .trim()
      .length(LOO_ID_LENGTH)
      .transform((s) => (s.length ? s : null))
      .nullable()
      .optional(),
    accessible: booleanField,
    active: booleanField,
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
    // allow clearing with null and omit with undefined
    location: CoordinatesSchema.nullable().optional(),
  })
  .strict();

export const createMutationSchema = baseMutationSchema.extend({
  id: z.string().trim().length(LOO_ID_LENGTH).optional(),
});

export const searchQuerySchema = z.object({
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
    .preprocess(
      normalizeOptionalOption,
      z.enum(LooSearchSortOptions).default("updated-desc")
    )
    .default("updated-desc"),
  limit: createNumberParam(1, 200, 50),
  page: createNumberParam(1, null, 1),
});

export const metricsQuerySchema = searchQuerySchema.extend({
  recentWindowDays: createNumberParam(1, 365, RECENT_WINDOW_DAYS),
});

// Path parameter validation schemas
export const looIdParamSchema = z.object({
  id: z.string().length(LOO_ID_LENGTH, `id must be exactly ${LOO_ID_LENGTH} characters`),
}).strict();

export const geohashParamSchema = z.object({
  geohash: z.string().min(1, 'geohash path parameter is required'),
}).strict();

// Query parameter validation schemas
export const geohashQuerySchema = z.object({
  active: z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return 'true';
    if (normalized === 'false') return 'false';
    if (normalized === 'any' || normalized === 'all') return 'any';
    return 'true';
  }, z.enum(['true', 'false', 'any']).default('true'))
  .transform((value) => value === 'any' ? null : value === 'true'),
});

export const reportsQuerySchema = z.object({
  hydrate: z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    return value.trim().toLowerCase();
  }, z.enum(['true', 'false']).optional())
  .transform((value) => value === 'true'),
});

export const idsQuerySchema = z.object({
  ids: z.union([z.string(), z.array(z.string())])
    .transform((value) => {
      const rawIds = Array.isArray(value) ? value : [value];
      return rawIds.flatMap((v) => v.split(',')).map((v) => v.trim()).filter((v) => v.length > 0);
    })
    .refine((ids) => ids.length > 0, {
      message: 'Provide ids query parameter (comma separated or repeated) to fetch loos',
    }),
}).strict();

export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type MetricsQuery = z.infer<typeof metricsQuerySchema>;
