// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  declarationsFor,
  parseCss,
  resolveToken,
} from "../ToiletDetailsPanel/css.testutil";

const rules = parseCss(
  readFileSync(join(import.meta.dirname, "MapControlsPanel.module.css"), "utf8"),
);
const rule = (selector: string, at: string[] = []) => declarationsFor(rules, selector, at);

/**
 * A colour's value: through the bar's own custom properties, then the design system's tokens.
 */
const resolve = (value: string) => {
  const name = value.match(/^var\((--[\w-]+)\)$/)?.[1];
  const own = name ? rule(".floatingBar")[name] : undefined;
  return resolveToken(own ?? value);
};

describe("MapControlsPanel.module.css", () => {
  it("sets the bar's secondary text (Reset filters, the location error) at 14px or more", () => {
    expect(rule(".floatingBar")["--bar-text-small"]).toBe("max(0.875rem, var(--text--1))");
    for (const selector of [".resetBtn", ".geoError", ".searchStatus"]) {
      expect(rule(selector)["font-size"], selector).toBe("var(--bar-text-small)");
    }
  });

  it("gives the bar's secondary text at least 4.5:1 contrast on white", () => {
    for (const selector of [".resetBtn", ".geoError", ".searchStatus"]) {
      const color = resolve(rule(selector).color);
      expect(color, selector).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrastRatio(color, "#ffffff"), selector).toBeGreaterThanOrEqual(4.5);
    }
    // The design system's neutral grey (about 4:1) and accent pink colour only icons, which
    // need 3:1, never text.
    const ICONS = [".searchIcon", ".searchSpinner", ".suggestion > :global(.icon)"];
    const weakText = rules.filter(
      (r) =>
        ["var(--color-neutral-grey)", "var(--color-accent-pink)"].includes(r.declarations.color) &&
        !r.selectors.every((s) => ICONS.includes(s)),
    );
    expect(weakText).toEqual([]);
  });

  it("lets a suggestion's label take the room beside its icon (the icon never stretches)", () => {
    // The design system's Icon is a <span> too: a `.suggestion span` rule stretched it to half.
    expect(rules.filter((r) => r.selectors.includes(".suggestion span"))).toEqual([]);
    expect(rule(".suggestion > :global(.icon)").flex).toBe("0 0 auto");
    expect(rule(".suggestionLabel").flex).toBe("1 1 auto");
    expect(rule(".suggestionLabel")["min-width"]).toBe("0");
  });
});
