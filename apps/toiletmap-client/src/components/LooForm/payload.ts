import type { OpeningTimes, TriStateValue } from "toiletmap-design-system";
import type { LooDetail } from "../../api/loos";
import { distanceMeters, type LatLng } from "./geometry";

export type LooFormMode = "edit" | "add";

/** Location changes smaller than this are treated as map/rounding jitter. */
export const LOCATION_CHANGE_THRESHOLD_METERS = 0.5;

export const TRI_STATE_FIELDS = [
  "accessible",
  "allGender",
  "men",
  "women",
  "children",
  "urinalOnly",
  "babyChange",
  "radar",
  "automatic",
  "noPayment",
] as const;

export type TriStateField = (typeof TRI_STATE_FIELDS)[number];

export type LooFormState = {
  name: string;
  /** Unrounded location as loaded / last set by the user. null = not placed. */
  location: LatLng | null;
  notes: string;
  paymentDetails: string;
  openingTimes: OpeningTimes | null;
} & Record<TriStateField, TriStateValue>;

export type LooFormField = keyof LooFormState;

/** Body sent to POST/PUT /api/loos. Never contains `active` or `removalReason`. */
export type LooPayload = {
  name?: string | null;
  location?: LatLng;
  notes?: string | null;
  paymentDetails?: string | null;
  openingTimes?: OpeningTimes | null;
  baseUpdatedAt?: string;
} & Partial<Record<TriStateField, boolean | null>>;

export type LooPayloadKey = Exclude<keyof LooPayload, "baseUpdatedAt">;

export const FIELD_LABELS: Record<LooFormField, string> = {
  name: "Name",
  location: "Location",
  notes: "Notes",
  paymentDetails: "Payment details",
  openingTimes: "Opening hours",
  accessible: "Accessible",
  allGender: "All gender",
  men: "Men",
  women: "Women",
  children: "Children",
  urinalOnly: "Urinal only",
  babyChange: "Baby change",
  radar: "RADAR key",
  automatic: "Automatic",
  noPayment: "Free",
};

export const boolToTri = (v: unknown): TriStateValue =>
  v === true ? "true" : v === false ? "false" : "";

export const triToBool = (v: TriStateValue): boolean | null =>
  v === "true" ? true : v === "false" ? false : null;

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

const toNullableString = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const cloneOpeningTimes = (value: unknown): OpeningTimes | null =>
  Array.isArray(value)
    ? (value.map((day) => (Array.isArray(day) ? [...day] : [])) as OpeningTimes)
    : null;

const isFiniteLocation = (loc: unknown): loc is LatLng =>
  !!loc &&
  typeof loc === "object" &&
  Number.isFinite((loc as LatLng).lat) &&
  Number.isFinite((loc as LatLng).lng);

/** Build form state from an API record. Values are kept unrounded. */
export function formStateFromLoo(
  loo: LooDetail | null | undefined,
  _mode?: LooFormMode,
): LooFormState {
  const tri = Object.fromEntries(
    TRI_STATE_FIELDS.map((key) => [key, boolToTri(loo?.[key])]),
  ) as Record<TriStateField, TriStateValue>;
  const loc = loo?.location;
  return {
    name: asString(loo?.name),
    location: isFiniteLocation(loc) ? { lat: loc.lat, lng: loc.lng } : null,
    notes: asString(loo?.notes),
    paymentDetails: asString(loo?.paymentDetails),
    openingTimes: cloneOpeningTimes(loo?.openingTimes),
    ...tri,
  };
}

export const openingTimesEqual = (a: OpeningTimes | null, b: OpeningTimes | null): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const locationMoved = (from: LatLng | null, to: LatLng | null): boolean => {
  if (!to) return false; // this form never clears a location
  if (!from) return true;
  return distanceMeters(from, to) > LOCATION_CHANGE_THRESHOLD_METERS;
};

/** Whether a single form field differs between two form states (with jitter/whitespace tolerance). */
export function fieldChanged(field: LooFormField, a: LooFormState, b: LooFormState): boolean {
  switch (field) {
    case "location":
      return locationMoved(a.location, b.location);
    case "openingTimes":
      return !openingTimesEqual(a.openingTimes, b.openingTimes);
    case "name":
    case "notes":
    case "paymentDetails":
      return a[field].trim() !== b[field].trim();
    default:
      return a[field] !== b[field];
  }
}

const FORM_FIELDS = Object.keys(FIELD_LABELS) as LooFormField[];

/** Form fields the user has changed relative to the initial form. */
export function changedFormFields(initialForm: LooFormState, form: LooFormState): LooFormField[] {
  return FORM_FIELDS.filter((field) => fieldChanged(field, initialForm, form));
}

