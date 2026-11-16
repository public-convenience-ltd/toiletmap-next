import { describe, expect, it } from "vitest";
import { describeIssues } from "./issues";

describe("describeIssues", () => {
  it("flattens a Zod format() tree", () => {
    const issues = {
      _errors: [],
      location: { _errors: [], lat: { _errors: ["Expected number"] } },
      name: { _errors: ["Too long"] },
    };
    expect(describeIssues(issues)).toEqual(["location.lat: Expected number", "name: Too long"]);
  });

  it("handles flat issue arrays and ignores junk", () => {
    expect(describeIssues([{ path: ["active"], message: "Expected boolean" }, null, 3])).toEqual([
      "active: Expected boolean",
    ]);
    expect(describeIssues(undefined)).toEqual([]);
  });
});
