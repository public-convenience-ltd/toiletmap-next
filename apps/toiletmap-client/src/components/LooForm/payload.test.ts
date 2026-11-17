import { describe, expect, it } from "vitest";
import type { LooDetail } from "../../api/loos";
import {
  buildLooPatch,
  changedFormFields,
  conflictingFields,
  formStateFromLoo,
  type LooFormState,
  rebaseOnCurrent,
} from "./payload";

const UPDATED_AT = "2025-11-01T10:00:00.000Z";

const makeLoo = (overrides: Partial<LooDetail> = {}): LooDetail => ({
  id: "abcdefghijklmnopqrstuvwx",
  name: "High Street toilets",
  location: { lat: 51.5073509123, lng: -0.1277583456 },
  accessible: true,
  allGender: null,
  men: true,
  women: true,
  children: null,
  babyChange: false,
  radar: null,
  automatic: null,
  noPayment: false,
  paymentDetails: "50p",
  openingTimes: null,
  updatedAt: UPDATED_AT,
  notes: "Behind the library",
  active: true,
  removalReason: null,
  ...overrides,
});

const editPatch = (loo: LooDetail, mutate: (f: LooFormState) => LooFormState) => {
  const initialForm = formStateFromLoo(loo, "edit");
  const form = mutate(formStateFromLoo(loo, "edit"));
  return buildLooPatch({ initial: loo, initialForm, form, mode: "edit" });
};

/** Offset a location north by roughly `meters`. */
const northBy = (loc: { lat: number; lng: number }, meters: number) => ({
  lat: loc.lat + meters / 111_195,
  lng: loc.lng,
});

describe("formStateFromLoo", () => {
  it("keeps the location unrounded and maps booleans to tri-state", () => {
    const loo = makeLoo();
    const form = formStateFromLoo(loo, "edit");
    expect(form.location).toEqual({ lat: 51.5073509123, lng: -0.1277583456 });
    expect(form.accessible).toBe("true");
    expect(form.babyChange).toBe("false");
    expect(form.radar).toBe("");
    expect(form.notes).toBe("Behind the library");
  });

  it("does not invent a location when the loo has none", () => {
    expect(formStateFromLoo(makeLoo({ location: null }), "edit").location).toBeNull();
    expect(formStateFromLoo(null, "add").location).toBeNull();
  });

  it("does not carry active or removalReason", () => {
    const form = formStateFromLoo(makeLoo(), "edit") as Record<string, unknown>;
    expect(form).not.toHaveProperty("active");
    expect(form).not.toHaveProperty("removalReason");
  });
});

