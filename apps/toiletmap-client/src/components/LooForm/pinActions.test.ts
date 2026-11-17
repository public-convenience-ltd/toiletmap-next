import { describe, expect, it } from "vitest";
import { CENTRE_TOLERANCE_PX, shouldOfferLocationReset, shouldShowCrosshair } from "./pinActions";

describe("shouldShowCrosshair", () => {
  const centre = { x: 200, y: 180 };

  it("shows while no pin is placed", () => {
    expect(shouldShowCrosshair(null, centre)).toBe(true);
  });

  it("hides when the marker is at the centre (within tolerance)", () => {
    expect(shouldShowCrosshair({ x: 200, y: 180 }, centre)).toBe(false);
    expect(shouldShowCrosshair({ x: 200 + CENTRE_TOLERANCE_PX, y: 180 }, centre)).toBe(false);
  });

  it("shows when the marker is away from the centre or off-screen", () => {
    expect(shouldShowCrosshair({ x: 200 + CENTRE_TOLERANCE_PX + 1, y: 180 }, centre)).toBe(true);
    expect(shouldShowCrosshair({ x: -5000, y: 9000 }, centre)).toBe(true);
  });

  it("treats a non-finite marker point as not centred", () => {
    expect(shouldShowCrosshair({ x: Number.NaN, y: 180 }, centre)).toBe(true);
  });
});

describe("shouldOfferLocationReset", () => {
  const original = { lat: 51.5, lng: -0.1 };

  it("is hidden without an original location (add mode / loo without location)", () => {
    expect(shouldOfferLocationReset(null, { lat: 51.6, lng: -0.1 })).toBe(false);
    expect(shouldOfferLocationReset(undefined, { lat: 51.6, lng: -0.1 })).toBe(false);
  });

  it("is hidden when the pin is at (or within jitter of) the original", () => {
    expect(shouldOfferLocationReset(original, { ...original })).toBe(false);
    // ~0.1 m away: below the 0.5 m change threshold
    expect(shouldOfferLocationReset(original, { lat: 51.500001, lng: -0.1 })).toBe(false);
  });

  it("is shown once the pin has really moved", () => {
    expect(shouldOfferLocationReset(original, { lat: 51.5001, lng: -0.1 })).toBe(true);
  });
});
