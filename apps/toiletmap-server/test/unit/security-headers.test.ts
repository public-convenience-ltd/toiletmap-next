import { describe, expect, it, vi } from "vitest";
import {
  DEVELOPMENT_CORS_ORIGINS,
  isOriginAllowed,
  parseAllowedOrigins,
} from "../../src/middleware/security-headers";

describe("isOriginAllowed", () => {
  it("returns false if origin is undefined", () => {
    expect(isOriginAllowed(undefined, ["https://example.com"])).toBe(false);
  });

  it("allows exact matches only", () => {
    expect(isOriginAllowed("https://example.com", ["https://example.com"])).toBe(true);
    expect(isOriginAllowed("https://evil.com", ["https://example.com"])).toBe(false);
    expect(isOriginAllowed("https://example.com.evil.com", ["https://example.com"])).toBe(false);
  });

  it("never treats * as a wildcard", () => {
    expect(isOriginAllowed("https://example.com", ["*"])).toBe(false);
    expect(
      isOriginAllowed("https://667ce7fb-toiletmap-client.gbtoiletmap.workers.dev", [
        "https://*.gbtoiletmap.workers.dev",
      ]),
    ).toBe(false);
  });
});

describe("parseAllowedOrigins", () => {
  it("keeps exact origins and drops wildcards and non-origins with a warning", () => {
    const warn = vi.fn();
    expect(
      parseAllowedOrigins(
        " https://www.toiletmap.org.uk , https://*.gbtoiletmap.workers.dev,*,https://a.example/path,http://localhost:4321",
        { isPublic: true, warn },
      ),
    ).toEqual(["https://www.toiletmap.org.uk", "http://localhost:4321"]);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("defaults to nothing in public environments and to localhost in development", () => {
    expect(parseAllowedOrigins(undefined, { isPublic: true })).toEqual([]);
    expect(parseAllowedOrigins("", { isPublic: true })).toEqual([]);
    expect(parseAllowedOrigins(undefined, { isPublic: false })).toEqual(DEVELOPMENT_CORS_ORIGINS);
    expect(DEVELOPMENT_CORS_ORIGINS).not.toContain("*");
  });
});
