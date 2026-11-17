/** @jsxImportSource hono/jsx/dom */

import { useState } from "hono/jsx";
import { DEFAULT_FORM_STATE, toBooleanValue } from "../utils/form";
import type { LooFormState, TriStateValue } from "../utils/types";

export const mergeDefaults = (defaults?: Partial<LooFormState>): LooFormState => {
  const merged = {
    ...DEFAULT_FORM_STATE,
    ...(defaults || {}),
  };
  return {
    ...merged,
    // `active` is two-state only; a missing/unknown value defaults to active.
    active: toBooleanValue(merged.active),
    openingTimes: merged.openingTimes ?? null,
  };
};

export const useLooForm = (defaults?: Partial<LooFormState>) => {
  // The form as first loaded; edit mode diffs against this.
  const [initialForm] = useState<LooFormState>(() => mergeDefaults(defaults));
  const [form, setForm] = useState<LooFormState>(initialForm);

  const updateField = (field: keyof LooFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateTriState = (field: keyof LooFormState, value: TriStateValue) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const resetForm = (next?: Partial<LooFormState>) => {
    setForm(mergeDefaults({ ...defaults, ...next }));
  };

  const updateOpeningHours = (value: LooFormState["openingTimes"]) => {
    setForm((prev) => ({ ...prev, openingTimes: value }));
  };

  const updateLocation = (lat: number, lng: number) => {
    setForm((prev) => ({
      ...prev,
      lat: lat.toString(),
      lng: lng.toString(),
    }));
  };

  return {
    initialForm,
    form,
    updateField,
    updateTriState,
    updateOpeningHours,
    updateLocation,
    resetForm,
  };
};
