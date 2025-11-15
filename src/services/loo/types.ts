import type { Prisma, toilets } from '../../generated/prisma/client';

export type Coordinates = { lat: number; lng: number };

export type AdminGeo = { name: string | null; type: string | null };

export type LooResponse = {
  id: string;
  geohash: string | null;
  name: string | null;
  area: AdminGeo[];
  createdAt: string | null;
  updatedAt: string | null;
  verifiedAt: string | null;
  accessible: boolean | null;
  active: boolean | null;
  allGender: boolean | null;
  attended: boolean | null;
  automatic: boolean | null;
  babyChange: boolean | null;
  children: boolean | null;
  men: boolean | null;
  women: boolean | null;
  urinalOnly: boolean | null;
  notes: string | null;
  noPayment: boolean | null;
  paymentDetails: string | null;
  removalReason: string | null;
  radar: boolean | null;
  openingTimes: toilets['opening_times'];
  reports: unknown[];
  location: Coordinates | null;
};

export type NearbyLooResponse = LooResponse & { distance: number };

export type LooSearchSort =
  | 'updated-desc'
  | 'updated-asc'
  | 'created-desc'
  | 'created-asc'
  | 'verified-desc'
  | 'verified-asc'
  | 'name-asc'
  | 'name-desc';

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

export type ReportDiffEntry = {
  previous: unknown;
  current: unknown;
};

export type ReportDiff = Record<string, ReportDiffEntry>;

export type ReportSummaryResponse = {
  id: string;
  contributor: string;
  createdAt: string;
  isSystemReport: boolean;
  diff: ReportDiff | null;
};

export type ReportResponse = {
  id: string;
  contributor: string;
  createdAt: string;
  verifiedAt: string | null;
  isSystemReport: boolean;
  diff: ReportDiff | null;
  accessible: boolean | null;
  active: boolean | null;
  allGender: boolean | null;
  attended: boolean | null;
  automatic: boolean | null;
  babyChange: boolean | null;
  children: boolean | null;
  men: boolean | null;
  women: boolean | null;
  urinalOnly: boolean | null;
  notes: string | null;
  noPayment: boolean | null;
  paymentDetails: string | null;
  removalReason: string | null;
  openingTimes: toilets['opening_times'];
  geohash: string | null;
  radar: boolean | null;
  location: Coordinates | null;
};

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
