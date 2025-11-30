import { type LooFormData, looSchema } from "../../../../utils/validation";
import {
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
  active: triStateToBoolean(data.active ?? ""),
  removalReason: toNullableString(data.removalReason ?? ""),
  location: {
    lat: data.lat,
    lng: data.lng,
  },
  openingTimes: data.openingTimes,
});

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
