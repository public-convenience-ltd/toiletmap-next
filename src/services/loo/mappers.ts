import type { areas, record_version, toilets } from '../../generated/prisma-client';
import type {
  AdminGeo,
  Coordinates,
  LooCommon,
  LooResponse,
  NearbyLooResponse,
  ReportResponse,
} from './types';

export const areaSelection = {
  select: {
    name: true,
    type: true,
  },
} as const;

const extractCoordinates = (value: unknown): Coordinates | null => {
  if (!value || typeof value !== 'object') return null;
  const coordinates = (value as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [lng, lat] = coordinates;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return { lat, lng };
};

const coordinatesEqual = (a: Coordinates | null, b: Coordinates | null) =>
  (a === null && b === null) ||
  (a !== null && b !== null && a.lat === b.lat && a.lng === b.lng);

const valuesEqual = (a: unknown, b: unknown) => {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
};

const IGNORED_AUDIT_DIFF_KEYS = new Set([
  'contributors',
  'geography',
  'geohash',
  'location',
  'updated_at',
]);

const toDateISOString = (value: Date | string | null | undefined) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
};

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
  openingTimes: source?.opening_times ?? null,
  radar: source?.radar ?? null,
  location: extractCoordinates(source?.location),
});

export const mapArea = (area?: Partial<areas> | null): AdminGeo[] =>
  !area ? [] : [{ name: area.name ?? null, type: area.type ?? null }];

export const buildAreaFromJoin = (
  name?: string | null,
  type?: string | null,
): Partial<areas> | null =>
  name == null && type == null
    ? null
    : { name: name ?? null, type: type ?? null };

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
  ...mapSharedLooFields(loo),
});

export const mapNearbyLoo = (
  loo: (toilets & { areas?: Partial<areas> | null }) & { distance: number },
): NearbyLooResponse => ({ ...mapLoo(loo), distance: loo.distance });

type AuditRecord = Pick<record_version, 'id' | 'ts' | 'record' | 'old_record'>;

const buildReportSnapshot = (source: Partial<toilets> | null | undefined) => ({
  verifiedAt: toDateISOString(source?.verified_at),
  ...mapSharedLooFields(source),
});

export const mapAuditRecordToReport = ({
  id,
  ts,
  record,
  old_record: oldRecord,
}: AuditRecord): ReportResponse => {
  const typed = (record ?? {}) as Partial<toilets>;
  const previous = (oldRecord ?? null) as Partial<toilets> | null;
  const contributors = Array.isArray(typed.contributors)
    ? typed.contributors
    : [];
  const latestContributor =
    contributors.length > 0 ? contributors[contributors.length - 1] : null;
  const createdAt = toDateISOString(ts) ?? new Date().toISOString();
  const shared = mapSharedLooFields(typed);
  const currentSnapshot = buildReportSnapshot(typed);
  const previousSnapshot = previous ? buildReportSnapshot(previous) : null;

  const newLocation = extractCoordinates(typed.location);
  const oldLocation = extractCoordinates(previous?.location);
  const locationChanged =
    previous !== null && !coordinatesEqual(newLocation, oldLocation);

  let hasNonLocationChanges = false;
  if (previous !== null) {
    const keys = new Set([...Object.keys(previous), ...Object.keys(typed)]);
    for (const key of keys) {
      if (IGNORED_AUDIT_DIFF_KEYS.has(key)) continue;
      const nextValue = (typed as Record<string, unknown>)[key];
      const prevValue = (previous as Record<string, unknown>)[key];
      if (!valuesEqual(nextValue, prevValue)) {
        hasNonLocationChanges = true;
        break;
      }
    }
  }

  const isSystemReport = locationChanged && !hasNonLocationChanges;

  const diff: Record<string, { previous: unknown; current: unknown }> = {};
  if (previousSnapshot) {
    const keys = new Set([
      ...Object.keys(previousSnapshot),
      ...Object.keys(currentSnapshot),
    ]);
    for (const key of keys) {
      const nextValue = (currentSnapshot as Record<string, unknown>)[key];
      const prevValue = (previousSnapshot as Record<string, unknown>)[key];
      if (!valuesEqual(nextValue, prevValue)) {
        diff[key] = {
          previous: prevValue ?? null,
          current: nextValue ?? null,
        };
      }
    }
  }

  return {
    id: id.toString(),
    contributor: latestContributor ?? 'Anonymous',
    createdAt,
    verifiedAt: toDateISOString(typed.verified_at),
    isSystemReport,
    diff: Object.keys(diff).length ? diff : null,
    ...shared,
  };
};
