import { z } from 'zod';
import type { Prisma, toilets } from '../../generated/prisma-client';

const jsonPrimitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const jsonValueSchema: z.ZodType<Prisma.JsonValue> = z.lazy(() =>
  z.union([
    jsonPrimitive,
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const openingTimesSchema: z.ZodType<toilets['opening_times']> = z.union([
  jsonValueSchema,
  z.null(),
]);

export const CoordinatesSchema = z
  .object({
    lat: z.number().finite(),
    lng: z.number().finite(),
  })
  .strict();
export type Coordinates = z.infer<typeof CoordinatesSchema>;

export const AdminGeoSchema = z
  .object({
    name: z.string().nullable(),
    type: z.string().nullable(),
  })
  .strict();
export type AdminGeo = z.infer<typeof AdminGeoSchema>;

const nullableBoolean = z.boolean().nullable();
const nullableString = z.string().nullable();

// Shared base for every outward-facing loo representation.
export const LooCommonSchema = z
  .object({
    geohash: nullableString,
    accessible: nullableBoolean,
    active: nullableBoolean,
    allGender: nullableBoolean,
    attended: nullableBoolean,
    automatic: nullableBoolean,
    babyChange: nullableBoolean,
    children: nullableBoolean,
    men: nullableBoolean,
    women: nullableBoolean,
    urinalOnly: nullableBoolean,
    notes: nullableString,
    noPayment: nullableBoolean,
    paymentDetails: nullableString,
    removalReason: nullableString,
    radar: nullableBoolean,
    openingTimes: openingTimesSchema,
    location: CoordinatesSchema.nullable(),
  })
  .strict();
export type LooCommon = z.infer<typeof LooCommonSchema>;

export const LooResponseSchema = z
  .object({
    id: z.string(),
    name: nullableString,
    area: z.array(AdminGeoSchema),
    createdAt: nullableString,
    updatedAt: nullableString,
    verifiedAt: nullableString,
    reports: z.array(z.unknown()),
  })
  .merge(LooCommonSchema);
export type LooResponse = z.infer<typeof LooResponseSchema>;

export const NearbyLooResponseSchema = LooResponseSchema.extend({
  distance: z.number().nonnegative(),
});
export type NearbyLooResponse = z.infer<typeof NearbyLooResponseSchema>;

export const LooSearchSortOptions = [
  'updated-desc',
  'updated-asc',
  'created-desc',
  'created-asc',
  'verified-desc',
  'verified-asc',
  'name-asc',
  'name-desc',
] as const;

export const LooSearchSortSchema = z.enum(LooSearchSortOptions);
export type LooSearchSort = z.infer<typeof LooSearchSortSchema>;

export type LooSearchParams = {
  search?: string;
  areaName?: string;
  areaType?: string;
  active?: boolean | null;
  accessible?: boolean | null;
  allGender?: boolean | null;
  radar?: boolean | null;
  babyChange?: boolean | null;
  noPayment?: boolean | null;
  verified?: boolean;
  hasLocation?: boolean;
  limit: number;
  page: number;
  sort: LooSearchSort;
};

export const ReportDiffEntrySchema = z
  .object({
    previous: z.unknown(),
    current: z.unknown(),
  })
  .strict();
export type ReportDiffEntry = z.infer<typeof ReportDiffEntrySchema>;

export const ReportDiffSchema = z.record(z.string(), ReportDiffEntrySchema);
export type ReportDiff = z.infer<typeof ReportDiffSchema>;

export const ReportSummaryResponseSchema = z
  .object({
    id: z.string(),
    contributor: z.string(),
    createdAt: z.string(),
    isSystemReport: z.boolean(),
    diff: ReportDiffSchema.nullable(),
  })
  .strict();
export type ReportSummaryResponse = z.infer<typeof ReportSummaryResponseSchema>;

export const ReportResponseSchema = z
  .object({
    id: z.string(),
    contributor: z.string(),
    createdAt: z.string(),
    verifiedAt: nullableString,
    isSystemReport: z.boolean(),
    diff: ReportDiffSchema.nullable(),
  })
  .merge(LooCommonSchema);
export type ReportResponse = z.infer<typeof ReportResponseSchema>;

export type LooMutationAttributes = {
  name?: string | null;
  areaId?: string | null;
  accessible?: boolean | null;
  active?: boolean | null;
  allGender?: boolean | null;
  attended?: boolean | null;
  automatic?: boolean | null;
  babyChange?: boolean | null;
  children?: boolean | null;
  men?: boolean | null;
  women?: boolean | null;
  urinalOnly?: boolean | null;
  radar?: boolean | null;
  notes?: string | null;
  noPayment?: boolean | null;
  paymentDetails?: string | null;
  removalReason?: string | null;
  openingTimes?: Prisma.InputJsonValue | null;
  location?: Coordinates | null;
};
