// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, declarationsFor, parseCss } from "../Button/css.testutil";

const rules = parseCss(readFileSync(join(import.meta.dirname, "BottomSheet.css"), "utf8"));
const rule = (selector: string, at: string[] = []) => declarationsFor(rules, selector, at);
const tokens = declarationsFor(
  parseCss(readFileSync(join(import.meta.dirname, "../../tokens.css"), "utf8")),
  ":root",
);
/** A colour as drawn: tokens (var(--x)) resolved to their hex value. */
const resolve = (value: string): string => {
  const name = value.match(/^var\((--[\w-]+)\)$/)?.[1];
  return name ? resolve(tokens[name]) : value;
};

describe("BottomSheet.css", () => {
  it("draws the handle as a 20px band, with a --tap-min hit area reaching up over the map", () => {
    expect(rule(".bottom-sheet__handle")).toMatchObject({
      position: "relative",
      height: "20px",
      "box-sizing": "border-box",
    });
    // 20px band + (tap-min − 20px) above it = tap-min; nothing below, over the content.
    expect(rule(".bottom-sheet__handle::before")).toMatchObject({
      content: '""',
      position: "absolute",
      inset: "calc(20px - var(--tap-min, 44px)) 0 0",
    });
    // The band itself no longer grows to 44px on touch screens.
    const grown = rules.filter(
      (r) => r.selectors.includes(".bottom-sheet__handle") && r.at.length > 0,
    );
    expect(grown).toEqual([]);
  });

  it("draws the grip solid, at 3:1 or more against the white sheet", () => {
    const grip = rule(".bottom-sheet__grip");
    // Opacity would fade it below 3:1 (0.6 of neutral grey is about 2:1).
    expect(grip.opacity).toBeUndefined();
    const color = resolve(grip.background);
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrastRatio(color, resolve(rule(".bottom-sheet").background))).toBeGreaterThanOrEqual(
      3,
    );
  });

  it("pads the body by the larger of its padding and the safe area, not their sum", () => {
    expect(rule(".bottom-sheet__body")["padding-bottom"]).toBe(
      "max(var(--bottom-sheet-padding-bottom, var(--space-s, 1rem)), var(--safe-bottom, env(safe-area-inset-bottom, 0px)))",
    );
  });
});
