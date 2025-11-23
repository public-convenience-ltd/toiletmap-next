import { z } from "zod";
import { LOO_ID_LENGTH } from "../../services/loo";
import { RECENT_WINDOW_DAYS } from "../../common/constants";
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
      .max(50000, "radius must be <= 50000 meters")
      .default(1000),
  })
  .strict();

// Strict schema for opening times
// Each day is either ["HH:mm", "HH:mm"] (open) or [] (closed)
// Array has 7 elements: Monday (0) through Sunday (6)
// If all opening times are unknown, the field is null
const timeRegex = /^(([0-1][0-9]|2[0-3]):[0-5][0-9]|24:00)$/;

const dayOpeningHoursSchema = z.union([
  z
    .tuple([
      z.string().regex(timeRegex, "Time must be in HH:mm format"),
      z.string().regex(timeRegex, "Time must be in HH:mm format"),
    ])
    .refine(
      () => {
        // All combinations are allowed:
        // - Any repeated value (e.g., ["00:00", "00:00"], ["12:00", "12:00"]) represents 24 hours
        // - Overnight (e.g., ["22:00", "06:00"]) is valid
        // - Standard (e.g., ["09:00", "17:00"]) is valid
        return true;
      },
      {
        message: "Invalid opening times",
      }
    ),
  z.array(z.never()).length(0), // Empty array for closed days
]);

export const openingTimesSchema = z
  .array(dayOpeningHoursSchema)
  .length(7)
  .nullable();

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

export type MutationPayload = z.infer<typeof baseMutationSchema>;
export type CreateMutationPayload = z.infer<typeof createMutationSchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type MetricsQuery = z.infer<typeof metricsQuerySchema>;
