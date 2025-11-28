import type { areas, record_version, toilets } from '../../generated/prisma/client';
import type {
  AdminGeo,
  Coordinates,
  LooCommon,
  LooResponse,
  NearbyLooResponse,
  ReportResponse,
  OpeningTimes,
  RawLooRow,
} from './types';
import { ToiletsRecordSchema } from './types';
import { openingTimesSchema } from '../../common/schemas';

/**
 * Converts a validated RawLooRow to a toilets object by extracting only toilets fields.
 */
export const rawLooToToilets = (raw: RawLooRow): toilets => ({
  id: raw.id,
  created_at: raw.created_at ?? null,
  contributors: raw.contributors ?? [],
  accessible: raw.accessible ?? null,
  active: raw.active ?? null,
  attended: raw.attended ?? null,
  automatic: raw.automatic ?? null,
  baby_change: raw.baby_change ?? null,
  men: raw.men ?? null,
  name: raw.name ?? null,
  no_payment: raw.no_payment ?? null,
  notes: raw.notes ?? null,
  payment_details: raw.payment_details ?? null,
  radar: raw.radar ?? null,
  removal_reason: raw.removal_reason ?? null,
  women: raw.women ?? null,
  updated_at: raw.updated_at ?? null,
  urinal_only: raw.urinal_only ?? null,
  all_gender: raw.all_gender ?? null,
  children: raw.children ?? null,
  geohash: raw.geohash ?? null,
  verified_at: raw.verified_at ?? null,
  area_id: raw.area_id ?? null,
  opening_times: raw.opening_times ?? null,
  location: raw.location ?? null,
});

export const areaSelection = {
  select: {
    name: true,
    type: true,
  },
} as const;

/**
 * Extracts coordinates from a GeoJSON-like object or raw database value.
 * Expects { coordinates: [lng, lat] }.
 */
const extractCoordinates = (value: unknown): Coordinates | null => {
  if (!value || typeof value !== 'object') return null;
  const coordinates = (value as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [lng, lat] = coordinates;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return { lat, lng };
};

const valuesEqual = (a: unknown, b: unknown) => {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
};

const toDateISOString = (value: Date | string | null | undefined) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
};

/**
 * Maps raw database fields to the common Loo interface.
 */
const mapSharedLooFields = (
  source: Partial<toilets> | null | undefined,
): LooCommon => ({
  geohash: source?.geohash ?? null,
  accessible: source?.accessible ?? null,
  active: source?.active ?? null,
  allGender: source?.all_gender ?? null,
  attended: source?.attended ?? null,
  automatic: source?.automatic ?? null,
  babyChange: source?.baby_change ?? null,
  children: source?.children ?? null,
  men: source?.men ?? null,
  women: source?.women ?? null,
  urinalOnly: source?.urinal_only ?? null,
  notes: source?.notes ?? null,
  noPayment: source?.no_payment ?? null,
  paymentDetails: source?.payment_details ?? null,
  removalReason: source?.removal_reason ?? null,
  openingTimes: openingTimesSchema.catch(null).parse(source?.opening_times ?? null),
  radar: source?.radar ?? null,
  location: extractCoordinates(source?.location),
});

/**
 * Maps a database area relation to the API AdminGeo format.
 */
const mapArea = (area?: Partial<areas> | null): AdminGeo[] =>
  !area ? [] : [{ name: area.name ?? null, type: area.type ?? null }];

/**
 * Helper to construct a partial area object from joined columns.
 */
export const buildAreaFromJoin = (
  name?: string | null,
  type?: string | null,
): Partial<areas> | null =>
  name == null && type == null
    ? null
    : { name: name ?? null, type: type ?? null };

/**
 * Maps a raw Prisma Loo result to the public API response format.
 */
export const mapLoo = (
  loo: toilets & { areas?: Partial<areas> | null },
): LooResponse => ({
  id: loo.id.toString(),
  name: loo.name ?? null,
  area: mapArea(loo.areas),
  createdAt: toDateISOString(loo.created_at),
  updatedAt: toDateISOString(loo.updated_at),
  verifiedAt: toDateISOString(loo.verified_at),
  reports: [],
  contributorsCount: Array.isArray(loo.contributors)
    ? loo.contributors.length
    : 0,
  ...mapSharedLooFields(loo),
});

/**
 * Maps a nearby loo result (including distance) to the public API response format.
 */
export const mapNearbyLoo = (
  loo: (toilets & { areas?: Partial<areas> | null }) & { distance: number },
): NearbyLooResponse => ({ ...mapLoo(loo), distance: loo.distance });

type AuditRecord = Pick<record_version, 'id' | 'record' | 'old_record'>;

const buildReportSnapshot = (
  source: Partial<toilets> | null | undefined,
) => ({
  name: source?.name ?? null,
  verifiedAt: toDateISOString(source?.verified_at),
  ...mapSharedLooFields(source),
});

/**
 * Calculates the difference between two snapshots of a loo.
 * Returns a record of field names to { previous, current } values.
 */
const calculateReportDiff = (
  currentSnapshot: Record<string, unknown>,
  previousSnapshot: Record<string, unknown> | null,
) => {
  const diff: Record<string, { previous: unknown; current: unknown }> = {};

  if (previousSnapshot) {
    const keys = new Set([
      ...Object.keys(previousSnapshot),
      ...Object.keys(currentSnapshot),
    ]);
    for (const key of keys) {
      const nextValue = currentSnapshot[key];
      const prevValue = previousSnapshot[key];
      if (!valuesEqual(nextValue, prevValue)) {
        diff[key] = {
          previous: prevValue ?? null,
          current: nextValue ?? null,
        };
      }
    }
  } else {
    // Genesis report - show all non-null current values
    for (const key of Object.keys(currentSnapshot)) {
      const currentValue = currentSnapshot[key];
      if (currentValue !== null) {
        diff[key] = {
          previous: null,
          current: currentValue,
        };
      }
    }
  }
  return diff;
};

/**
 * Maps a raw audit record (record_version) to a ReportResponse.
 * Calculates the diff between the old and new record states.
 */
export const mapAuditRecordToReport = ({
  id,
  record,
  old_record: oldRecord,
}: AuditRecord): ReportResponse => {
  const typed = ToiletsRecordSchema.parse(record ?? {});
  const previous = oldRecord ? ToiletsRecordSchema.parse(oldRecord) : null;
  const contributors = Array.isArray(typed.contributors)
    ? typed.contributors
    : [];
  const latestContributor =
    contributors.length > 0 ? contributors[contributors.length - 1] : null;

  // For the first report (genesis), use the loo's created_at timestamp.
  // For subsequent reports, use the loo's updated_at timestamp.
  const createdAt = previous === null
    ? toDateISOString(typed.created_at) ?? new Date().toISOString()
    : toDateISOString(typed.updated_at) ?? new Date().toISOString();

  const shared = mapSharedLooFields(typed);
  const currentSnapshot = buildReportSnapshot(typed);
  const previousSnapshot = previous ? buildReportSnapshot(previous) : null;

  const diff = calculateReportDiff(currentSnapshot, previousSnapshot);

  return {
    id: id.toString(),
    contributor: latestContributor ?? 'Anonymous',
    createdAt,
    verifiedAt: toDateISOString(typed.verified_at),
    diff: Object.keys(diff).length ? diff : null,
    ...shared,
  };
};
