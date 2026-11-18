// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, declarationsFor, parseCss } from "./components/Button/css.testutil";

/**
 * The status tokens and the CSS of Notice, Toast and ConfirmDialog: contrast is checked from
 * the token values, layout rules from what the stylesheets say.
 */
const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8");
const tokens = declarationsFor(parseCss(read("tokens.css")), ":root");

/** A token's value as #rrggbb, following var() references to other tokens. */
const hex = (name: string): string => {
  let value = tokens[name];
  for (let i = 0; i < 5 && value?.startsWith("var("); i++) {
    value = tokens[value.slice(4, -1).trim()];
  }
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} is not a hex colour`);
  return value;
};

const WHITE = "#ffffff";
const TONES = ["info", "success", "warning", "error"] as const;

describe("status colour tokens", () => {
  it.each(TONES)("%s: body text and icon are AA on the background", (tone) => {
    const bg = hex(`--color-${tone}-bg`);
    expect(contrastRatio(hex("--color-text"), bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(hex(`--color-${tone}-icon`), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(TONES)("%s: the border is at least 3:1 against its background and white", (tone) => {
    const border = hex(`--color-${tone}-border`);
    expect(contrastRatio(border, hex(`--color-${tone}-bg`))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(border, WHITE)).toBeGreaterThanOrEqual(3);
  });

  it("muted and error text are AA on white and on light grey", () => {
    for (const name of ["--color-text-muted", "--color-text-error"]) {
      expect(contrastRatio(hex(name), WHITE), name).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(hex(name), hex("--color-light-grey")), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("white text is AA on a destructive button, resting and hovered", () => {
    expect(contrastRatio(WHITE, hex("--color-destructive"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(WHITE, hex("--color-destructive-hover"))).toBeGreaterThanOrEqual(4.5);
  });

  it("has radius, elevation and stacking tokens", () => {
    for (const name of [
      "--radius-sm",
      "--radius-md",
      "--radius-lg",
      "--radius-pill",
      "--shadow-1",
      "--shadow-2",
      "--shadow-3",
      "--z-toast",
      "--z-dialog",
    ]) {
      expect(tokens[name], name).toBeTruthy();
    }
    // A toast can't be clicked through a dialog's backdrop.
    expect(Number(tokens["--z-toast"])).toBeLessThan(Number(tokens["--z-dialog"]));
    expect(Number(tokens["--z-toast"])).toBeGreaterThan(Number(tokens["--z-sheet"]));
  });
});

describe("Notice.css", () => {
  const rules = parseCss(read("components/Notice/Notice.css"));

  it.each(TONES)("the %s tone uses its own tokens", (tone) => {
    expect(declarationsFor(rules, `.notice--${tone}`)).toEqual({
      "--notice-bg": `var(--color-${tone}-bg)`,
      "--notice-border": `var(--color-${tone}-border)`,
      "--notice-icon": `var(--color-${tone}-icon)`,
    });
  });

  it("lines the icon up with the first line in both sizes (not the middle of a multi-line notice)", () => {
    expect(declarationsFor(rules, ".notice")["align-items"]).toBe("flex-start");
    // Compact notices (and every toast) don't override it.
    expect(declarationsFor(rules, ".notice--compact")["align-items"]).toBeUndefined();
    expect(declarationsFor(rules, ".notice__icon")["padding-block-start"]).toBe("0.2em");
    expect(declarationsFor(rules, ".notice--compact .notice__icon")["padding-block-start"]).toBe(
      "0.2em",
    );
  });

  it("takes its radius from the tokens and its dismiss button is tap-sized", () => {
    expect(declarationsFor(rules, ".notice")["border-radius"]).toBe("var(--radius-md)");
    expect(declarationsFor(rules, ".notice__dismiss")).toMatchObject({
      "min-width": "var(--tap-min)",
      "min-height": "var(--tap-min)",
    });
  });
});

describe("Toast.css", () => {
  const rules = parseCss(read("components/Toast/Toast.css"));

  it("clears the safe-area insets and the offset", () => {
    expect(declarationsFor(rules, ".toast-region--bottom").bottom).toBe(
      "calc(var(--toast-offset, 0px) + var(--safe-bottom) + var(--space-s))",
    );
    expect(declarationsFor(rules, ".toast-region")).toMatchObject({
      left: "calc(var(--safe-left) + var(--space-s))",
      right: "calc(var(--safe-right) + var(--space-s))",
      "z-index": "var(--z-toast)",
      "pointer-events": "none",
    });
    expect(declarationsFor(rules, ".toast-region__item")["pointer-events"]).toBe("auto");
  });

  it("doesn't animate under reduced motion", () => {
    expect(
      declarationsFor(rules, ".toast-region__item", ["@media (prefers-reduced-motion: reduce)"]),
    ).toEqual({ animation: "none" });
  });
});

describe("ConfirmDialog.css", () => {
  const rules = parseCss(read("components/ConfirmDialog/ConfirmDialog.css"));
  const sheetQuery = ["@media (max-width: 47.99em), (pointer: coarse) and (max-width: 64em)"];

  it("is centred on wide screens and a bottom sheet on narrow or touch screens", () => {
    expect(declarationsFor(rules, ".confirm-dialog")).toMatchObject({
      position: "fixed",
      "align-items": "center",
      "z-index": "var(--z-dialog)",
    });
    expect(declarationsFor(rules, ".confirm-dialog", sheetQuery)["align-items"]).toBe("flex-end");
    expect(declarationsFor(rules, ".confirm-dialog__panel", sheetQuery)["border-radius"]).toBe(
      "var(--radius-lg) var(--radius-lg) 0 0",
    );
    expect(declarationsFor(rules, ".confirm-dialog__panel", sheetQuery).padding).toContain(
      "var(--safe-bottom)",
    );
  });

  it("puts the primary on the right on wide screens and on top when stacked", () => {
    expect(declarationsFor(rules, ".confirm-dialog__actions")["flex-direction"]).toBe(
      "row-reverse",
    );
    expect(declarationsFor(rules, ".confirm-dialog__actions", sheetQuery)["flex-direction"]).toBe(
      "column",
    );
  });

  it("doesn't animate under reduced motion", () => {
    expect(
      declarationsFor(rules, ".confirm-dialog__panel", ["@media (prefers-reduced-motion: reduce)"]),
    ).toEqual({ animation: "none" });
  });
});

describe("Button.css destructive variant", () => {
  const rules = parseCss(read("components/Button/Button.css"));

  it("is white on red and stays red on hover and keyboard focus", () => {
    expect(declarationsFor(rules, ".button--destructive")).toMatchObject({
      color: "var(--color-white)",
      "background-color": "var(--color-destructive)",
    });
    expect(
      declarationsFor(rules, ".button--destructive:not(:disabled):focus-visible")[
        "background-color"
      ],
    ).toBe("var(--color-destructive-hover)");
    expect(
      declarationsFor(rules, ".button--destructive:not(:disabled):hover", [
        "@media (hover: hover)",
      ])["background-color"],
    ).toBe("var(--color-destructive-hover)");
  });
});

describe("shared focus ring", () => {
  it("is one token, used by buttons, icon buttons (dismiss, close), notices and dialog titles", () => {
    expect(tokens["--focus-ring"]).toBe("2px solid var(--focus-ring-color)");
    expect(tokens["--focus-ring-offset"]).toBe("2px");
    const ring = { outline: "var(--focus-ring)", "outline-offset": "var(--focus-ring-offset)" };
    const check = (file: string, selector: string) =>
      expect(declarationsFor(parseCss(read(file)), selector), selector).toMatchObject(ring);
    check("components/Button/Button.css", ".button:not(:disabled):focus-visible");
    check("components/IconButton/IconButton.css", ".icon-button:focus-visible");
    check("components/Notice/Notice.css", ".notice:focus-visible");
    check("components/ConfirmDialog/ConfirmDialog.css", ".confirm-dialog__title:focus-visible");
  });
});

describe("sheets and drawers", () => {
  it("take their backdrop, radius, elevation and stacking from the tokens, as ConfirmDialog does", () => {
    const sheet = parseCss(read("components/Sheet/Sheet.css"));
    expect(declarationsFor(sheet, ".sheet__overlay").background).toBe("var(--color-backdrop)");
    expect(declarationsFor(sheet, ".sheet--bottom")).toMatchObject({
      "border-radius": "var(--radius-lg) var(--radius-lg) 0 0",
      "box-shadow": "var(--shadow-sheet)",
    });
    const bottomSheet = parseCss(read("components/BottomSheet/BottomSheet.css"));
    expect(declarationsFor(bottomSheet, ".bottom-sheet")).toMatchObject({
      "z-index": "var(--z-sheet)",
      "border-radius": "var(--radius-lg) var(--radius-lg) 0 0",
      "box-shadow": "var(--shadow-sheet)",
    });
    const drawer = parseCss(read("components/Drawer/Drawer.css"));
    expect(declarationsFor(drawer, ".drawer")["z-index"]).toBe("var(--z-drawer)");
    // No hard-coded colours left in them.
    for (const file of [
      "components/Sheet/Sheet.css",
      "components/BottomSheet/BottomSheet.css",
      "components/Drawer/Drawer.css",
    ]) {
      expect(read(file), file).not.toMatch(/rgba?\(/);
    }
  });
});

describe("Badge.css", () => {
  const rules = parseCss(read("components/Badge/Badge.css"));

  it("is a pill in the shared status tones", () => {
    expect(declarationsFor(rules, ".badge")["border-radius"]).toBe("var(--radius-pill)");
    for (const tone of TONES) {
      expect(declarationsFor(rules, `.badge--${tone}`)).toEqual({
        "--badge-bg": `var(--color-${tone}-bg)`,
        "--badge-border": `var(--color-${tone}-border)`,
      });
    }
  });
});
