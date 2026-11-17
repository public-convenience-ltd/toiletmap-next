import { describe, expect, it } from "vitest";
import type { LooDetail } from "../../api/loos";
import { buildLooPatch, formStateFromLoo, type LooFormState } from "../LooForm/payload";
import {
  compassDirection,
  describeBoolean,
  describeChanges,
  describeMove,
  formatDistance,
} from "./describeChanges";

const loo: LooDetail = {
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
  noPayment: false,
  paymentDetails: "50p",
  openingTimes: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  notes: "",
};

const items = (mutate: (f: LooFormState) => LooFormState, mode: "edit" | "add" = "edit") => {
  const initialForm = formStateFromLoo(mode === "edit" ? loo : null, mode);
  const form = mutate(formStateFromLoo(mode === "edit" ? loo : null, mode));
  const { payload } = buildLooPatch({
    initial: mode === "edit" ? loo : null,
    initialForm,
    form,
    mode,
  });
  return describeChanges({ mode, initialForm, payload });
};

/** Offset by roughly `north` and `east` metres. */
const offset = (north: number, east: number) => ({
  lat: 51.5 + north / 111_195,
  lng: -0.12 + east / (111_195 * Math.cos((51.5 * Math.PI) / 180)),
});

describe("describeChanges (edit)", () => {
  it("lists nothing for an untouched form", () => {
    expect(items((f) => f)).toEqual([]);
  });

  it("describes text as old → new, and empty text as Nothing", () => {
    expect(items((f) => ({ ...f, name: "Market toilets", notes: "Round the back" }))).toEqual([
      { field: "name", label: "Name", from: "High Street toilets", to: "Market toilets" },
      { field: "notes", label: "Notes", from: "Nothing", to: "Round the back" },
    ]);
  });

  it("describes yes/no answers as Yes, No or Don't know", () => {
    expect(items((f) => ({ ...f, accessible: "", radar: "true", urinalOnly: "false" }))).toEqual([
      { field: "urinalOnly", label: "Urinal only", from: "Don't know", to: "No" },
      { field: "accessible", label: "Wheelchair accessible", from: "Yes", to: "Don't know" },
      { field: "radar", label: "Needs a RADAR key", from: "Don't know", to: "Yes" },
    ]);
  });

  it("includes payment details cleared by making the toilet free", () => {
    expect(items((f) => ({ ...f, noPayment: "true" }))).toEqual([
      { field: "noPayment", label: "Free to use", from: "No", to: "Yes" },
      { field: "paymentDetails", label: "Payment details", from: "50p", to: "Nothing" },
    ]);
  });

  it("summarises opening hours", () => {
    const allDay = Array.from({ length: 7 }, () => ["00:00", "00:00"] as [string, string]);
    expect(items((f) => ({ ...f, openingTimes: allDay }))).toEqual([
      {
        field: "openingTimes",
        label: "Opening hours",
        from: "Opening hours not known",
        to: "Open 24 hours, every day",
      },
    ]);
  });

  it("describes a moved pin by distance and direction", () => {
    expect(items((f) => ({ ...f, location: offset(16, 16) }))).toEqual([
      { field: "location", label: "Location", to: "Moved 23 m north-east" },
    ]);
  });
});

describe("describeChanges (add)", () => {
  it("lists answered questions only, with no 'from' values", () => {
    const result = items(
      (f) => ({
        ...f,
        name: "New toilet",
        location: { lat: 51.5, lng: -0.1 },
        women: "true",
        noPayment: "false",
        paymentDetails: "20p",
      }),
      "add",
    );
    expect(result).toEqual([
      { field: "name", label: "Name", to: "New toilet" },
      { field: "location", label: "Location", to: "Placed on the map" },
      { field: "women", label: "Women", to: "Yes" },
      { field: "noPayment", label: "Free to use", to: "No" },
      { field: "paymentDetails", label: "Payment details", to: "20p" },
    ]);
  });
});

describe("move helpers", () => {
  it("names the eight compass directions", () => {
    const at = (n: number, e: number) => compassDirection({ lat: 51.5, lng: -0.12 }, offset(n, e));
    expect([
      at(10, 0),
      at(10, 10),
      at(0, 10),
      at(-10, 10),
      at(-10, 0),
      at(-10, -10),
      at(0, -10),
      at(10, -10),
    ]).toEqual([
      "north",
      "north-east",
      "east",
      "south-east",
      "south",
      "south-west",
      "west",
      "north-west",
    ]);
  });

  it("formats distances", () => {
    expect(formatDistance(0.4)).toBe("less than 1 m");
    expect(formatDistance(23.4)).toBe("23 m");
    expect(formatDistance(1530)).toBe("1.5 km");
  });

  it("describes first placement and tiny moves", () => {
    expect(describeMove(null, { lat: 1, lng: 1 })).toBe("Placed on the map");
    expect(describeMove({ lat: 51.5, lng: -0.12 }, offset(0.3, 0))).toBe("Moved less than 1 m");
  });

  it("describes booleans", () => {
    expect([true, false, null, undefined].map(describeBoolean)).toEqual([
      "Yes",
      "No",
      "Don't know",
      "Don't know",
    ]);
  });
});
