import { z } from 'zod';
import { LOO_ID_LENGTH } from '../../services/loo';
import { CoordinatesSchema, LooSearchSortOptions } from '../../services/loo/types';

const nullableTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s.length ? s : null))
    .nullable()
    .optional();

const booleanField = z.boolean().nullable().optional();

const jsonValueSchema = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([jsonValueSchema, z.null()])),
    z.record(z.string(), z.union([jsonValueSchema, z.null()])),
  ]),
);

export const proximitySchema = z
  .object({
    lat: z.coerce
      .number()
      .min(-90, 'lat must be within -90 and 90')
      .max(90, 'lat must be within -90 and 90'),
    lng: z.coerce
      .number()
      .min(-180, 'lng must be within -180 and 180')
      .max(180, 'lng must be within -180 and 180'),
    radius: z.coerce
      .number()
      .int()
      .positive()
      .max(50000, 'radius must be <= 50000 meters')
      .default(1000),
  })
  .strict();

// Strict schema for opening times
// Each day is either ["HH:mm", "HH:mm"] (open) or [] (closed)
// Array has 7 elements: Monday (0) through Sunday (6)
// If all opening times are unknown, the field is null
const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;

const dayOpeningHoursSchema = z.union([
  z.tuple([z.string().regex(timeRegex, 'Time must be in HH:mm format'), z.string().regex(timeRegex, 'Time must be in HH:mm format')])
    .refine(([open, close]) => open < close, {
      message: 'Opening time must be before closing time',
    }),
  z.array(z.never()).length(0), // Empty array for closed days
]);

export const openingTimesSchema = z.array(dayOpeningHoursSchema).length(7).nullable();

const normalizeOptionalString = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

const normalizeOptionalOption = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : undefined;
};

const optionalTrimmedFilter = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === undefined || value.length === 0 ? undefined : value));

const triStateOptions = ['true', 'false', 'null', 'any'] as const;
const triStateFilterSchema = z
  .preprocess(normalizeOptionalOption, z.enum(triStateOptions).optional())
  .transform((value) => {
    if (!value || value === 'any') return undefined;
    if (value === 'null') return null;
    return value === 'true';
  });

const booleanOptions = ['true', 'false', 'any'] as const;
const booleanFilterSchema = z
  .preprocess(normalizeOptionalOption, z.enum(booleanOptions).optional())
  .transform((value) => {
    if (!value || value === 'any') return undefined;
    return value === 'true';
  });

const createNumberParam = (min: number, max: number | null, fallback: number) =>
  z.preprocess(
    (value) => {
      if (
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '')
      ) {
        return fallback;
      }
      return value;
    },
    z
      .coerce.number()
      .int()
      .min(min)
      .refine((val) => (max === null ? true : val <= max), {
        message: max === null ? `must be at least ${min}` : `must be between ${min} and ${max}`,
      }),
  );

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
    .preprocess(normalizeOptionalOption, z.enum(LooSearchSortOptions).default('updated-desc')),
  limit: createNumberParam(1, 200, 50),
  page: createNumberParam(1, null, 1),
});

export type MutationPayload = z.infer<typeof baseMutationSchema>;
export type CreateMutationPayload = z.infer<typeof createMutationSchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
