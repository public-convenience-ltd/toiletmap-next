import { describe, expect, it } from "vitest";
import {
  copyDayTo,
  createDefaultOpeningTimes,
  isTwentyFourHours,
  type OpeningTimes,
  validateOpeningTimes,
} from "./openingTimes";

const week = (day: [string, string] | []): OpeningTimes =>
  Array.from({ length: 7 }, () => [...day] as [string, string] | []);

describe("isTwentyFourHours", () => {
  it("is true for 00:00–00:00", () => {
    expect(isTwentyFourHours(["00:00", "00:00"])).toBe(true);
  });

  it("is true for any equal pair", () => {
    expect(isTwentyFourHours(["12:00", "12:00"])).toBe(true);
    expect(isTwentyFourHours(["24:00", "24:00"])).toBe(true);
  });

  it("is false for closed days and normal ranges", () => {
    expect(isTwentyFourHours([])).toBe(false);
    expect(isTwentyFourHours(["09:00", "17:00"])).toBe(false);
    expect(isTwentyFourHours(["", ""])).toBe(false);
  });
});

describe("validateOpeningTimes", () => {
  it("accepts null (hours not known)", () => {
    expect(validateOpeningTimes(null)).toBeNull();
  });

  it("accepts a normal week, closed days, 24 hours and overnight ranges", () => {
    const value: OpeningTimes = [
      ["09:00", "17:00"],
      [],
      ["00:00", "00:00"],
      ["12:00", "12:00"],
      ["22:00", "02:00"],
      ["06:30", "24:00"],
      [],
    ];
    expect(validateOpeningTimes(value)).toBeNull();
  });

  it("accepts the default starting week", () => {
    expect(validateOpeningTimes(createDefaultOpeningTimes())).toBeNull();
  });

  it("requires exactly seven days", () => {
    expect(validateOpeningTimes(week([]).slice(0, 6))).toMatch(/seven days/);
    expect(validateOpeningTimes([...week([]), []])).toMatch(/seven days/);
  });

  it("names the day with a missing time", () => {
    const value = week(["09:00", "17:00"]);
    value[1] = ["09:00", ""];
    expect(validateOpeningTimes(value)).toBe("Enter both opening and closing times for Tuesday.");
  });

  it("rejects malformed and out-of-range times", () => {
    for (const bad of ["9:00", "24:30", "25:00", "12:60", "noon"]) {
      const value = week(["09:00", "17:00"]);
      value[6] = ["09:00", bad];
      expect(validateOpeningTimes(value)).toMatch(/Sunday/);
    }
  });

  it("rejects a day with a single time", () => {
    const value = week([]);
    (value as unknown[])[0] = ["09:00"];
    expect(validateOpeningTimes(value)).toMatch(/Monday/);
  });
});

describe("createDefaultOpeningTimes", () => {
  it("returns 09:00–17:00 for all seven days, as independent arrays", () => {
    const value = createDefaultOpeningTimes();
    expect(value).toHaveLength(7);
    expect(value.every((day) => day[0] === "09:00" && day[1] === "17:00")).toBe(true);
    expect(value[0]).not.toBe(value[1]);
  });
});

describe("copyDayTo", () => {
  it("copies Monday to the selected days only", () => {
    const value: OpeningTimes = [["08:00", "20:00"], [], [], [], [], [], ["10:00", "16:00"]];
    const next = copyDayTo(value, 0, [1, 2, 3, 4]);
    expect(next.slice(0, 5).every((day) => day[0] === "08:00" && day[1] === "20:00")).toBe(true);
    expect(next[5]).toEqual([]);
    expect(next[6]).toEqual(["10:00", "16:00"]);
    expect(value[1]).toEqual([]);
  });
});
