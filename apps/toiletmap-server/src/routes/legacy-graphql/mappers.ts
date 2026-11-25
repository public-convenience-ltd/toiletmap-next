/**
 * Maps current service-layer results to the shapes the legacy GraphQL API
 * returned. Pure functions only (unit-tested in
 * test/unit/legacy-graphql-mappers.test.ts); the quirks reproduced here are
 * documented in test/fixtures/legacy-graphql/README.md.
 */
import { isLegacyLocationSnapshot } from "../../services/loo/legacy-location-report";
import { genLooFilterBitmask } from "../../services/loo/mappers";
import type { AdminGeo, LooResponse } from "../../services/loo/types";

export type LegacyPoint = { lat: number; lng: number };

export type LegacyLoo = {
  id: string;
  createdAt: string | null;
  updatedAt: string | null;
  verifiedAt: string | null;
  reports: [];
  active: boolean | null;
  location: LegacyPoint;
  area: Array<AdminGeo | null>;
  name: string | null;
  openingTimes: unknown;
  accessible: boolean | null;
  allGender: boolean | null;
  men: boolean | null;
  women: boolean | null;
  urinalOnly: boolean | null;
  children: boolean | null;
  babyChange: boolean | null;
  radar: boolean | null;
  attended: boolean | null;
  automatic: boolean | null;
  noPayment: boolean | null;
  paymentDetails: string | null;
  notes: string | null;
  removalReason: string | null;
  geohash: string | null;
};

/**
 * The current API accepts `24:00` as a closing time; the legacy scalar only
 * knows `00:00`-`23:59` and uses `00:00` for midnight (an equal open and close
 * means 24 hours). Rewriting keeps the meaning and keeps legacy clients from
 * getting a serialization error for the whole field.
 */
export const toLegacyOpeningTimes = (value: unknown): unknown => {
  if (!Array.isArray(value)) return value;
  return value.map((day) =>
    Array.isArray(day) ? day.map((time) => (time === "24:00" ? "00:00" : time)) : day,
  );
};

/**
 * `postgresLooToGraphQL` in the legacy code: a loo without a location is
 * `{lat: 0, lng: 0}`, a loo without an area has `area: [null]`, and
 * `reports` is always empty.
 */
export const toLegacyLoo = (loo: LooResponse): LegacyLoo => ({
  id: loo.id,
  createdAt: loo.createdAt,
  updatedAt: loo.updatedAt,
  verifiedAt: loo.verifiedAt,
  reports: [],
  active: loo.active,
  location: loo.location ? { lat: loo.location.lat, lng: loo.location.lng } : { lat: 0, lng: 0 },
  area: loo.area.length > 0 ? loo.area : [null],
  name: loo.name,
  openingTimes: toLegacyOpeningTimes(loo.openingTimes),
  accessible: loo.accessible,
  allGender: loo.allGender,
  men: loo.men,
  women: loo.women,
  urinalOnly: loo.urinalOnly,
  children: loo.children,
  babyChange: loo.babyChange,
  radar: loo.radar,
  attended: loo.attended,
  automatic: loo.automatic,
  noPayment: loo.noPayment,
  paymentDetails: loo.paymentDetails,
  notes: loo.notes,
  removalReason: loo.removalReason,
  geohash: loo.geohash,
});

// ---------------------------------------------------------------------------
// Compressed geohash strings (legacy src/lib/loo.ts)
// ---------------------------------------------------------------------------

/** Width of the filter mask; the detail mask is shifted left by this. */
const FILTER_BIT_LENGTH = 6;

const DETAIL_OFFSETS = { women: 0, men: 2, children: 4, urinalOnly: 6 } as const;

const encodeTriState = (value: boolean | null | undefined) =>
  value === true ? 1 : value === false ? 2 : 0;

/** Two bits per field: true = 1, false = 2, unknown = 0. */
export const encodeDetailMask = (
  loo: Pick<LooResponse, "women" | "men" | "children" | "urinalOnly">,
): number =>
  (encodeTriState(loo.women) << DETAIL_OFFSETS.women) |
  (encodeTriState(loo.men) << DETAIL_OFFSETS.men) |
  (encodeTriState(loo.children) << DETAIL_OFFSETS.children) |
  (encodeTriState(loo.urinalOnly) << DETAIL_OFFSETS.urinalOnly);

