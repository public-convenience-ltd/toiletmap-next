import { describe, expect, it } from "vitest";
import { isOriginAllowed } from "../../src/middleware/security-headers";

describe("isOriginAllowed", () => {
  it("should return false if origin is undefined", () => {
    expect(isOriginAllowed(undefined, ["*"])).toBe(false);
  });

  it("should allow all origins if wildcard is present", () => {
    expect(isOriginAllowed("https://example.com", ["*"])).toBe(true);
  });

  it("should allow exact matches", () => {
    expect(isOriginAllowed("https://example.com", ["https://example.com"])).toBe(true);
  });

  it("should disallow non-matching origins", () => {
    expect(isOriginAllowed("https://evil.com", ["https://example.com"])).toBe(false);
  });

  it("should handle wildcard subdomains without protocol in config (legacy behavior)", () => {
    // This tests the existing logic: "*.example.com" matches "sub.example.com"
    // Note: The existing logic compares origin.endsWith(domain), so "https://sub.example.com" ends with "example.com"
    // But let's see how it behaves with the current implementation.
    // The current implementation:
    // if (allowed.startsWith("*.")) {
    //   const domain = allowed.slice(1); // ".example.com"
    //   return origin.endsWith(domain);
    // }
    expect(isOriginAllowed("https://sub.example.com", ["*.example.com"])).toBe(true);
  });

  it("should handle wildcard subdomains with protocol", () => {
    // This is the failing case we want to fix
    const allowed = ["https://*.gbtoiletmap.workers.dev"];
    const origin = "https://667ce7fb-toiletmap-client.gbtoiletmap.workers.dev";
    expect(isOriginAllowed(origin, allowed)).toBe(true);
  });

  it("should handle wildcard subdomains with protocol (http)", () => {
    const allowed = ["http://*.localhost"];
    const origin = "http://sub.localhost";
    expect(isOriginAllowed(origin, allowed)).toBe(true);
  });

  it("should not match if protocol differs", () => {
    const allowed = ["https://*.example.com"];
    const origin = "http://sub.example.com";
    expect(isOriginAllowed(origin, allowed)).toBe(false);
  });
});
