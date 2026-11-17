import L from "leaflet";
import { describe, expect, it } from "vitest";
import { BRAND_PINK, getIconString, LOO_ICON_SIZE, makeIcon } from "./looIcon";

describe("getIconString", () => {
  it("draws the pink pin with a white dot by default", () => {
    const svg = getIconString();
    expect(svg).toContain(`fill="${BRAND_PINK}"`);
    expect(svg).toContain("<circle");
    expect(svg).toContain('width="21"');
    expect(svg).toContain('height="33"');
    expect(svg).toContain('aria-hidden="true"');
  });

  it("draws a larger starred pin when highlighted", () => {
    const svg = getIconString("highlighted");
    expect(svg).not.toContain("<circle");
    expect(svg).toContain('width="28"');
    expect(svg).toContain('height="44"');
  });

  it("draws a grey, translucent pin when muted", () => {
    const svg = getIconString("muted");
    expect(svg).not.toContain(BRAND_PINK);
    expect(svg).toContain('opacity="0.75"');
  });
});

describe("makeIcon", () => {
  it.each(["default", "highlighted", "muted"] as const)(
    "anchors the %s pin at its tip",
    (variant) => {
      const icon = makeIcon(variant);
      expect(icon).toBeInstanceOf(L.DivIcon);
      const [w, h] = LOO_ICON_SIZE[variant];
      expect(icon.options.iconSize).toEqual([w, h]);
      expect(icon.options.iconAnchor).toEqual([w / 2, h]);
      expect(icon.options.html).toBe(getIconString(variant));
      expect(icon.options.className).toContain("loo-marker");
    },
  );

  it("marks the muted pin with its own class", () => {
    expect(makeIcon("muted").options.className).toBe("loo-marker loo-marker--muted");
  });
});
