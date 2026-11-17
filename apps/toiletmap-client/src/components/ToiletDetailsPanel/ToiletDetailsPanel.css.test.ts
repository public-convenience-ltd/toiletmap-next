// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, declarationsFor, parseCss } from "./css.testutil";

const rules = parseCss(
  readFileSync(join(import.meta.dirname, "ToiletDetailsPanel.module.css"), "utf8"),
);
const rule = (selector: string, at: string[] = []) => declarationsFor(rules, selector, at);

const SHORT_LANDSCAPE = "@media (min-width: 768px) and (max-height: 560px)";

describe("ToiletDetailsPanel.module.css", () => {
  it("lets the card scroll as a whole on a short (landscape phone) screen", () => {
    const card = rule(".panel.card", [SHORT_LANDSCAPE]);
    expect(card["overflow-y"]).toBe("auto");
    const body = rule(".panel.card .cardBody", [SHORT_LANDSCAPE]);
    expect(body.overflow).toBe("visible");
    expect(body.flex).toBe("none");
    // The footer below the map pads the safe area from 768px: the card doesn't again.
    expect(rule(".panel.card")["max-height"]).not.toContain("--safe-bottom");
    // On a tall screen the summary stays put above its own scroller.
    expect(rule(".panel.card").overflow).toBe("hidden");
    expect(rule(".cardBody")["overflow-y"]).toBe("auto");
  });

  it("pins the summary (name, X, Directions) in the expanded sheet, except on short screens", () => {
    const sticky = rule('.sheet[data-state="expanded"] .summary');
    expect(sticky.position).toBe("sticky");
    expect(sticky.top).toBe("0");
    expect(sticky.background).toBe("var(--color-base-white)");
    expect(rule('.sheet[data-state="expanded"] .summary', ["@media (max-height: 560px)"])).toEqual({
      position: "static",
    });
  });

  it("keeps focused elements clear of the pinned summary (scroll padding by its height)", () => {
    expect(rule('.sheet[data-state="expanded"] :global(.bottom-sheet__body)')).toEqual({
      "scroll-padding-top": "var(--panel-summary-height, 0px)",
    });
    // Where the summary isn't pinned (short screens), there's nothing to clear.
    expect(
      rule('.sheet[data-state="expanded"] :global(.bottom-sheet__body)', [
        "@media (max-height: 560px)",
      ]),
    ).toEqual({ "scroll-padding-top": "0" });
  });

  it("leaves the sheet's bottom padding to the sheet (no doubled padding at peek)", () => {
    expect(rule(".sheet .summary").padding).toMatch(/^0 \S.* 0 /);
    expect(rule(".sheet .details").padding).toMatch(/^var\(--space-xs\) \S.* 0 /);
    expect(rule(".panel.sheet")["--bottom-sheet-padding-bottom"]).toBe("var(--space-s)");
  });

  it("keeps the sheet's content clear of the left and right safe areas", () => {
    for (const selector of [".sheet .summary", ".sheet .details"]) {
      // top right bottom left
      expect(rule(selector).padding, selector).toMatch(
        /^\S+ calc\(var\(--space-s\) \+ var\(--safe-right, 0px\)\) 0 calc\(var\(--space-s\) \+ var\(--safe-left, 0px\)\)$/,
      );
    }
  });

  it("uses a secondary text colour with at least 4.5:1 contrast on white", () => {
    const muted = rule(".panel")["--panel-muted"];
    expect(contrastRatio(muted, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    // The design system's neutral grey (#807f7f, about 4:1) isn't used for text.
    const greyText = rules.filter((r) => r.declarations.color === "var(--color-neutral-grey)");
    expect(greyText).toEqual([]);
    for (const selector of [".distance", ".muted", ".freshness", ".smallNote"]) {
      expect(rule(selector).color, selector).toBe("var(--panel-muted)");
    }
  });

  it("never sets text below 14px, and sets body text (hours, notes) at --text-0", () => {
    expect(rule(".panel")["--panel-text-small"]).toBe("max(0.875rem, var(--text--1))");
    const sizes = rules.flatMap((r) =>
      r.declarations["font-size"] ? [[r.selectors.join(", "), r.declarations["font-size"]]] : [],
    );
    for (const [selector, size] of sizes) {
      expect(size, selector).not.toMatch(/^var\(--text--[12]\)$/);
    }
    expect(rule(".notes")["font-size"]).toBe("var(--text-0)");
    expect(rule(".hoursTable")["font-size"]).toBe("var(--text-0)");
    expect(rule(".hoursSummary")["font-size"]).toBe("var(--text-0)");
  });

  it("lays facilities out as one-line icon rows, two columns from about 340px", () => {
    expect(rule(".facilities")["grid-template-columns"]).toBe(
      "repeat(auto-fill, minmax(9.5rem, 1fr))",
    );
    expect(rule(".facilityLabel")["white-space"]).toBe("nowrap");
  });

  it("gives the secondary actions a full touch height", () => {
    expect(rule(".textAction")["min-height"]).toBe("var(--tap-min, 36px)");
    expect(rule(".textAction")["white-space"]).toBe("nowrap");
  });

  it("only applies hover styles where hovering is possible", () => {
    const hovers = rules.filter((r) => r.selectors.some((s) => s.includes(":hover")));
    expect(hovers.length).toBeGreaterThan(0);
    for (const r of hovers) expect(r.at, r.selectors.join(", ")).toEqual(["@media (hover: hover)"]);
  });
});