describe("buildLooPatch (edit)", () => {
  it("untouched edit produces an empty payload and no baseUpdatedAt", () => {
    const { payload, changedKeys } = editPatch(makeLoo(), (f) => f);
    expect(payload).toEqual({});
    expect(changedKeys).toEqual([]);
  });

  it("one toggle produces one key plus baseUpdatedAt", () => {
    const { payload, changedKeys } = editPatch(makeLoo(), (f) => ({ ...f, radar: "true" }));
    expect(payload).toEqual({ radar: true, baseUpdatedAt: UPDATED_AT });
    expect(changedKeys).toEqual(["radar"]);
  });

  it("setting a tri-state back to unknown sends null", () => {
    const { payload } = editPatch(makeLoo(), (f) => ({ ...f, accessible: "" }));
    expect(payload).toEqual({ accessible: null, baseUpdatedAt: UPDATED_AT });
  });

  it("omits baseUpdatedAt when the record has no updatedAt", () => {
    const { payload } = editPatch(makeLoo({ updatedAt: null }), (f) => ({ ...f, radar: "true" }));
    expect(payload).toEqual({ radar: true });
  });

  it("cleared notes are sent as null", () => {
    const { payload, changedKeys } = editPatch(makeLoo(), (f) => ({ ...f, notes: "   " }));
    expect(payload).toEqual({ notes: null, baseUpdatedAt: UPDATED_AT });
    expect(changedKeys).toEqual(["notes"]);
  });

  it("never-set notes left empty are omitted", () => {
    const { payload } = editPatch(makeLoo({ notes: null }), (f) => ({ ...f, notes: "" }));
    expect(payload).toEqual({});
  });

  it("trims text and ignores whitespace-only edits", () => {
    expect(
      editPatch(makeLoo(), (f) => ({ ...f, name: "  High Street toilets  " })).payload,
    ).toEqual({});
    expect(editPatch(makeLoo(), (f) => ({ ...f, name: "  Market toilets " })).payload).toEqual({
      name: "Market toilets",
      baseUpdatedAt: UPDATED_AT,
    });
  });

  it("switching to free clears existing payment details", () => {
    const { payload, changedKeys } = editPatch(makeLoo(), (f) => ({ ...f, noPayment: "true" }));
    expect(payload).toEqual({ noPayment: true, paymentDetails: null, baseUpdatedAt: UPDATED_AT });
    expect(changedKeys.sort()).toEqual(["noPayment", "paymentDetails"]);
  });

  it("switching to unknown payment clears existing payment details", () => {
    const { payload } = editPatch(makeLoo(), (f) => ({ ...f, noPayment: "" }));
    expect(payload).toEqual({ noPayment: null, paymentDetails: null, baseUpdatedAt: UPDATED_AT });
  });

  it("switching to free with no payment details does not send paymentDetails", () => {
    const { payload } = editPatch(makeLoo({ paymentDetails: null }), (f) => ({
      ...f,
      noPayment: "true",
    }));
    expect(payload).toEqual({ noPayment: true, baseUpdatedAt: UPDATED_AT });
  });

  it("does not clear inconsistent payment details on an untouched form", () => {
    const { payload } = editPatch(makeLoo({ noPayment: true, paymentDetails: "50p" }), (f) => f);
    expect(payload).toEqual({});
  });

  it("edited payment details are sent when not free", () => {
    const { payload } = editPatch(makeLoo(), (f) => ({ ...f, paymentDetails: "£1, card only" }));
    expect(payload).toEqual({ paymentDetails: "£1, card only", baseUpdatedAt: UPDATED_AT });
  });

  it("location jitter of 0.1 m is omitted", () => {
    const loo = makeLoo();
    const { payload } = editPatch(loo, (f) => ({
      ...f,
      location: northBy(loo.location as { lat: number; lng: number }, 0.1),
    }));
    expect(payload).toEqual({});
  });

  it("rounding the location to 6 decimals is omitted", () => {
    const { payload } = editPatch(makeLoo(), (f) => ({
      ...f,
      location: { lat: 51.507351, lng: -0.127758 },
    }));
    expect(payload).toEqual({});
  });

  it("a 5 m move is included", () => {
    const loo = makeLoo();
    const moved = northBy(loo.location as { lat: number; lng: number }, 5);
    const { payload } = editPatch(loo, (f) => ({ ...f, location: moved }));
    expect(payload).toEqual({ location: moved, baseUpdatedAt: UPDATED_AT });
  });

  it("a loo without a location only sends one when the user places it", () => {
    const loo = makeLoo({ location: null });
    expect(editPatch(loo, (f) => f).payload).toEqual({});
    const placed = { lat: 52.1, lng: -1.2 };
    expect(editPatch(loo, (f) => ({ ...f, location: placed })).payload).toEqual({
      location: placed,
      baseUpdatedAt: UPDATED_AT,
    });
  });

  it("null opening times left untouched stay omitted", () => {
    const { payload } = editPatch(makeLoo({ openingTimes: null }), (f) => f);
    expect(payload).not.toHaveProperty("openingTimes");
  });

  it("24h opening times round-trip without a change", () => {
    const allDay = Array.from({ length: 7 }, () => ["00:00", "00:00"] as [string, string]);
    const loo = makeLoo({ openingTimes: allDay });
    expect(formStateFromLoo(loo, "edit").openingTimes).toEqual(allDay);
    expect(editPatch(loo, (f) => f).payload).toEqual({});
    // A deep-equal copy is not a change either.
    expect(
      editPatch(loo, (f) => ({ ...f, openingTimes: allDay.map((d) => [...d] as [string, string]) }))
        .payload,
    ).toEqual({});
  });

  it("changed opening times are sent in full, and 'unknown' clears them", () => {
    const week = Array.from({ length: 7 }, () => ["09:00", "17:00"] as [string, string]);
    const loo = makeLoo({ openingTimes: week });
    const sundayClosed = week.map((d, i) => (i === 6 ? [] : [...d])) as LooDetail["openingTimes"];
    expect(editPatch(loo, (f) => ({ ...f, openingTimes: sundayClosed })).payload).toEqual({
      openingTimes: sundayClosed,
      baseUpdatedAt: UPDATED_AT,
    });
    expect(editPatch(loo, (f) => ({ ...f, openingTimes: null })).payload).toEqual({
      openingTimes: null,
      baseUpdatedAt: UPDATED_AT,
    });
  });

  it("never sends active or removalReason", () => {
    const { payload } = editPatch(makeLoo({ active: false, removalReason: "Demolished" }), (f) => ({
      ...f,
      name: "Renamed",
      accessible: "false",
    }));
    expect(payload).not.toHaveProperty("active");
    expect(payload).not.toHaveProperty("removalReason");
  });
});

