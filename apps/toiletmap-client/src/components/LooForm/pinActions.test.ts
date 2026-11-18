import { describe, expect, it } from "vitest";
import { shouldOfferLocationReset } from "./pinActions";

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
