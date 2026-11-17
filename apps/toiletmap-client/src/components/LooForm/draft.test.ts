import { beforeEach, describe, expect, it } from "vitest";
import type { LooDetail } from "../../api/loos";
import {
  applyDraft,
  clearDraft,
  DRAFT_MAX_AGE_MS,
  draftKey,
  draftWithUnresolvedConflicts,
  type LooDraft,
  loadDraft,
  saveDraft,
} from "./draft";
import { formStateFromLoo } from "./payload";

const loo = {
  id: "abcdefabcdefabcdefabcdef",
  name: "High Street toilets",
  location: { lat: 51.5, lng: -0.12 },
  accessible: true,
  allGender: null,
  men: true,
  women: true,
  children: null,
  babyChange: false,
  radar: null,
  automatic: null,
  noPayment: true,
  paymentDetails: null,
  openingTimes: Array.from({ length: 7 }, () => ["09:00", "17:00"]),
  updatedAt: "2026-01-01T00:00:00.000Z",
  notes: "Behind the library",
} as LooDetail;

beforeEach(() => sessionStorage.clear());

describe("draftKey", () => {
  it("uses the toilet id, or new", () => {
    expect(draftKey("abc")).toBe("loo-draft:abc");
    expect(draftKey(undefined)).toBe("loo-draft:new");
    expect(draftKey(null)).toBe("loo-draft:new");
  });
});

