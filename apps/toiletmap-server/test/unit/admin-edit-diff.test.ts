import { describe, expect, it } from "vitest";
import { mergeDefaults } from "../../src/admin/pages/loos/shared/hooks/useLooForm";
import {
  buildEditBaseline,
  buildPayload,
  diffPayload,
  validateForm,
} from "../../src/admin/pages/loos/shared/utils/form";
import type { LooFormState } from "../../src/admin/pages/loos/shared/utils/types";

/** Edit-page defaults as the server renders them (tri-state strings). */
const serverDefaults = (overrides: Record<string, unknown> = {}) =>
  ({
    name: "Hidden Loo",
    notes: "",
    lat: "51.5",
    lng: "-0.12",
    accessible: "true",
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
    ...overrides,
  }) as unknown as Partial<LooFormState>;

/** Simulates loading the edit form, optionally editing it, and computing the PUT patch. */
const patchFor = (defaults: Partial<LooFormState>, edits: Partial<LooFormState> = {}) => {
  const initialForm = mergeDefaults(defaults);
  const form = { ...initialForm, ...edits };
  const validation = validateForm(form);
  if (!validation.success) throw new Error(JSON.stringify(validation.errors));
  return diffPayload(buildEditBaseline(initialForm, defaults), buildPayload(validation.data));
};

describe("admin edit diff baseline", () => {
  it("shows a stored NULL active as Yes", () => {
    expect(mergeDefaults(serverDefaults({ active: "" })).active).toBe("true");
  });

  it("re-activates a loo whose stored active is NULL when saved unchanged", () => {
    expect(patchFor(serverDefaults({ active: "" }))).toEqual({ active: true });
  });

  it("sends active: true alongside other edits when the stored value is NULL", () => {
    expect(patchFor(serverDefaults({ active: "" }), { notes: "Now open" })).toEqual({
      notes: "Now open",
      active: true,
    });
  });

  it("sends active: false when deactivating a loo whose stored active is NULL", () => {
    expect(patchFor(serverDefaults({ active: "" }), { active: "false" })).toEqual({
      active: false,
    });
  });

  it("does not send active when the stored value is already true", () => {
    expect(patchFor(serverDefaults({ active: "true" }))).toEqual({});
    expect(patchFor(serverDefaults({ active: "true" }), { notes: "x" })).toEqual({ notes: "x" });
  });

  it("does not send active when the stored value is already false", () => {
    expect(patchFor(serverDefaults({ active: "false" }))).toEqual({});
  });

  it("sends active when it is toggled from the stored value", () => {
    expect(patchFor(serverDefaults({ active: "false" }), { active: "true" })).toEqual({
      active: true,
    });
  });

  it("falls back to the form value when the defaults carry no active flag", () => {
    const { active: _active, ...withoutActive } = serverDefaults() as Record<string, unknown>;
    expect(patchFor(withoutActive as Partial<LooFormState>)).toEqual({});
  });
});
