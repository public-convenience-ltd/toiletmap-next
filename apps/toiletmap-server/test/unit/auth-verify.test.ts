import { describe, expect, it } from "vitest";
import { matchesAudience, normalizeUser } from "../../../../packages/auth/src/verify";

describe("matchesAudience", () => {
  it("returns true when expected is empty", () => {
    expect(matchesAudience("anything", "")).toBe(true);
  });

  it("matches an exact string audience", () => {
    expect(matchesAudience("https://api.example.com", "https://api.example.com")).toBe(true);
  });

  it("returns false for a non-matching string audience", () => {
    expect(matchesAudience("https://api.example.com", "https://other.example.com")).toBe(false);
  });

  it("matches when the expected value is in an array audience", () => {
    expect(
      matchesAudience(
        ["https://api.example.com", "https://other.example.com"],
        "https://api.example.com",
      ),
    ).toBe(true);
  });

  it("returns false when the expected value is not in an array audience", () => {
    expect(matchesAudience(["https://api.example.com"], "https://other.example.com")).toBe(false);
  });

  it("matches a space-separated multi-audience string", () => {
    expect(
      matchesAudience(
        "https://api.example.com https://other.example.com",
        "https://other.example.com",
      ),
    ).toBe(true);
  });

  it("matches a comma-separated multi-audience string", () => {
    expect(
      matchesAudience(
        "https://api.example.com,https://other.example.com",
        "https://other.example.com",
      ),
    ).toBe(true);
  });

  it("does NOT match a single-value string via split (no ambiguity)", () => {
    // A single-part split produces one item, so parts.length > 1 is false
    expect(matchesAudience("https://api.example.com", "https://api.example.com")).toBe(true);
  });

  it("returns false for non-string, non-array audience", () => {
    expect(matchesAudience(42, "https://api.example.com")).toBe(false);
    expect(matchesAudience(null, "https://api.example.com")).toBe(false);
  });
});

describe("normalizeUser", () => {
  it("returns a RequestUser with all fields trimmed", () => {
    const result = normalizeUser({
      sub: "  auth0|abc  ",
      name: "  Alice  ",
      nickname: "  alice  ",
      email: "  alice@example.com  ",
      permissions: ["access:admin"],
    });

    expect(result.sub).toBe("auth0|abc");
    expect(result.name).toBe("Alice");
    expect(result.nickname).toBe("alice");
    expect(result.email).toBe("alice@example.com");
    expect(result.permissions).toEqual(["access:admin"]);
  });

  it("throws when sub is missing", () => {
    expect(() => normalizeUser({ sub: undefined })).toThrow("Auth0 token missing `sub` claim");
  });

  it("throws when sub is an empty string after trimming", () => {
    expect(() => normalizeUser({ sub: "   " })).toThrow("Auth0 token missing `sub` claim");
  });

  it("returns undefined for empty optional string fields", () => {
    const result = normalizeUser({ sub: "auth0|abc", name: "  ", email: "" });
    expect(result.name).toBeUndefined();
    expect(result.email).toBeUndefined();
  });

  it("filters non-string values out of the permissions array", () => {
    const result = normalizeUser({
      sub: "auth0|abc",
      permissions: [
        "access:admin",
        42 as unknown as string,
        null as unknown as string,
        "report:loo",
      ],
    });
    expect(result.permissions).toEqual(["access:admin", "report:loo"]);
  });

  it("sets permissions to undefined when permissions is not an array", () => {
    const result = normalizeUser({ sub: "auth0|abc", permissions: undefined });
    expect(result.permissions).toBeUndefined();
  });

  it("preserves extra unknown claims via spread", () => {
    const result = normalizeUser({ sub: "auth0|abc", custom_claim: "value" });
    expect((result as Record<string, unknown>).custom_claim).toBe("value");
  });
});