describe("saveDraft / loadDraft / clearDraft", () => {
  it("round-trips the baseline and the form", () => {
    const initialForm = formStateFromLoo(loo, "edit");
    const form = { ...initialForm, name: "Changed", location: { lat: 51.6, lng: -0.1 } };
    saveDraft("k", initialForm, form, loo.updatedAt);
    const draft = loadDraft("k");
    expect(draft?.initialForm).toEqual(initialForm);
    expect(draft?.form).toEqual(form);
    expect(draft?.baseUpdatedAt).toBe(loo.updatedAt);
    expect(draft?.savedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    clearDraft("k");
    expect(loadDraft("k")).toBeNull();
  });

  it("round-trips the spot a new toilet's page was opened at, ignoring a bad one", () => {
    const empty = formStateFromLoo(null, "add");
    saveDraft("k", empty, { ...empty, name: "New" }, null, {
      requestedView: { lat: 51.5, lng: -0.12 },
    });
    expect(loadDraft("k")?.requestedView).toEqual({ lat: 51.5, lng: -0.12 });
    saveDraft("k", empty, { ...empty, name: "New" });
    expect(loadDraft("k")?.requestedView).toBeNull();
    const raw = JSON.parse(sessionStorage.getItem("k") ?? "{}");
    sessionStorage.setItem("k", JSON.stringify({ ...raw, requestedView: { lat: 200, lng: 0 } }));
    expect(loadDraft("k")?.requestedView).toBeNull();
  });

  it.each([
    ["not JSON", "{oops"],
    ["wrong version", JSON.stringify({ v: 99 })],
    ["bad tri-state", JSON.stringify({ v: 1, initialForm: {}, form: {} })],
    [
      "bad opening hours",
      JSON.stringify({
        v: 1,
        initialForm: { ...formStateFromLoo(loo, "edit") },
        form: { ...formStateFromLoo(loo, "edit"), openingTimes: [1, 2, 3] },
      }),
    ],
    [
      "out-of-range location",
      JSON.stringify({
        v: 1,
        initialForm: { ...formStateFromLoo(loo, "edit") },
        form: { ...formStateFromLoo(loo, "edit"), location: { lat: 200, lng: 0 } },
      }),
    ],
  ])("ignores a draft with %s", (_label, raw) => {
    sessionStorage.setItem("k", raw);
    expect(loadDraft("k")).toBeNull();
  });

  it("reads a field missing from an older draft as unknown", () => {
    const initialForm = formStateFromLoo(loo, "edit") as Record<string, unknown>;
    const { urinalOnly: _a, ...oldInitial } = initialForm;
    const { urinalOnly: _b, ...oldForm }: Record<string, unknown> = { ...initialForm, name: "X" };
    sessionStorage.setItem(
      "k",
      JSON.stringify({
        v: 1,
        initialForm: oldInitial,
        form: oldForm,
        savedAt: new Date().toISOString(),
      }),
    );
    expect(loadDraft("k")?.form.urinalOnly).toBe("");
    // A draft from before baseUpdatedAt was stored reads it as unknown.
    expect(loadDraft("k")?.baseUpdatedAt).toBeNull();
  });

  it("drops (and removes) a draft older than a day, or with no readable timestamp", () => {
    const initialForm = formStateFromLoo(loo, "edit");
    saveDraft("k", initialForm, { ...initialForm, name: "Old" });
    const now = Date.now();
    expect(loadDraft("k", now + DRAFT_MAX_AGE_MS - 60_000)).not.toBeNull();
    expect(loadDraft("k", now + DRAFT_MAX_AGE_MS + 60_000)).toBeNull();
    expect(sessionStorage.getItem("k")).toBeNull();

    sessionStorage.setItem(
      "k",
      JSON.stringify({ v: 1, initialForm, form: { ...initialForm, name: "X" }, savedAt: "?" }),
    );
    expect(loadDraft("k")).toBeNull();
  });
});

describe("applyDraft", () => {
  it("re-applies only the changed fields onto the current baseline", () => {
    const initialForm = formStateFromLoo(loo, "edit");
    const draft = {
      initialForm,
      form: { ...initialForm, name: "Mine", women: "false" as const },
      savedAt: "",
    };
    const current = formStateFromLoo({ ...loo, notes: "Changed elsewhere" }, "edit");
    expect(applyDraft(draft, current)).toEqual({
      form: { ...current, name: "Mine", women: "false" },
      conflicts: [],
      draftValues: {},
      skipped: [],
    });
  });

  it("returns null when the draft has no changes, or the toilet already matches it", () => {
    const initialForm = formStateFromLoo(loo, "edit");
    expect(applyDraft({ initialForm, form: initialForm, savedAt: "" }, initialForm)).toBeNull();
    const draft = { initialForm, form: { ...initialForm, name: "Mine" }, savedAt: "" };
    const current = formStateFromLoo({ ...loo, name: "Mine" }, "edit");
    expect(applyDraft(draft, current)).toBeNull();
  });

  it("copies opening hours rather than sharing the draft's arrays", () => {
    const initialForm = formStateFromLoo(loo, "edit");
    const hours = Array.from({ length: 7 }, () => ["10:00", "16:00"] as [string, string]);
    const draft = { initialForm, form: { ...initialForm, openingTimes: hours }, savedAt: "" };
    const next = applyDraft(draft, initialForm)?.form;
    expect(next?.openingTimes).toEqual(hours);
    expect(next?.openingTimes).not.toBe(hours);
    expect(next?.openingTimes?.[0]).not.toBe(hours[0]);
  });

  describe("when the server changed the same field since the draft", () => {
    const initialForm = formStateFromLoo(loo, "edit");
    const draft: LooDraft = {
      initialForm,
      form: { ...initialForm, name: "Mine", women: "false" },
      savedAt: "",
      baseUpdatedAt: loo.updatedAt,
    };
    const newer = { ...loo, name: "Theirs", updatedAt: "2026-02-01T00:00:00.000Z" };

    it("keeps the newer server value and reports the conflict", () => {
      const restored = applyDraft(draft, formStateFromLoo(newer, "edit"), {
        currentUpdatedAt: newer.updatedAt,
      });
      expect(restored?.form.name).toBe("Theirs");
      expect(restored?.form.women).toBe("false");
      expect(restored?.conflicts).toEqual(["name"]);
      expect(restored?.draftValues).toEqual({ name: "Mine" });
    });

    it("is no conflict when they made the same change", () => {
      const same = { ...newer, name: "Mine" };
      const restored = applyDraft(draft, formStateFromLoo(same, "edit"), {
        currentUpdatedAt: same.updatedAt,
      });
      expect(restored?.conflicts).toEqual([]);
      expect(restored?.form.name).toBe("Mine");
    });

    it("still reports a conflict when only conflicting fields are left", () => {
      const onlyName: LooDraft = { ...draft, form: { ...initialForm, name: "Mine" } };
      const restored = applyDraft(onlyName, formStateFromLoo(newer, "edit"));
      expect(restored).toMatchObject({ conflicts: ["name"], draftValues: { name: "Mine" } });
      expect(restored?.form.name).toBe("Theirs");
    });
  });

  it("leaves out skipped fields", () => {
    const initialForm = formStateFromLoo(null, "add");
    const draft: LooDraft = {
      initialForm,
      form: { ...initialForm, name: "New", location: { lat: 51.6, lng: -0.2 } },
      savedAt: "",
    };
    const restored = applyDraft(draft, initialForm, { skip: ["location"] });
    expect(restored?.form.location).toBeNull();
    expect(restored?.form.name).toBe("New");
    expect(restored?.skipped).toEqual(["location"]);
    // Nothing left to restore once the only change is skipped.
    expect(
      applyDraft(
        { ...draft, form: { ...initialForm, location: { lat: 1, lng: 1 } } },
        initialForm,
        {
          skip: ["location"],
        },
      ),
    ).toBeNull();
  });
});

describe("draftWithUnresolvedConflicts", () => {
  const original = formStateFromLoo(loo, "edit");
  const current = { ...original, name: "Their name", notes: "Their notes" };
  const conflicts = {
    fields: ["name" as const],
    values: { name: "My name" },
    baseForm: original,
    baseUpdatedAt: "2026-01-01T00:00:00.000Z",
  };
  const NEWER = "2026-02-01T00:00:00.000Z";

  it("stores the form as-is when nothing is unresolved", () => {
    const form = { ...current, women: "false" as const };
    expect(draftWithUnresolvedConflicts(current, form, NEWER, null)).toEqual({
      initialForm: current,
      form,
      baseUpdatedAt: NEWER,
    });
  });

  it("keeps the user's value for an untouched conflicting field, so restoring asks again", () => {
    const form = { ...current, women: "false" as const };
    const stored = draftWithUnresolvedConflicts(current, form, NEWER, conflicts);
    expect(stored.form).toEqual({ ...form, name: "My name" });
    expect(stored.initialForm).toEqual({ ...current, name: original.name });
    expect(stored.baseUpdatedAt).toBe(conflicts.baseUpdatedAt);

    const restored = applyDraft({ ...stored, savedAt: "" }, current, { currentUpdatedAt: NEWER });
    expect(restored?.conflicts).toEqual(["name"]);
    expect(restored?.draftValues).toEqual({ name: "My name" });
    expect(restored?.form).toEqual({ ...current, women: "false" });
  });

  it("stores a conflicting field the user has since edited as their edit", () => {
    const form = { ...current, name: "Typed again" };
    expect(draftWithUnresolvedConflicts(current, form, NEWER, conflicts)).toEqual({
      initialForm: current,
      form,
      baseUpdatedAt: NEWER,
    });
  });
});
