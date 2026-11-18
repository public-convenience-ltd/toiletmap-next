// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { declarationsFor, parseCss } from "../ToiletDetailsPanel/css.testutil";

const rules = parseCss(readFileSync(join(import.meta.dirname, "LooForm.module.css"), "utf8"));
const rule = (selector: string, at: string[] = []) => declarationsFor(rules, selector, at);

const MOTION_OK = "@media (prefers-reduced-motion: no-preference)";

describe("LooForm.module.css action bar", () => {
  it("pads the same above and below the buttons, growing into the safe area, not adding it", () => {
    expect(rule(".actionBar").padding).toBe(
      "var(--space-2xs) var(--space-m) max(var(--space-2xs), var(--safe-bottom))",
    );
  });

  it("hides the bar (not only moves it) while the keyboard is up, after it has slid away", () => {
    const hidden = rule(".actionBarHidden");
    expect(hidden.visibility).toBe("hidden");
    expect(hidden.transform).toMatch(/^translateY\(/);
    // Slides down, then hides; shows at once when coming back.
    expect(rule(".actionBarHidden", [MOTION_OK]).transition).toMatch(/visibility 0s linear 0\.2s/);
    expect(rule(".actionBar", [MOTION_OK]).transition).toMatch(/visibility 0s linear 0s/);
    // No transition at all with reduced motion.
    expect(rule(".actionBar").transition).toBeUndefined();
    expect(rule(".actionBarHidden").transition).toBeUndefined();
  });

  it("gives Cancel the design system's tap size", () => {
    const cancel = rule(".cancelButton");
    expect(cancel["min-height"]).toBe("var(--tap-min, 36px)");
    expect(cancel["min-width"]).toBe("var(--tap-min, 36px)");
  });

  it("only changes Cancel on hover where hovering is possible", () => {
    const hovers = rules.filter((r) =>
      r.selectors.some((s) => s.startsWith(".cancelButton:hover")),
    );
    expect(hovers.length).toBeGreaterThan(0);
    for (const r of hovers) expect(r.at).toEqual(["@media (hover: hover)"]);
  });
});