export interface BuildLooPatchArgs {
  initial: LooDetail | null;
  initialForm: LooFormState;
  form: LooFormState;
  mode: LooFormMode;
}

export interface LooPatch {
  payload: LooPayload;
  changedKeys: LooPayloadKey[];
}

function buildCreatePayload(form: LooFormState): LooPayload {
  const payload: LooPayload = {};
  const name = toNullableString(form.name);
  if (name !== null) payload.name = name;
  if (form.location) payload.location = { lat: form.location.lat, lng: form.location.lng };
  const notes = toNullableString(form.notes);
  if (notes !== null) payload.notes = notes;
  for (const key of TRI_STATE_FIELDS) payload[key] = triToBool(form[key]);
  if (form.noPayment === "false") {
    const details = toNullableString(form.paymentDetails);
    if (details !== null) payload.paymentDetails = details;
  }
  if (form.openingTimes) payload.openingTimes = cloneOpeningTimes(form.openingTimes);
  return payload;
}

function buildEditPayload(initialForm: LooFormState, form: LooFormState): LooPayload {
  const payload: LooPayload = {};

  if (fieldChanged("name", initialForm, form)) payload.name = toNullableString(form.name);
  if (form.location && locationMoved(initialForm.location, form.location)) {
    payload.location = { lat: form.location.lat, lng: form.location.lng };
  }
  if (fieldChanged("notes", initialForm, form)) payload.notes = toNullableString(form.notes);

  for (const key of TRI_STATE_FIELDS) {
    if (form[key] !== initialForm[key]) payload[key] = triToBool(form[key]);
  }

  // Payment details only apply when the toilet is not free.
  const originalDetails = initialForm.paymentDetails.trim();
  if (form.noPayment === "false") {
    if (form.paymentDetails.trim() !== originalDetails) {
      payload.paymentDetails = toNullableString(form.paymentDetails);
    }
  } else if (originalDetails && form.noPayment !== initialForm.noPayment) {
    payload.paymentDetails = null;
  }

  if (!openingTimesEqual(initialForm.openingTimes, form.openingTimes)) {
    payload.openingTimes = cloneOpeningTimes(form.openingTimes);
  }

  return payload;
}

/**
 * Build the request body for a save.
 *
 * - add: full payload (undefined values omitted), no baseUpdatedAt.
 * - edit: only keys that changed vs `initialForm`; cleared text → null;
 *   includes `baseUpdatedAt` (the record's updatedAt) whenever anything changed.
 */
export function buildLooPatch({ initial, initialForm, form, mode }: BuildLooPatchArgs): LooPatch {
  const payload = mode === "add" ? buildCreatePayload(form) : buildEditPayload(initialForm, form);
  const changedKeys = Object.keys(payload) as LooPayloadKey[];
  if (
    mode === "edit" &&
    changedKeys.length > 0 &&
    typeof initial?.updatedAt === "string" &&
    initial.updatedAt.length > 0
  ) {
    payload.baseUpdatedAt = initial.updatedAt;
  }
  return { payload, changedKeys };
}

export interface RebaseResult {
  initial: LooDetail;
  initialForm: LooFormState;
  form: LooFormState;
  /** Form fields the user changed that are re-applied on top of `current`. */
  reapplied: LooFormField[];
}

/**
 * After a 409 conflict: adopt the server's current record as the new baseline and
 * re-apply only the fields the user changed.
 */
export function rebaseOnCurrent({
  current,
  initialForm,
  form,
  mode,
}: {
  current: LooDetail;
  initialForm: LooFormState;
  form: LooFormState;
  mode: LooFormMode;
}): RebaseResult {
  const reapplied = changedFormFields(initialForm, form);
  const nextInitialForm = formStateFromLoo(current, mode);
  const nextForm: LooFormState = { ...nextInitialForm };
  for (const field of reapplied) {
    (nextForm as Record<LooFormField, unknown>)[field] =
      field === "openingTimes" ? cloneOpeningTimes(form.openingTimes) : form[field];
  }
  return { initial: current, initialForm: nextInitialForm, form: nextForm, reapplied };
}

/**
 * Fields the user changed that someone else has also changed since the form loaded
 * (i.e. they differ between the originally loaded record and `current`).
 */
export function conflictingFields({
  initialForm,
  form,
  current,
}: {
  initialForm: LooFormState;
  form: LooFormState;
  current: LooDetail;
}): LooFormField[] {
  const currentForm = formStateFromLoo(current);
  return changedFormFields(initialForm, form).filter((field) =>
    fieldChanged(field, initialForm, currentForm),
  );
}
