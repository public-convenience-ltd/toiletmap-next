import { describe, expect, it } from "vitest";
import { distanceMeters, isValidLatLng } from "./geometry";

describe("distanceMeters", () => {
  it("is zero for identical points", () => {
    expect(distanceMeters({ lat: 51.5, lng: -0.12 }, { lat: 51.5, lng: -0.12 })).toBe(0);
  });

  it("measures roughly 111 km per degree of latitude", () => {
    const d = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });

  it("matches a known city distance (London to Manchester ≈ 262 km)", () => {
    const d = distanceMeters({ lat: 51.5074, lng: -0.1278 }, { lat: 53.4808, lng: -2.2426 });
    expect(d / 1000).toBeGreaterThan(255);
    expect(d / 1000).toBeLessThan(268);
  });

  it("resolves sub-metre differences", () => {
    const a = { lat: 51.5, lng: -0.12 };
    const b = { lat: 51.5 + 0.1 / 111_195, lng: -0.12 };
    expect(distanceMeters(a, b)).toBeCloseTo(0.1, 2);
  });

  it("is symmetric", () => {
    const a = { lat: 50.1, lng: -5.5 };
    const b = { lat: 58.6, lng: -3.1 };
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 6);
  });
});

describe("isValidLatLng", () => {
  it("accepts in-range finite values", () => {
    expect(isValidLatLng(51.5, -0.12)).toBe(true);
    expect(isValidLatLng(-90, 180)).toBe(true);
  });

  it("rejects NaN, infinities and out-of-range values", () => {
    expect(isValidLatLng(Number.NaN, 0)).toBe(false);
    expect(isValidLatLng(0, Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidLatLng(91, 0)).toBe(false);
    expect(isValidLatLng(0, -181)).toBe(false);
  });
});
