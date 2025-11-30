import type {
  Coordinates,
  LooMutationAttributes,
  OpeningTimes,
} from "../../../src/services/loo/types";

type LegacyLocation = {
  type?: string | null;
  coordinates?: [number, number];
} | null;

export type LegacyToiletRecord = {
  id: string;
  name: string | null;
  area_id: string | null;
  accessible: boolean | null;
  active: boolean | null;
  attended: boolean | null;
  automatic: boolean | null;
  baby_change: boolean | null;
  men: boolean | null;
  women: boolean | null;
  urinal_only: boolean | null;
  all_gender: boolean | null;
  children: boolean | null;
  no_payment: boolean | null;
  notes: string | null;
  payment_details: string | null;
  radar: boolean | null;
  removal_reason?: string | null;
  opening_times: OpeningTimes | null;
  location: LegacyLocation;
  areas?: {
    id?: string | null;
    name?: string | null;
    type?: string | null;
  } | null;
};

const toNullableBoolean = (value: unknown): boolean | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (["true", "t", "1", "yes", "y"].includes(lower)) return true;
    if (["false", "f", "0", "no", "n"].includes(lower)) return false;
  }
  return null;
};

const toOpeningTimes = (value: unknown): OpeningTimes => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value as OpeningTimes;
  }
  return null;
};

const toCoordinates = (value: LegacyLocation): Coordinates | null => {
  if (!value) return value === null ? null : null;
  const coords = value.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const [lng, lat] = coords;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return { lat, lng };
};

const normaliseId = (value: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

export const legacyRecordToMutation = (record: LegacyToiletRecord): LooMutationAttributes => {
  const mutation: LooMutationAttributes = {
    name: record.name,
    areaId: normaliseId(record.area_id),
    accessible: toNullableBoolean(record.accessible),
    active: toNullableBoolean(record.active),
    allGender: toNullableBoolean(record.all_gender),
    attended: toNullableBoolean(record.attended),
    automatic: toNullableBoolean(record.automatic),
    babyChange: toNullableBoolean(record.baby_change),
    children: toNullableBoolean(record.children),
    men: toNullableBoolean(record.men),
    women: toNullableBoolean(record.women),
    urinalOnly: toNullableBoolean(record.urinal_only),
    radar: toNullableBoolean(record.radar),
    notes: record.notes,
    noPayment: toNullableBoolean(record.no_payment),
    paymentDetails: record.payment_details,
    removalReason: record.removal_reason ?? null,
    openingTimes: toOpeningTimes(record.opening_times),
  };

  const coords = toCoordinates(record.location);
  if (coords) {
    mutation.location = coords;
  } else if (record.location === null) {
    mutation.location = null;
  }

  return mutation;
};
