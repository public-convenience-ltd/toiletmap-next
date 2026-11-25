import { describe, expect, it } from "vitest";
import {
  isLegacyLocationReport,
  isLegacyLocationSnapshot,
} from "../../src/services/loo/legacy-location-report";

describe("isLegacyLocationReport", () => {
  it("matches the row legacy setLooLocation writes", () => {
    expect(isLegacyLocationReport(["someone", "alice", "alice-location"])).toBe(true);
    // concat(NULL, '-location') when the array was empty.
    expect(isLegacyLocationReport(["-location"])).toBe(true);
  });

  it("does not match a handle that merely ends in -location", () => {
    expect(isLegacyLocationReport(["alice", "eve-location"])).toBe(false);
    expect(isLegacyLocationReport(["eve-location"])).toBe(false);
    expect(isLegacyLocationReport(["alice-location", "alice"])).toBe(false);
  });

  it("is false for anything that is not a contributors list", () => {
    expect(isLegacyLocationReport([])).toBe(false);
    expect(isLegacyLocationReport(null)).toBe(false);
    expect(isLegacyLocationReport("alice-location")).toBe(false);
    expect(isLegacyLocationReport([1, "1-location"])).toBe(false);
    expect(isLegacyLocationSnapshot(null)).toBe(false);
    expect(isLegacyLocationSnapshot({ contributors: ["a", "a-location"] })).toBe(true);
  });
});
