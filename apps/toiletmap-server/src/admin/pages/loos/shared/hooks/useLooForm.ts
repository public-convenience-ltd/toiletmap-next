/** @jsxImportSource hono/jsx/dom */

import { useState } from "hono/jsx";
import { DEFAULT_FORM_STATE } from "../utils/form";
import type { LooFormState, TriStateValue } from "../utils/types";

const mergeDefaults = (defaults?: Partial<LooFormState>) => ({
  ...DEFAULT_FORM_STATE,
  ...(defaults || {}),
});

export const useLooForm = (defaults?: Partial<LooFormState>) => {
  const [form, setForm] = useState<LooFormState>(() => mergeDefaults(defaults));

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
    form,
    updateField,
    updateTriState,
    updateOpeningHours,
    updateLocation,
    resetForm,
  };
};
