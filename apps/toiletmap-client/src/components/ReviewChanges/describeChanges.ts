import { summariseOpeningTimes } from "@toiletmap/opening-hours";
import type { OpeningTimes } from "toiletmap-design-system";
import { distanceMeters, type LatLng } from "../LooForm/geometry";
import {
  type LooFormMode,
  type LooFormState,
  type LooPayload,
  type LooPayloadKey,
  TRI_STATE_FIELDS,
  type TriStateField,
  triToBool,
} from "../LooForm/payload";

/** One line of the review sheet: "Label: from → to", or "Label: to" when there's no `from`. */
export interface ReviewItem {
  field: LooPayloadKey;
  label: string;
  from?: string;
  to: string;
}

/** Plain-language names, in the order the form asks the questions. */
export const REVIEW_LABELS: Record<LooPayloadKey, string> = {
  name: "Name",
  location: "Location",
  women: "Women",
  men: "Men",
  allGender: "All gender",
  children: "Children",
  urinalOnly: "Urinal only",
  babyChange: "Baby changing",
  accessible: "Wheelchair accessible",
  radar: "Needs a RADAR key",
  noPayment: "Free to use",
  paymentDetails: "Payment details",
  openingTimes: "Opening hours",
  notes: "Notes",
  automatic: "Automatic toilet",
};

const FIELD_ORDER = Object.keys(REVIEW_LABELS) as LooPayloadKey[];

const TRI_FIELDS = new Set<string>(TRI_STATE_FIELDS);

const NOTHING = "Nothing";

/** Matches the form's own Yes / No / Don't know answers. */
export const describeBoolean = (value: boolean | null | undefined): string =>
  value === true ? "Yes" : value === false ? "No" : "Don't know";

const describeText = (value: string | null | undefined): string => {
  const trimmed = (value ?? "").trim();
  return trimmed.length ? trimmed : NOTHING;
};

const COMPASS = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
] as const;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Initial great-circle bearing from `a` to `b`, as one of eight compass directions. */
export function compassDirection(a: LatLng, b: LatLng): (typeof COMPASS)[number] {
  const phi1 = toRadians(a.lat);
  const phi2 = toRadians(b.lat);
  const dLng = toRadians(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  const degrees = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(degrees / 45) % 8];
}

export function formatDistance(meters: number): string {
  if (meters < 1) return "less than 1 m";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** "Moved 23 m north-east" (or "Placed on the map" when there was no location before). */
export function describeMove(from: LatLng | null, to: LatLng): string {
  if (!from) return "Placed on the map";
  const meters = distanceMeters(from, to);
  if (meters < 1) return "Moved less than 1 m";
  return `Moved ${formatDistance(meters)} ${compassDirection(from, to)}`;
}

export const describeOpeningTimes = (value: OpeningTimes | null | undefined): string =>
  summariseOpeningTimes(value ?? null);

const fromValue = (field: LooPayloadKey, initialForm: LooFormState): string => {
  if (TRI_FIELDS.has(field)) return describeBoolean(triToBool(initialForm[field as TriStateField]));
  switch (field) {
    case "openingTimes":
      return describeOpeningTimes(initialForm.openingTimes);
    case "name":
    case "notes":
    case "paymentDetails":
      return describeText(initialForm[field]);
    default:
      return "";
  }
};

const toValue = (field: LooPayloadKey, payload: LooPayload): string => {
  if (TRI_FIELDS.has(field)) return describeBoolean(payload[field as TriStateField]);
  switch (field) {
    case "openingTimes":
      return describeOpeningTimes(payload.openingTimes);
    case "name":
    case "notes":
    case "paymentDetails":
      return describeText(payload[field]);
    default:
      return "";
  }
};

/**
 * The review sheet's lines for a save, built from the request body so the sheet shows
 * exactly what will be sent.
 *
 * - edit: one "old → new" line per changed key.
 * - add: one line per answered question (unanswered "Don't know" ones are left out).
 */
export function describeChanges({
  mode,
  initialForm,
  payload,
}: {
  mode: LooFormMode;
  initialForm: LooFormState;
  payload: LooPayload;
}): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const field of FIELD_ORDER) {
    if (!(field in payload)) continue;
    const label = REVIEW_LABELS[field];

    if (field === "location") {
      if (!payload.location) continue;
      items.push({
        field,
        label,
        to:
          mode === "add"
            ? "Placed on the map"
            : describeMove(initialForm.location, payload.location),
      });
      continue;
    }

    if (mode === "add") {
      const value = payload[field];
      if (value === null || value === undefined) continue;
      items.push({ field, label, to: toValue(field, payload) });
      continue;
    }

    items.push({ field, label, from: fromValue(field, initialForm), to: toValue(field, payload) });
  }
  return items;
}
