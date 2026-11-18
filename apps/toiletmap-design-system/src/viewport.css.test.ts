// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const tokens = read("./tokens.css");
const stylesheet = read("./stylesheet.css");

/** The body of the first `@media <query> {…}` (or `@supports`) block. */
const block = (css: string, prelude: string): string => {
  const start = css.indexOf(prelude);
  if (start < 0) return "";
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  return "";
};

describe("viewport custom properties (tokens.css)", () => {
  it.each(["top", "right", "bottom", "left"])(
    "defines --safe-%s from the safe-area inset",
    (side) => {
      expect(tokens).toContain(`--safe-${side}: env(safe-area-inset-${side}, 0px);`);
    },
  );

  it("uses 100dvh for --app-height where supported, 100vh otherwise", () => {
    expect(tokens).toMatch(/--app-height: 100vh;/);
    expect(block(tokens, "@supports (height: 100dvh)")).toMatch(/--app-height: 100dvh;/);
  });

  it("sets --tap-min to 44px on touch screens and 36px otherwise", () => {
    expect(tokens).toMatch(/--tap-min: 36px;/);
    expect(block(tokens, "@media (pointer: coarse)")).toMatch(/--tap-min: 44px;/);
  });
});

describe("global reset (stylesheet.css)", () => {
  it("uses border-box sizing everywhere", () => {
    expect(stylesheet).toMatch(/\*,\s*\*::before,\s*\*::after \{\s*box-sizing: border-box;\s*\}/);
  });

  it("makes form controls inherit the page font", () => {
    expect(stylesheet).toMatch(/button,\s*input,\s*select,\s*textarea \{\s*font: inherit;\s*\}/);
  });

  it("keeps text fields at 16px or more on touch screens (no iOS focus zoom)", () => {
    const coarse = block(stylesheet, "@media (pointer: coarse)");
    expect(coarse).toMatch(/select,\s*textarea \{\s*font-size: max\(16px, 1em\);/);
    // After the reset, so it wins over `font: inherit` at the same specificity.
    expect(stylesheet.indexOf("@media (pointer: coarse)")).toBeGreaterThan(
      stylesheet.indexOf("font: inherit"),
    );
  });
});

describe.each([
  ["./components/Button/Button.css", ".button"],
  ["./components/IconButton/IconButton.css", ".icon-button"],
])("%s", (path, selector) => {
  it(`gives ${selector} a --tap-min target on touch screens`, () => {
    const coarse = block(read(path), "@media (pointer: coarse)");
    expect(coarse).toContain(`${selector} {`);
    expect(coarse).toMatch(/min-height: var\(--tap-min\);/);
    expect(coarse).toMatch(/min-width: var\(--tap-min\);/);
  });
});

describe("Drawer.css", () => {
  const drawer = read("./components/Drawer/Drawer.css");

  it("sizes against the real header and the visible viewport, not 60px / 100vh", () => {
    expect(drawer).not.toMatch(/60px/);
    expect(drawer).not.toMatch(/100vh\)?;/);
    expect(drawer).toMatch(/var\(--header-height/);
    expect(drawer).toMatch(/height: calc\(var\(--app-height/);
  });

  it("stops animating for prefers-reduced-motion", () => {
    expect(block(drawer, "@media (prefers-reduced-motion: reduce)")).toMatch(/transition: none;/);
  });
});

describe("Sheet.css", () => {
  it("uses --app-height for full-height sheets", () => {
    const sheet = read("./components/Sheet/Sheet.css");
    expect(sheet).not.toMatch(/height: 100dvh;/);
    expect(sheet).toMatch(/height: var\(--app-height/);
  });
});
