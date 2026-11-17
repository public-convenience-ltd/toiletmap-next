import { describe, expect, it } from "vitest";
import { describeIssues, fieldErrorsFromIssues } from "./issues";

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

describe("fieldErrorsFromIssues", () => {
  const FIELDS = ["name", "location", "openingTimes", "notes"] as const;

  it("maps a Zod format() tree onto form fields by the first path segment", () => {
    const issues = {
      _errors: ["Body is invalid"],
      location: { _errors: [], lat: { _errors: ["Expected number"] } },
      name: { _errors: ["Too long", "Second message"] },
      openingTimes: { _errors: [], "2": { _errors: ["Closing time must be after opening"] } },
      secretField: { _errors: ["Not allowed"] },
    };
    expect(fieldErrorsFromIssues(issues, FIELDS)).toEqual({
      fields: {
        location: "Expected number",
        name: "Too long",
        openingTimes: "Closing time must be after opening",
      },
      other: ["Body is invalid", "secretField: Not allowed"],
    });
  });

  it("maps flat issue arrays and ignores junk", () => {
    expect(
      fieldErrorsFromIssues(
        [{ path: ["notes"], message: "Too long" }, { path: [], message: "General" }, null, 3],
        FIELDS,
      ),
    ).toEqual({ fields: { notes: "Too long" }, other: ["General"] });
    expect(fieldErrorsFromIssues(undefined, FIELDS)).toEqual({ fields: {}, other: [] });
  });
});
