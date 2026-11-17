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

  it("pins the compact header (name, status, Details, X) in the expanded sheet, except on short screens", () => {
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
    expect(rule(".sheet .details").padding).toMatch(/^var\(--panel-section-gap\) \S.* 0 /);
    expect(rule(".panel.sheet")["--bottom-sheet-padding-bottom"]).toBe("var(--space-s)");
  });

  it("keeps the sheet's content clear of the left and right safe areas", () => {
    for (const selector of [".sheet .summary", ".sheet .details", ".summaryExtras"]) {
      // top right bottom left
      expect(rule(selector).padding, selector).toMatch(
        /^\S+ calc\(var\(--space-s\) \+ var\(--safe-right, 0px\)\) \S+ calc\(var\(--space-s\) \+ var\(--safe-left, 0px\)\)$/,
      );
    }
  });

  it("uses a secondary text colour with at least 4.5:1 contrast on white", () => {
    const muted = rule(".panel")["--panel-muted"];
    expect(contrastRatio(muted, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    // The design system's neutral grey (#807f7f, about 4:1) isn't used for text.
    const greyText = rules.filter((r) => r.declarations.color === "var(--color-neutral-grey)");
    expect(greyText).toEqual([]);
    for (const selector of [".distance", ".sectionHeading"]) {
      expect(rule(selector).color, selector).toBe("var(--panel-muted)");
    }
    // The secondary lines share one rule (and so one colour).
    const secondary = rules.find((r) => r.selectors.includes(".freshness"));
    expect(secondary?.declarations.color).toBe("var(--panel-muted)");
  });

  describe("type scale", () => {
    const panel = rule(".panel");
    /** The rule (one, so they can't drift apart) that sets `selector`'s font size. */
    const sizeRule = (selector: string) =>
      rules.filter(
        (r) => r.at.length === 0 && r.selectors.includes(selector) && r.declarations["font-size"],
      );

    it("defines the panel's sizes from the design system's steps only", () => {
      expect(panel["--panel-text-body"]).toBe("min(1rem, var(--text-0))");
      expect(panel["--panel-text-small"]).toBe("max(0.875rem, var(--text--1))");
      expect(panel["--panel-text-heading"]).toBe("var(--panel-text-small)");
      // The panel's own text defaults to the body size.
      expect(panel["font-size"]).toBe("var(--panel-text-body)");
      expect(panel["line-height"]).toBe("var(--panel-leading-body)");
    });

    it("sets no font size outside the scale (name, body, heading, small)", () => {
      const allowed = new Set([
        "var(--text-1)",
        "var(--panel-text-body)",
        "var(--panel-text-heading)",
        "var(--panel-text-small)",
      ]);
      const sizes = rules.flatMap((r) =>
        r.declarations["font-size"] ? [[r.selectors.join(", "), r.declarations["font-size"]]] : [],
      );
      expect(sizes.length).toBeGreaterThan(0);
      for (const [selector, size] of sizes) expect(allowed, `${selector}: ${size}`).toContain(size);
      // Only the name uses the largest step.
      expect(sizes.filter(([, size]) => size === "var(--text-1)").map(([s]) => s)).toEqual([
        ".name",
      ]);
    });

    it("sets notes, hours, facilities, payment and the restore text in one body rule", () => {
      const body = [".notes", ".hoursSummary", ".hoursTable", ".facility", ".restoreText"];
      const [shared, ...others] = body.map((selector) => sizeRule(selector));
      expect(shared).toHaveLength(1);
      for (const other of others) expect(other).toEqual(shared);
      expect(shared[0].declarations["font-size"]).toBe("var(--panel-text-body)");
      expect(shared[0].declarations["line-height"]).toBe("var(--panel-leading-body)");
      // Payment is a facility row: it inherits the row's size.
      expect(rule(".payment")["font-size"]).toBeUndefined();
      // The notes keep the author's line breaks.
      expect(rule(".notes")["white-space"]).toBe("pre-line");
      // The restore textarea is body-sized too: 16px, so iOS doesn't zoom on focus.
      expect(rule(".restoreTextarea")["font-size"]).toBe("var(--panel-text-body)");
    });

    it("sets the secondary lines in one smaller, muted rule", () => {
      const small = [".muted", ".smallNote", ".unknownFacilities", ".freshness"];
      const [shared, ...others] = small.map((selector) => sizeRule(selector));
      expect(shared).toHaveLength(1);
      for (const other of others) expect(other).toEqual(shared);
      expect(shared[0].declarations).toMatchObject({
        "font-size": "var(--panel-text-small)",
        "line-height": "var(--panel-leading-small)",
        color: "var(--panel-muted)",
      });
      for (const selector of [".meta", ".notice", ".noticeSlot", ".verifyRow", ".textAction"]) {
        expect(rule(selector)["font-size"], selector).toBe("var(--panel-text-small)");
      }
    });

    it("gives every section heading one style, set apart from the body by more than weight", () => {
      const heading = rule(".sectionHeading");
      expect(heading).toMatchObject({
        "font-size": "var(--panel-text-heading)",
        "font-weight": "700",
        "text-transform": "uppercase",
        margin: "0 0 var(--panel-heading-gap)",
      });
      expect(heading["letter-spacing"]).toBeDefined();
      // No other rule restyles a heading's size.
      expect(
        rules.filter(
          (r) =>
            r.selectors.some((s) => s.includes("sectionHeading")) && r.declarations["font-size"],
        ),
      ).toHaveLength(1);
    });

    it("spaces the sections evenly with the design system's spacing steps", () => {
      expect(panel["--panel-section-gap"]).toMatch(/^var\(--space-[a-z0-9]+\)$/);
      expect(panel["--panel-heading-gap"]).toMatch(/^var\(--space-[a-z0-9]+\)$/);
      expect(rule(".details").gap).toBe("var(--panel-section-gap)");
      // The first section is as far from the edge above it as the sections are from each other.
      expect(rule(".details").padding).toMatch(/^var\(--panel-section-gap\) /);
      // Margins inside the details use spacing tokens, never one-off lengths.
      for (const selector of [
        ".smallNote",
        ".unknownFacilities",
        ".freshness",
        ".secondaryActions",
      ]) {
        const d = rule(selector);
        const spacing = [d.margin, d["margin-top"], d["margin-bottom"]].filter(Boolean).join(" ");
        expect(spacing.replace(/var\(--space-[a-z0-9]+\)|\b0\b/g, "").trim(), selector).toBe("");
      }
    });
  });

  describe("the expanded sheet's compact header", () => {
    it("caps the sheet at 70% of the map, leaving room above it for the search bar and marker", () => {
      expect(rule(".panel.sheet")["--bottom-sheet-max-height"]).toBe("min(70%, 100% - 10rem)");
    });

    it("clamps the name to three lines and keeps distance and open now on one", () => {
      expect(rule(".compactHeader .name")).toMatchObject({
        "-webkit-line-clamp": "3",
        "line-clamp": "3",
        overflow: "hidden",
      });
      expect(rule(".compactHeader .meta")["flex-wrap"]).toBe("nowrap");
      expect(rule(".compactHeader .statusChip")["text-overflow"]).toBe("ellipsis");
    });

    it("keeps its buttons' touch targets at --tap-min while drawing them smaller", () => {
      expect(rule(".compactHeader .iconButton").width).toBe("2.25rem");
      expect(rule(".compactHeader .iconButton::before").inset).toBe(
        "calc((2.25rem - max(2.25rem, var(--tap-min, 44px))) / 2)",
      );
      expect(rule(".iconButton").position).toBe("relative");
      // Pushed clear of the handle by that extra area, so the handle never takes their taps.
      expect(rule('.sheet[data-state="expanded"] .compactHeader')["padding-top"]).toBe(
        "var(--space-3xs)",
      );
    });
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
