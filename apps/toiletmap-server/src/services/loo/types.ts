import { z } from 'zod';
import {
  jsonValueSchema,
  openingTimesSchema,
  openingTimesFromDbSchema,
  dayOpeningHoursSchema,
  type OpeningTimes,
  type DayOpeningHours,
} from '../../common/schemas';

export const CoordinatesSchema = z
  .object({
    lat: z.number().finite(),
    lng: z.number().finite(),
  })
  .strict();
export type Coordinates = z.infer<typeof CoordinatesSchema>;

const AdminGeoSchema = z
  .object({
    name: z.string().nullable(),
    type: z.string().nullable(),
  })
  .strict();
export type AdminGeo = z.infer<typeof AdminGeoSchema>;

const nullableBoolean = z.boolean().nullable();
const nullableString = z.string().nullable();

// Shared base for every outward-facing loo representation.
const LooCommonSchema = z
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

const LooResponseSchema = z
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

const NearbyLooResponseSchema = LooResponseSchema.extend({
  distance: z.number().nonnegative(),
});
export type NearbyLooResponse = z.infer<typeof NearbyLooResponseSchema>;

export type CompressedLoo = [
  string, // id
  string, // geohash
  number, // filter mask
];

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

const LooSearchSortSchema = z.enum(LooSearchSortOptions);
export type LooSearchSort = z.infer<typeof LooSearchSortSchema>;

// LooSearchParams is now imported from routes/loos/schemas to ensure type consistency
// This is re-exported here for convenience and backwards compatibility
export type { SearchQuery as LooSearchParams } from '../../routes/loos/schemas';

const ReportDiffEntrySchema = z
  .object({
    previous: z.unknown(),
    current: z.unknown(),
  })
  .strict();
type ReportDiffEntry = z.infer<typeof ReportDiffEntrySchema>;

const ReportDiffSchema = z.record(z.string(), ReportDiffEntrySchema);
type ReportDiff = z.infer<typeof ReportDiffSchema>;

const ReportSummaryResponseSchema = z
  .object({
    id: z.string(),
    contributor: z.string().nullable(),
    createdAt: z.string(),
    diff: ReportDiffSchema.nullable(),
  })
  .strict();
export type ReportSummaryResponse = z.infer<typeof ReportSummaryResponseSchema>;

const ReportResponseSchema = z
  .object({
    id: z.string(),
    contributor: z.string().nullable(),
    createdAt: z.string(),
    verifiedAt: nullableString,
    diff: ReportDiffSchema.nullable(),
  })
  .merge(LooCommonSchema);
export type ReportResponse = z.infer<typeof ReportResponseSchema>;

// Re-export types for backwards compatibility
export type { OpeningTimes };

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

type ToiletsRecord = z.infer<typeof ToiletsRecordSchema>;

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
