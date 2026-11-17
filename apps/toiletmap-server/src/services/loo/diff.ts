import type { Coordinates, LooMutationAttributes, LooResponse, OpeningTimes } from "./types";

/**
 * Locations closer than this (in metres) are treated as the same point. This
 * absorbs float jitter from map widgets and coordinate rounding in clients.
 */
export const LOCATION_TOLERANCE_METRES = 0.5;

const EARTH_RADIUS_METRES = 6_371_008.8;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance between two coordinates, in metres. */
export const haversineDistanceMetres = (a: Coordinates, b: Coordinates): number => {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
};

const locationsEqual = (a: Coordinates | null, b: Coordinates | null): boolean => {
  if (a === null || b === null) return a === b;
  return haversineDistanceMetres(a, b) <= LOCATION_TOLERANCE_METRES;
};

const openingTimesEqual = (a: OpeningTimes, b: OpeningTimes): boolean => {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  return a.every((day, index) => {
    const other = b[index];
    if (!other || day.length !== other.length) return false;
    return day.every((value, i) => value === other[i]);
  });
};

/**
 * The record a mutation is compared against. `areaId` is optional because the
 * public `LooResponse` does not carry it; when it is unknown any supplied
 * `areaId` is treated as a change.
 */
export type LooDiffBase = LooResponse & { areaId?: string | null };

type ScalarKey = Exclude<keyof LooMutationAttributes, "openingTimes" | "location" | "areaId">;

const SCALAR_KEYS = [
  "name",
  "accessible",
  "active",
  "allGender",
  "attended",
  "automatic",
  "babyChange",
  "children",
  "men",
  "women",
  "urinalOnly",
  "radar",
  "notes",
  "noPayment",
  "paymentDetails",
  "removalReason",
  "removalCategory",
  "duplicateOf",
] as const satisfies readonly ScalarKey[];

/**
 * Returns only the fields of `mutation` that would actually change `existing`.
 *
 * Semantics:
 * - A key that is absent (or `undefined`) in the mutation means "leave as is"
 *   and never appears in the result.
 * - `null` means "clear"; it is kept only when the existing value is not
 *   already null.
 * - `openingTimes` is compared structurally; `location` is unchanged when
 *   within {@link LOCATION_TOLERANCE_METRES}.
 *
 * The function is pure and does not mutate its inputs.
 */
export const diffMutation = (
  mutation: LooMutationAttributes,
  existing: LooDiffBase,
): LooMutationAttributes => {
  const changes: LooMutationAttributes = {};
  const writable = changes as Record<ScalarKey, unknown>;

  for (const key of SCALAR_KEYS) {
    const next = mutation[key];
    if (next === undefined) continue;
    const current = existing[key] ?? null;
    if ((next ?? null) !== current) {
      writable[key] = next;
    }
  }

  if (mutation.areaId !== undefined) {
    const known = existing.areaId !== undefined;
    if (!known || (mutation.areaId ?? null) !== (existing.areaId ?? null)) {
      changes.areaId = mutation.areaId;
    }
  }

  if (mutation.openingTimes !== undefined) {
    if (!openingTimesEqual(mutation.openingTimes ?? null, existing.openingTimes ?? null)) {
      changes.openingTimes = mutation.openingTimes;
    }
  }

  if (mutation.location !== undefined) {
    if (!locationsEqual(mutation.location ?? null, existing.location ?? null)) {
      changes.location = mutation.location;
    }
  }

  return changes;
};

/** True when a mutation (typically the result of {@link diffMutation}) has no fields. */
export const isEmptyMutation = (mutation: LooMutationAttributes): boolean =>
  Object.values(mutation).every((value) => value === undefined);

/**
 * True when `baseUpdatedAt` (the version a client loaded) no longer matches the
 * record's current `updatedAt`. Records without an `updatedAt` never conflict.
 */
export const isStaleBase = (
  baseUpdatedAt: string | Date | null | undefined,
  currentUpdatedAt: string | null | undefined,
): boolean => {
  if (baseUpdatedAt === undefined || baseUpdatedAt === null) return false;
  if (!currentUpdatedAt) return false;
  const base = baseUpdatedAt instanceof Date ? baseUpdatedAt.getTime() : Date.parse(baseUpdatedAt);
  return base !== Date.parse(currentUpdatedAt);
};

/**
 * When a change puts a removed loo back on the map (`active: true`), also
 * clear its removal category, reason and duplicate link, as
 * `LooService.restore` does, so a reactivated loo never carries a stale
 * removal (which a later removal without a reason would otherwise surface
 * again). Fields the change sets itself are left as given. Returns `changes`
 * unchanged otherwise.
 */
export const clearRemovalOnReactivate = (
  changes: LooMutationAttributes,
  existing: Pick<LooDiffBase, "active" | "removalCategory" | "removalReason" | "duplicateOf">,
): LooMutationAttributes => {
  if (changes.active !== true || existing.active === true) return changes;
  return {
    ...changes,
    ...(existing.removalCategory !== null && changes.removalCategory === undefined
      ? { removalCategory: null }
      : {}),
    ...(existing.removalReason !== null && changes.removalReason === undefined
      ? { removalReason: null }
      : {}),
    ...(existing.duplicateOf !== null && changes.duplicateOf === undefined
      ? { duplicateOf: null }
      : {}),
  };
};
