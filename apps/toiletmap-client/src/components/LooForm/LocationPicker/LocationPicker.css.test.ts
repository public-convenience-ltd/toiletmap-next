// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { declarationsFor, parseCss } from "../../ToiletDetailsPanel/css.testutil";

const rules = parseCss(
  readFileSync(join(import.meta.dirname, "LocationPicker.module.css"), "utf8"),
);
const rule = (selector: string, at: string[] = []) => declarationsFor(rules, selector, at);
const COARSE = "@media (pointer: coarse)";

describe("LocationPicker.module.css on the map", () => {
  it("keeps Move pin above the OpenStreetMap attribution", () => {
    expect(rule(".mapActions").bottom).toBe("calc(var(--space-xs) + 20px)");
  });

  it("gives Leaflet's +/- a 44px target on touch screens, like Move pin", () => {
    const zoom = rule(".map :global(.leaflet-control-zoom a)", [COARSE]);
    expect(zoom.width).toBe("44px");
    expect(zoom.height).toBe("44px");
    expect(rule(".movePin")["min-height"]).toBe("44px");
  });

  it("moves the chip to the bottom when asked, clear of the grey pin", () => {
    expect(rule('.chip[data-position="bottom"]')).toMatchObject({
      top: "auto",
      bottom: "var(--space-xs)",
    });
  });

  it("keeps the link buttons (Reset to original location) underlined on touch screens", () => {
    expect(rule(".linkButton", [COARSE])).toMatchObject({
      display: "inline-block",
      "min-height": "44px",
      "text-decoration": "underline",
    });
    // Hover drops the underline only where there is a real hover: on a phone :hover sticks
    // under the last tap, which is where Reset appears after "Show on map".
    expect(rule(".linkButton:hover")).toEqual({});
    expect(rule(".linkButton:hover", ["@media (hover: hover)"])).toEqual({
      "text-decoration": "none",
    });
  });
});
