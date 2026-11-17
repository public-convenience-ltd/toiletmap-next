// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./OpeningHoursInput.css", import.meta.url), "utf8");

/** The body of the first `@container (max-width: …)` block. */
const narrowBlock = (): string => {
  const start = css.search(/@container \(max-width: [^)]+\) \{/);
  if (start < 0) return "";
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  return "";
};

const rule = (block: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return block.match(new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`))?.[1] ?? "";
};

describe("OpeningHoursInput.css", () => {
  it("lays the rows out by the editor's own width, not the viewport's", () => {
    expect(rule(css, ".oh-input")).toMatch(/container-type: inline-size/);
    expect(css).not.toMatch(/@media \([^)]*width/);
    expect(narrowBlock()).not.toBe("");
  });

  it("stacks the day, a full-width status control and the times when narrow", () => {
    const block = narrowBlock();
    expect(rule(block, ".oh-row")).toMatch(/grid-template-columns: minmax\(0, 1fr\);/);
    expect(rule(block, ".oh-status")).toMatch(/width: 100%/);
    expect(rule(block, ".oh-status .oh-toggle-option")).toMatch(/flex: 1 1 0/);
  });
});