const GEOHASH_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/**
 * `ngeohash.encode(lat, lng, precision)`: longitude first, alternating, and a
 * bit is 1 only when the value is strictly above the midpoint.
 */
export const encodeGeohash = (lat: number, lng: number, precision: number): string => {
  let hash = "";
  let value = 0;
  let bits = 0;
  let evenBit = true;
  let [minLat, maxLat, minLng, maxLng] = [-90, 90, -180, 180];
  while (hash.length < precision) {
    if (evenBit) {
      const mid = (minLng + maxLng) / 2;
      value = value * 2 + (lng > mid ? 1 : 0);
      if (lng > mid) minLng = mid;
      else maxLng = mid;
    } else {
      const mid = (minLat + maxLat) / 2;
      value = value * 2 + (lat > mid ? 1 : 0);
      if (lat > mid) minLat = mid;
      else maxLat = mid;
    }
    evenBit = !evenBit;
    bits += 1;
    if (bits === 5) {
      hash += GEOHASH_BASE32[value];
      bits = 0;
      value = 0;
    }
  }
  return hash;
};

/**
 * The legacy strings carry a 9-character geohash that legacy encoded from
 * the GeoJSON `location` (rounded to 9 decimals), not from the stored
 * full-precision `geohash` column. The two differ for points within about
 * 1e-9 degrees of a cell edge (a few percent of real toilets), so the
 * location is encoded the same way here. The stored prefix is only a fallback
 * for a loo without a location.
 */
export const geohash9 = (loo: Pick<LooResponse, "geohash" | "location">): string =>
  loo.location
    ? encodeGeohash(loo.location.lat, loo.location.lng, 9)
    : (loo.geohash ?? "").slice(0, 9);

/** `"<HHMMHHMM|empty>.<...>"` for 7 days, or undefined when the hours are unknown. */
export const compressOpeningTimes = (openingTimes: unknown): string | undefined => {
  if (!Array.isArray(openingTimes)) return undefined;
  return openingTimes
    .map((day) => {
      if (!Array.isArray(day) || day.length === 0) return "";
      const [start, end] = day as [unknown, unknown];
      if (typeof start !== "string" || typeof end !== "string" || !start || !end) return "";
      return `${start.replace(":", "")}${end.replace(":", "")}`;
    })
    .join(".");
};

/** base64url without padding, of the UTF-8 bytes of `value`. */
export const toBase64Url = (value: string): string => {
  if (!value) return "";
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
};

/** `{n, p, t, o}` (each only when set), JSON-encoded then base64url; "" when empty. */
export const encodeMeta = (
  loo: Pick<LooResponse, "name" | "paymentDetails" | "notes"> & { openingTimes: unknown },
): string => {
  const meta: { n?: string; p?: string; t?: string; o?: string } = {};
  if (loo.name) meta.n = loo.name;
  if (loo.paymentDetails) meta.p = loo.paymentDetails;
  if (loo.notes) meta.t = loo.notes;
  const openingTimes = compressOpeningTimes(loo.openingTimes);
  if (openingTimes !== undefined) meta.o = openingTimes;
  return Object.keys(meta).length === 0 ? "" : toBase64Url(JSON.stringify(meta));
};

/** `loosByGeohash`: `id|geohash9|filterMask`. */
export const compressLegacyLoo = (loo: LooResponse): string =>
  `${loo.id}|${geohash9(loo)}|${genLooFilterBitmask(loo)}`;

/** `fullLoosByGeohash`: `id|geohash9|filterMask | detailMask << 6|meta`. */
export const compressLegacyFullLoo = (loo: LooResponse): string => {
  const combinedMask = genLooFilterBitmask(loo) | (encodeDetailMask(loo) << FILTER_BIT_LENGTH);
  const meta = encodeMeta({ ...loo, openingTimes: toLegacyOpeningTimes(loo.openingTimes) });
  return `${loo.id}|${geohash9(loo)}|${combinedMask}|${meta}`;
};

