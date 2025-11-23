import { z } from 'zod';
import { jsonValueSchema } from '../../common/schemas';

// Strict schema for opening times
// Each day is either ["HH:mm", "HH:mm"] (open) or [] (closed)
// Array has 7 elements: Monday (0) through Sunday (6)
// If all opening times are unknown, the field is null
const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;

export const dayOpeningHoursSchema = z.union([
  z.tuple([z.string().regex(timeRegex), z.string().regex(timeRegex)]),
  z.array(z.never()).length(0), // Empty array for closed days
]);

export const openingTimesSchema = z.array(dayOpeningHoursSchema).length(7).nullable();

// Database records occasionally contain legacy or incomplete opening_times data.
// This schema gracefully falls back to null instead of throwing so searches don't explode.
const openingTimesFromDbSchema = openingTimesSchema.catch(null);

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
    contributorsCount: z.number().int().nonnegative().default(0),
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

// LooSearchParams is now imported from routes/loos/schemas to ensure type consistency
// This is re-exported here for convenience and backwards compatibility
export type { SearchQuery as LooSearchParams } from '../../routes/loos/schemas';

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
    diff: ReportDiffSchema.nullable(),
  })
  .merge(LooCommonSchema);
export type ReportResponse = z.infer<typeof ReportResponseSchema>;

export type OpeningTimes = z.infer<typeof openingTimesSchema>;
export type DayOpeningHours = z.infer<typeof dayOpeningHoursSchema>;

export type LooMetricsResponse = {
  recentWindowDays: number;
  totals: {
    filtered: number;
    active: number;
    verified: number;
    accessible: number;
    babyChange: number;
    radar: number;
    freeAccess: number;
    recent: number;
  };
  areas: Array<{
    areaId: string | null;
    name: string;
    count: number;
  }>;
};

// Schema for validating toilets database records from JSON audit fields
// This matches the structure of the toilets table in Prisma
export const ToiletsRecordSchema = z.object({
  id: z.string(),
  created_at: z.coerce.date().nullable(),
  contributors: z.array(z.string()),
  accessible: nullableBoolean,
  active: nullableBoolean,
  attended: nullableBoolean,
  automatic: nullableBoolean,
  baby_change: nullableBoolean,
  men: nullableBoolean,
  name: nullableString,
  no_payment: nullableBoolean,
  notes: nullableString,
  payment_details: nullableString,
  radar: nullableBoolean,
  removal_reason: nullableString,
  women: nullableBoolean,
  updated_at: z.coerce.date().nullable(),
  geography: jsonValueSchema.nullable(),
  urinal_only: nullableBoolean,
  all_gender: nullableBoolean,
  children: nullableBoolean,
  geohash: nullableString,
  verified_at: z.coerce.date().nullable(),
  area_id: nullableString,
  opening_times: openingTimesFromDbSchema,
  location: jsonValueSchema.nullable(),
}).partial();

export type ToiletsRecord = z.infer<typeof ToiletsRecordSchema>;

// Schema for validating raw SQL query results (toilets with joined area fields)
export const RawLooRowSchema = z.object({
  id: z.string(),
  created_at: z.coerce.date().nullable(),
  contributors: z.array(z.string()).optional().default([]),
  accessible: nullableBoolean,
  active: nullableBoolean,
  attended: nullableBoolean,
  automatic: nullableBoolean,
  baby_change: nullableBoolean,
  men: nullableBoolean,
  name: nullableString,
  no_payment: nullableBoolean,
  notes: nullableString,
  payment_details: nullableString,
  radar: nullableBoolean,
  removal_reason: nullableString,
  women: nullableBoolean,
  updated_at: z.coerce.date().nullable(),
  urinal_only: nullableBoolean,
  all_gender: nullableBoolean,
  children: nullableBoolean,
  geohash: nullableString,
  verified_at: z.coerce.date().nullable(),
  area_id: nullableString,
  opening_times: openingTimesFromDbSchema,
  location: jsonValueSchema.nullable(),
  area_name: nullableString.optional(),
  area_type: nullableString.optional(),
});

export type RawLooRow = z.infer<typeof RawLooRowSchema>;

// Schema for validating nearby loo query results (includes distance)
export const RawNearbyLooRowSchema = RawLooRowSchema.extend({
  distance: z.number().nonnegative(),
});

export type RawNearbyLooRow = z.infer<typeof RawNearbyLooRowSchema>;

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
  openingTimes?: OpeningTimes;
  location?: Coordinates | null;
};
