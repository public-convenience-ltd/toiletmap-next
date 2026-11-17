import { describe, expect, it } from "vitest";
import {
  diffMutation,
  haversineDistanceMetres,
  isEmptyMutation,
  isStaleBase,
  type LooDiffBase,
} from "../../src/services/loo/diff";
import type { OpeningTimes } from "../../src/services/loo/types";

const weekdayHours: OpeningTimes = [
  ["09:00", "17:00"],
  ["09:00", "17:00"],
  ["09:00", "17:00"],
  ["09:00", "17:00"],
  ["09:00", "17:00"],
  [],
  [],
];

const buildExisting = (overrides: Partial<LooDiffBase> = {}): LooDiffBase => ({
  id: "a".repeat(24),
  name: "Station Loo",
  area: [{ name: "Camden", type: "borough" }],
  areaId: "b".repeat(24),
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-06-01T12:00:00.000Z",
  verifiedAt: null,
  reports: [],
  contributorsCount: 1,
  geohash: "gcpvj",
  accessible: true,
  active: true,
  allGender: null,
  attended: false,
  automatic: null,
  babyChange: true,
  children: null,
  men: true,
  women: true,
  urinalOnly: false,
  notes: "Behind the ticket office",
  noPayment: false,
  paymentDetails: "20p",
  removalReason: null,
  removalCategory: null,
  duplicateOf: null,
  radar: null,
  openingTimes: weekdayHours,
  location: { lat: 51.5308, lng: -0.1238 },
  ...overrides,
});

describe("diffMutation", () => {
  it("returns an empty diff when every submitted field already matches", () => {
    const existing = buildExisting();
    const diff = diffMutation(
      {
        name: "Station Loo",
        accessible: true,
        active: true,
        allGender: null,
        notes: "Behind the ticket office",
        paymentDetails: "20p",
        openingTimes: weekdayHours.map((day) => [...day]) as OpeningTimes,
        location: { lat: 51.5308, lng: -0.1238 },
        areaId: "b".repeat(24),
      },
      existing,
    );
    expect(diff).toEqual({});
    expect(isEmptyMutation(diff)).toBe(true);
  });

  it("keeps only the fields that change", () => {
    const diff = diffMutation(
      { name: "Station Loo", radar: true, accessible: true, notes: "Updated" },
      buildExisting(),
    );
    expect(diff).toEqual({ radar: true, notes: "Updated" });
  });

  it("never includes omitted (undefined) fields", () => {
    const diff = diffMutation({ notes: undefined, radar: undefined }, buildExisting());
    expect(diff).toEqual({});
    expect(Object.keys(diff)).toHaveLength(0);
  });

  it("keeps explicit nulls that clear a value", () => {
    const diff = diffMutation({ notes: null, paymentDetails: null }, buildExisting());
    expect(diff).toEqual({ notes: null, paymentDetails: null });
    expect(Object.hasOwn(diff, "notes")).toBe(true);
  });

  it("drops nulls when the value is already null", () => {
    const diff = diffMutation({ radar: null, removalReason: null }, buildExisting());
    expect(diff).toEqual({});
  });

  it("treats false and null as different values", () => {
    expect(diffMutation({ allGender: false }, buildExisting())).toEqual({ allGender: false });
    expect(diffMutation({ attended: null }, buildExisting())).toEqual({ attended: null });
  });

  it("detects deactivation", () => {
    expect(diffMutation({ active: false }, buildExisting())).toEqual({ active: false });
  });

  describe("openingTimes", () => {
    it("compares structurally", () => {
      const changed = weekdayHours.map((day, i) =>
        i === 5 ? ["10:00", "14:00"] : [...day],
      ) as OpeningTimes;
      expect(diffMutation({ openingTimes: changed }, buildExisting())).toEqual({
        openingTimes: changed,
      });
    });

    it("distinguishes unknown (null) from closed every day", () => {
      const allClosed = Array.from({ length: 7 }, () => []) as OpeningTimes;
      expect(
        diffMutation({ openingTimes: allClosed }, buildExisting({ openingTimes: null })),
      ).toEqual({ openingTimes: allClosed });
      expect(diffMutation({ openingTimes: null }, buildExisting({ openingTimes: null }))).toEqual(
        {},
      );
      expect(diffMutation({ openingTimes: null }, buildExisting())).toEqual({ openingTimes: null });
    });
  });

  describe("location", () => {
    it("ignores movements within 0.5 m", () => {
      // ~0.2 m north
      const nudged = { lat: 51.5308 + 0.0000018, lng: -0.1238 };
      expect(diffMutation({ location: nudged }, buildExisting())).toEqual({});
    });

    it("keeps movements beyond 0.5 m", () => {
      // ~1.1 m north
      const moved = { lat: 51.5308 + 0.00001, lng: -0.1238 };
      expect(diffMutation({ location: moved }, buildExisting())).toEqual({ location: moved });
    });

    it("handles null on either side", () => {
      const location = { lat: 51.5, lng: -0.1 };
      expect(diffMutation({ location }, buildExisting({ location: null }))).toEqual({ location });
      expect(diffMutation({ location: null }, buildExisting())).toEqual({ location: null });
      expect(diffMutation({ location: null }, buildExisting({ location: null }))).toEqual({});
    });
  });

  describe("areaId", () => {
    it("compares against a known areaId", () => {
      expect(diffMutation({ areaId: "b".repeat(24) }, buildExisting())).toEqual({});
      expect(diffMutation({ areaId: "c".repeat(24) }, buildExisting())).toEqual({
        areaId: "c".repeat(24),
      });
    });

    it("treats areaId as changed when the base does not know it", () => {
      const { areaId: _ignored, ...withoutAreaId } = buildExisting();
      expect(diffMutation({ areaId: "b".repeat(24) }, withoutAreaId)).toEqual({
        areaId: "b".repeat(24),
      });
    });
  });

  it("does not mutate its inputs", () => {
    const mutation = { notes: "New", radar: true };
    const existing = buildExisting();
    const snapshot = structuredClone(existing);
    diffMutation(mutation, existing);
    expect(mutation).toEqual({ notes: "New", radar: true });
    expect(existing).toEqual(snapshot);
  });
});

describe("haversineDistanceMetres", () => {
  it("is zero for identical points", () => {
    expect(haversineDistanceMetres({ lat: 51.5, lng: -0.1 }, { lat: 51.5, lng: -0.1 })).toBe(0);
  });

  it("measures roughly 111 km per degree of latitude", () => {
    const d = haversineDistanceMetres({ lat: 51, lng: 0 }, { lat: 52, lng: 0 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });
});

describe("isStaleBase", () => {
  const current = "2025-06-01T12:00:00.000Z";

  it("is false when no base is supplied", () => {
    expect(isStaleBase(undefined, current)).toBe(false);
    expect(isStaleBase(null, current)).toBe(false);
  });

  it("compares instants, not strings", () => {
    expect(isStaleBase("2025-06-01T13:00:00.000+01:00", current)).toBe(false);
    expect(isStaleBase(new Date(current), current)).toBe(false);
  });

  it("is true when the record has moved on", () => {
    expect(isStaleBase("2025-05-01T12:00:00.000Z", current)).toBe(true);
  });

  it("never conflicts for records without an updatedAt", () => {
    expect(isStaleBase("2025-05-01T12:00:00.000Z", null)).toBe(false);
  });
});