// ---------------------------------------------------------------------------
// Reports (legacy `reportsForLoo`)
// ---------------------------------------------------------------------------

/** One `audit.record_version` row: its id and the toilets row snapshot it recorded. */
export type AuditSnapshot = { id: string; record: unknown };

export type LegacyReport = {
  id: string;
  contributor: "Anonymous";
  createdAt: unknown;
  verifiedAt: unknown;
  isSystemReport: boolean;
  active: unknown;
  location: LegacyPoint | null;
  name: unknown;
  openingTimes: unknown;
  accessible: unknown;
  allGender: unknown;
  men: unknown;
  women: unknown;
  urinalOnly: unknown;
  children: unknown;
  babyChange: unknown;
  radar: unknown;
  attended: unknown;
  automatic: unknown;
  noPayment: unknown;
  geohash: unknown;
  paymentDetails: unknown;
  notes: unknown;
  removalReason: unknown;
  // `previous`, `loo` and `area` had no resolvers in the legacy API and are
  // always null, so nothing is looked up per report.
  previous: null;
  loo: null;
  area: null;
};

const field = (record: Record<string, unknown>, key: string): unknown => record[key] ?? null;

const toLegacyLocation = (value: unknown): LegacyPoint | null => {
  if (!value || typeof value !== "object") return null;
  const coordinates = (value as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [lng, lat] = coordinates;
  return typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;
};

/**
 * Maps one audit row the way the legacy resolver did. Values stay as the raw
 * JSON from the snapshot: timestamps are the Postgres strings (so their
 * trimmed fraction digits survive DateTime serialization), and the report
 * time is the snapshot's `updated_at`.
 */
export const toLegacyReport = ({ id, record }: AuditSnapshot): LegacyReport => {
  const snapshot =
    record && typeof record === "object" && !Array.isArray(record)
      ? (record as Record<string, unknown>)
      : {};

  return {
    id,
    contributor: "Anonymous",
    createdAt: field(snapshot, "updated_at") ?? field(snapshot, "created_at"),
    verifiedAt: field(snapshot, "verified_at"),
    isSystemReport: isLegacyLocationSnapshot(snapshot),
    active: field(snapshot, "active"),
    location: toLegacyLocation(snapshot.location),
    name: field(snapshot, "name"),
    openingTimes: toLegacyOpeningTimes(field(snapshot, "opening_times")),
    accessible: field(snapshot, "accessible"),
    allGender: field(snapshot, "all_gender"),
    men: field(snapshot, "men"),
    women: field(snapshot, "women"),
    urinalOnly: field(snapshot, "urinal_only"),
    children: field(snapshot, "children"),
    babyChange: field(snapshot, "baby_change"),
    radar: field(snapshot, "radar"),
    attended: field(snapshot, "attended"),
    automatic: field(snapshot, "automatic"),
    noPayment: field(snapshot, "no_payment"),
    geohash: field(snapshot, "geohash"),
    paymentDetails: field(snapshot, "payment_details"),
    notes: field(snapshot, "notes"),
    removalReason: field(snapshot, "removal_reason"),
    previous: null,
    loo: null,
    area: null,
  };
};

const reportTime = (report: LegacyReport) =>
  typeof report.createdAt === "string" ? Date.parse(report.createdAt) : Number.NaN;

/**
 * Oldest first; at equal times a user report sits before the system location
 * report recorded with it. `Array.prototype.sort` is stable, so other ties
 * keep the input order.
 */
export const toLegacyReports = (snapshots: AuditSnapshot[]): LegacyReport[] =>
  snapshots.map(toLegacyReport).sort((a, b) => {
    const timeA = reportTime(a);
    const timeB = reportTime(b);
    if (timeA !== timeB && !Number.isNaN(timeA) && !Number.isNaN(timeB)) return timeA - timeB;
    if (a.isSystemReport === b.isSystemReport) return 0;
    return a.isSystemReport ? 1 : -1;
  });
