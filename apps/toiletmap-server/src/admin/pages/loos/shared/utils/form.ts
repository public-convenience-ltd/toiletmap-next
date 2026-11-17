import { type LooFormData, looSchema } from "../../../../utils/validation";
import {
  type BooleanValue,
  type FieldErrors,
  mapIssuesToErrors,
  sanitizeCoordinate,
  sanitizeText,
  toNullableString,
  triStateToBoolean,
} from "./form-helpers";
import type { LooFormState } from "./types";

const prepareForValidation = (form: LooFormState) => ({
  ...form,
  name: sanitizeText(form.name),
  notes: form.notes,
  lat: sanitizeCoordinate(form.lat),
  lng: sanitizeCoordinate(form.lng),
  paymentDetails: form.paymentDetails,
  removalReason: form.removalReason,
  openingTimes: form.openingTimes,
});

export const validateForm = (
  form: LooFormState,
): { success: true; data: LooFormData } | { success: false; errors: FieldErrors } => {
  const candidate = prepareForValidation(form);
  const parsed = looSchema.safeParse(candidate);
  if (parsed.success) {
    return { success: true, data: parsed.data as LooFormData };
  }
  return {
    success: false,
    errors: mapIssuesToErrors(parsed.error.issues),
  };
};

/**
 * Normalises any incoming `active` value to a strict yes/no.
 * Anything other than an explicit "false" means active (the default), so the
 * admin never sends `active: null` (which would silently hide a toilet).
 */
export const toBooleanValue = (value: unknown): BooleanValue =>
  value === "false" || value === false ? "false" : "true";

export const buildPayload = (data: LooFormData) => ({
  name: data.name,
  notes: toNullableString(data.notes ?? ""),
  accessible: triStateToBoolean(data.accessible ?? ""),
  radar: triStateToBoolean(data.radar ?? ""),
  attended: triStateToBoolean(data.attended ?? ""),
  automatic: triStateToBoolean(data.automatic ?? ""),
  noPayment: triStateToBoolean(data.noPayment ?? ""),
  paymentDetails: toNullableString(data.paymentDetails ?? ""),
  babyChange: triStateToBoolean(data.babyChange ?? ""),
  men: triStateToBoolean(data.men ?? ""),
  women: triStateToBoolean(data.women ?? ""),
  allGender: triStateToBoolean(data.allGender ?? ""),
  children: triStateToBoolean(data.children ?? ""),
  urinalOnly: triStateToBoolean(data.urinalOnly ?? ""),
  active: data.active !== "false",
  removalReason: toNullableString(data.removalReason ?? ""),
  location: {
    lat: data.lat,
    lng: data.lng,
  },
  openingTimes: data.openingTimes ?? null,
});

export type LooPayload = ReturnType<typeof buildPayload>;

/**
 * Builds the payload a form state *would* produce without validating it.
 * Used to capture the loaded record as a baseline for diffing in edit mode.
 */
export const formStateToPayload = (form: LooFormState): LooPayload => ({
  name: sanitizeText(form.name),
  notes: toNullableString(form.notes),
  accessible: triStateToBoolean(form.accessible),
  radar: triStateToBoolean(form.radar),
  attended: triStateToBoolean(form.attended),
  automatic: triStateToBoolean(form.automatic),
  noPayment: triStateToBoolean(form.noPayment),
  paymentDetails: toNullableString(form.paymentDetails),
  babyChange: triStateToBoolean(form.babyChange),
  men: triStateToBoolean(form.men),
  women: triStateToBoolean(form.women),
  allGender: triStateToBoolean(form.allGender),
  children: triStateToBoolean(form.children),
  urinalOnly: triStateToBoolean(form.urinalOnly),
  active: form.active !== "false",
  removalReason: toNullableString(form.removalReason),
  location: {
    lat: Number.parseFloat(form.lat),
    lng: Number.parseFloat(form.lng),
  },
  openingTimes: form.openingTimes ?? null,
});

/**
 * The payload an edit is diffed against. `active` may be `null` because it
 * reflects the *stored* value, which can be NULL on legacy records.
 */
export type LooBaseline = Omit<LooPayload, "active"> & { active: boolean | null };

/**
 * Reads the stored `active` flag from the edit page's defaults, where the
 * server encodes it as a tri-state ("true" / "false" / "" for NULL).
 * Returns `undefined` when the defaults do not carry it at all.
 */
const storedActive = (defaults?: Partial<LooFormState>): boolean | null | undefined => {
  if (!defaults || !Object.hasOwn(defaults, "active")) return undefined;
  const raw: unknown = defaults.active;
  if (raw === "true" || raw === true) return true;
  if (raw === "false" || raw === false) return false;
  return null;
};

/**
 * Builds the edit-mode diff baseline: the loaded form as a payload, except that
 * `active` is the value actually stored. The form shows a NULL `active` as
 * "Yes" (it is two-state), so diffing against the form alone would never send
 * `active` and a hidden (NULL) toilet could not be re-activated. Diffing
 * against the stored NULL makes saving send `active: true`.
 */
export const buildEditBaseline = (
  initialForm: LooFormState,
  defaults?: Partial<LooFormState>,
): LooBaseline => {
  const payload = formStateToPayload(initialForm);
  const stored = storedActive(defaults);
  return stored === undefined ? payload : { ...payload, active: stored };
};

/** ~0.5 m expressed in degrees of latitude. */
const LOCATION_TOLERANCE_DEGREES = 0.5 / 111_320;

const sameLocation = (a: LooPayload["location"], b: LooPayload["location"]): boolean => {
  const aValid = Number.isFinite(a.lat) && Number.isFinite(a.lng);
  const bValid = Number.isFinite(b.lat) && Number.isFinite(b.lng);
  if (!aValid || !bValid) return aValid === bValid;
  const dLat = Math.abs(a.lat - b.lat);
  const dLng = Math.abs(a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng) <= LOCATION_TOLERANCE_DEGREES;
};

/**
 * Returns only the fields of `current` that differ from `initial`.
 * Cleared values are kept as `null` so the API clears them; omitted fields
 * are left unchanged by the API.
 */
export const diffPayload = (initial: LooBaseline, current: LooPayload): Partial<LooPayload> => {
  const patch: Partial<LooPayload> = {};
  for (const key of Object.keys(current) as Array<keyof LooPayload>) {
    if (key === "location") {
      if (!sameLocation(initial.location, current.location)) {
        patch.location = current.location;
      }
      continue;
    }
    if (JSON.stringify(initial[key]) !== JSON.stringify(current[key])) {
      (patch as Record<string, unknown>)[key] = current[key];
    }
  }
  return patch;
};

export const DEFAULT_FORM_STATE: LooFormState = {
  name: "",
  notes: "",
  lat: "",
  lng: "",
  accessible: "",
  radar: "",
  attended: "",
  automatic: "",
  noPayment: "",
  paymentDetails: "",
  babyChange: "",
  men: "",
  women: "",
  allGender: "",
  children: "",
  urinalOnly: "",
  active: "true",
  removalReason: "",
  openingTimes: null,
};
