// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { declarationsFor, parseCss } from "./css.testutil";

const rules = parseCss(readFileSync(join(import.meta.dirname, "Button.css"), "utf8"));
const selectors = rules.flatMap((rule) => rule.selectors.map((selector) => ({ selector, rule })));

describe("Button.css", () => {
  it("fills the button on keyboard focus only (:focus-visible), not after a tap or click", () => {
    const focus = selectors.filter(({ selector }) => /:focus(?!-visible)/.test(selector));
    expect(focus.map(({ selector }) => selector)).toEqual([]);
    expect(declarationsFor(rules, ".button:not(:disabled):focus-visible")).toMatchObject({
      color: "var(--color-turquoise)",
      "background-color": "var(--color-blue)",
    });
    expect(declarationsFor(rules, ".button--secondary:not(:disabled):focus-visible")).toEqual({
      color: "var(--color-white)",
    });
  });

  it("applies hover only where the device can hover, so it doesn't stick on touch", () => {
    const hovers = selectors.filter(({ selector }) => selector.includes(":hover"));
    expect(hovers.length).toBeGreaterThan(0);
    for (const { selector, rule } of hovers) {
      expect(rule.at, selector).toEqual(["@media (hover: hover)"]);
    }
    expect(
      declarationsFor(rules, ".button:not(:disabled):hover", ["@media (hover: hover)"]),
    ).toMatchObject({ "background-color": "var(--color-blue)" });
  });

  it("keeps the 44px touch size", () => {
    expect(declarationsFor(rules, ".button", ["@media (pointer: coarse)"])).toMatchObject({
      "min-height": "var(--tap-min)",
      "min-width": "var(--tap-min)",
    });
  });
});
