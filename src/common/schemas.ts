import { z } from 'zod';

/**
 * Unified opening times schema
 * Each day is either ["HH:mm", "HH:mm"] (open) or [] (closed)
 * Array has 7 elements: Monday (0) through Sunday (6)
 * If all opening times are unknown, the field is null
 * Accepts times from 00:00 to 24:00 (24:00 represents midnight)
 */
const timeRegex = /^(([0-1][0-9]|2[0-3]):[0-5][0-9]|24:00)$/;

export const dayOpeningHoursSchema = z.union([
  z
    .tuple([
      z.string().regex(timeRegex, 'Time must be in HH:mm format (00:00-24:00)'),
      z.string().regex(timeRegex, 'Time must be in HH:mm format (00:00-24:00)'),
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
        message: 'Invalid opening times',
      }
    ),
  z.array(z.never()).length(0), // Empty array for closed days
]);

export const openingTimesSchema = z
  .array(dayOpeningHoursSchema)
  .length(7)
  .nullable();

// Database records occasionally contain legacy or incomplete opening_times data.
// This schema gracefully falls back to null instead of throwing so searches don't explode.
export const openingTimesFromDbSchema = openingTimesSchema.catch(null);

export type OpeningTimes = z.infer<typeof openingTimesSchema>;
export type DayOpeningHours = z.infer<typeof dayOpeningHoursSchema>;

export const nullableTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s.length ? s : null))
    .nullable()
    .optional();

export const booleanField = z.boolean().nullable().optional();

export const jsonValueSchema: z.ZodType<any> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([jsonValueSchema, z.null()])),
    z.record(z.string(), z.union([jsonValueSchema, z.null()])),
  ]),
);

export const normalizeOptionalString = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

export const normalizeOptionalOption = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : undefined;
};

export const optionalTrimmedFilter = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) =>
      value === undefined || value.length === 0 ? undefined : value,
    );

const triStateOptions = ['true', 'false', 'unknown'] as const;
export const triStateFilterSchema = z
  .preprocess(normalizeOptionalOption, z.enum(triStateOptions).optional())
  .transform((value) => {
    if (!value) return undefined;
    if (value === 'unknown') return null;
    return value === 'true';
  });

const booleanOptions = ['true', 'false', 'any'] as const;
export const booleanFilterSchema = z
  .preprocess(normalizeOptionalOption, z.enum(booleanOptions).optional())
  .transform((value) => {
    if (!value || value === 'any') return undefined;
    return value === 'true';
  });

export const createNumberParam = (
  min: number,
  max: number | null,
  fallback: number,
) =>
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
    z.coerce
      .number()
      .int()
      .min(min)
      .refine((val) => (max === null ? true : val <= max), {
        message:
          max === null
            ? `must be at least ${min}`
            : `must be between ${min} and ${max}`,
      }),
  );