describe("urinalOnly", () => {
  it("is loaded into the form as a tri-state", () => {
    expect(formStateFromLoo(makeLoo({ urinalOnly: true }), "edit").urinalOnly).toBe("true");
    expect(formStateFromLoo(makeLoo({ urinalOnly: false }), "edit").urinalOnly).toBe("false");
    expect(formStateFromLoo(makeLoo(), "edit").urinalOnly).toBe("");
  });

  it("is sent on its own when it is the only change", () => {
    const { payload, changedKeys } = editPatch(makeLoo({ urinalOnly: null }), (f) => ({
      ...f,
      urinalOnly: "true",
    }));
    expect(payload).toEqual({ urinalOnly: true, baseUpdatedAt: UPDATED_AT });
    expect(changedKeys).toEqual(["urinalOnly"]);
  });

  it("is not sent when untouched, and is sent as null when set back to unknown", () => {
    expect(editPatch(makeLoo({ urinalOnly: false }), (f) => f).payload).toEqual({});
    expect(
      editPatch(makeLoo({ urinalOnly: false }), (f) => ({ ...f, urinalOnly: "" })).payload,
    ).toEqual({ urinalOnly: null, baseUpdatedAt: UPDATED_AT });
  });

  it("counts as a changed field for conflicts and rebasing", () => {
    const loo = makeLoo({ urinalOnly: null });
    const initialForm = formStateFromLoo(loo, "edit");
    const form = { ...initialForm, urinalOnly: "true" as const };
    expect(changedFormFields(initialForm, form)).toEqual(["urinalOnly"]);
    const current = makeLoo({ urinalOnly: false, updatedAt: "2025-12-01T00:00:00.000Z" });
    expect(conflictingFields({ initialForm, form, current })).toEqual(["urinalOnly"]);
    expect(rebaseOnCurrent({ current, initialForm, form, mode: "edit" }).form.urinalOnly).toBe(
      "true",
    );
  });
});

describe("buildLooPatch (add)", () => {
  it("sends a full payload without active or baseUpdatedAt", () => {
    const initialForm = formStateFromLoo(null, "add");
    const form: LooFormState = {
      ...initialForm,
      name: "  Park toilets ",
      location: { lat: 53.4, lng: -2.98 },
      accessible: "true",
      noPayment: "false",
      paymentDetails: "20p",
    };
    const { payload, changedKeys } = buildLooPatch({
      initial: null,
      initialForm,
      form,
      mode: "add",
    });
    expect(payload).toEqual({
      name: "Park toilets",
      location: { lat: 53.4, lng: -2.98 },
      accessible: true,
      allGender: null,
      men: null,
      women: null,
      children: null,
      urinalOnly: null,
      babyChange: null,
      radar: null,
      automatic: null,
      noPayment: false,
      paymentDetails: "20p",
    });
    expect(payload).not.toHaveProperty("active");
    expect(payload).not.toHaveProperty("baseUpdatedAt");
    expect(payload).not.toHaveProperty("notes");
    expect(payload).not.toHaveProperty("openingTimes");
    expect(changedKeys).toContain("name");
    expect(Object.values(payload)).not.toContain(undefined);
  });

  it("drops payment details when the toilet is free", () => {
    const initialForm = formStateFromLoo(null, "add");
    const { payload } = buildLooPatch({
      initial: null,
      initialForm,
      form: { ...initialForm, name: "X", noPayment: "true", paymentDetails: "stale" },
      mode: "add",
    });
    expect(payload).not.toHaveProperty("paymentDetails");
    expect(payload.noPayment).toBe(true);
  });
});

describe("rebaseOnCurrent / conflictingFields", () => {
  it("adopts the current record and re-applies only the user's changes", () => {
    const original = makeLoo();
    const initialForm = formStateFromLoo(original, "edit");
    const form: LooFormState = { ...initialForm, radar: "true", notes: "Round the back" };

    const current = makeLoo({
      updatedAt: "2025-11-02T09:00:00.000Z",
      notes: "Next to the bus stop",
      babyChange: true,
      name: "High St toilets",
    });

    expect(conflictingFields({ initialForm, form, current })).toEqual(["notes"]);

    const rebased = rebaseOnCurrent({ current, initialForm, form, mode: "edit" });
    expect(rebased.initial).toBe(current);
    expect(rebased.reapplied.sort()).toEqual(["notes", "radar"]);
    // Someone else's changes are kept...
    expect(rebased.form.babyChange).toBe("true");
    expect(rebased.form.name).toBe("High St toilets");
    // ...and the user's changes win for the fields they touched.
    expect(rebased.form.radar).toBe("true");
    expect(rebased.form.notes).toBe("Round the back");

    const { payload } = buildLooPatch({
      initial: rebased.initial,
      initialForm: rebased.initialForm,
      form: rebased.form,
      mode: "edit",
    });
    expect(payload).toEqual({
      radar: true,
      notes: "Round the back",
      baseUpdatedAt: "2025-11-02T09:00:00.000Z",
    });
  });

  it("drops a change that the other edit already made", () => {
    const original = makeLoo();
    const initialForm = formStateFromLoo(original, "edit");
    const form: LooFormState = { ...initialForm, radar: "true" };
    const current = makeLoo({ radar: true, updatedAt: "2025-11-02T09:00:00.000Z" });

    expect(conflictingFields({ initialForm, form, current })).toEqual(["radar"]);
    const rebased = rebaseOnCurrent({ current, initialForm, form, mode: "edit" });
    expect(
      buildLooPatch({
        initial: rebased.initial,
        initialForm: rebased.initialForm,
        form: rebased.form,
        mode: "edit",
      }).payload,
    ).toEqual({});
  });

  it("changedFormFields ignores location jitter", () => {
    const loo = makeLoo();
    const initialForm = formStateFromLoo(loo, "edit");
    const form = {
      ...initialForm,
      location: northBy(initialForm.location as { lat: number; lng: number }, 0.2),
    };
    expect(changedFormFields(initialForm, form)).toEqual([]);
  });
});
