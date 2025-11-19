import { z } from 'zod';

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

const triStateOptions = ['true', 'false', 'null', 'any'] as const;
export const triStateFilterSchema = z
  .preprocess(normalizeOptionalOption, z.enum(triStateOptions).optional())
  .transform((value) => {
    if (!value || value === 'any') return undefined;
    if (value === 'null') return null;
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
