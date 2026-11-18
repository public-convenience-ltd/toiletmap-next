// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { declarationsFor, parseCss } from "../Button/css.testutil";

/** What Prose.css says, rule by rule (layout is about the rules, not the source formatting). */
const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8");
const source = read("Prose.css");
const rules = parseCss(source);
const tokens = declarationsFor(parseCss(read("../../tokens.css")), ":root");

describe("Prose.css", () => {
  it("keeps a readable measure of about 70 characters", () => {
    const prose = declarationsFor(rules, ".prose");
    expect(prose["--prose-measure"]).toBe("70ch");
    expect(prose["max-inline-size"]).toBe("var(--prose-measure)");
    expect(prose["line-height"]).toBe("1.6");
  });

  it("only uses design tokens that exist", () => {
    const used = [...source.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((match) => match[1]);
    const own = new Set(["--prose-measure", "--prose-flow"]);
    for (const name of used) {
      if (own.has(name)) continue;
      expect(tokens[name], name).toBeDefined();
    }
  });

  it("uses no raw colours: every colour comes from a token", () => {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it("styles every long-form element it promises", () => {
    const selectors = rules.flatMap((rule) => rule.selectors).join("\n");
    for (const element of [
      "h2",
      "ul",
      "ol",
      "a:not(.button)",
      "blockquote",
      "table",
      "img",
      "pre",
    ]) {
      expect(selectors, element).toContain(element);
    }
  });

  it("underlines links (inline links need more than colour)", () => {
    const link = declarationsFor(rules, ".prose :where(a:not(.button))");
    expect(link["text-decoration-line"]).toBe("underline");
  });

  it("keeps wide tables and images inside the column", () => {
    const table = declarationsFor(rules, ".prose :where(table)");
    expect(table["overflow-x"]).toBe("auto");
    expect(table["max-inline-size"]).toBe("100%");
    expect(declarationsFor(rules, ".prose :where(img, video, iframe)")["max-inline-size"]).toBe(
      "100%",
    );
    expect(declarationsFor(rules, ".prose :where(pre)")["overflow-x"]).toBe("auto");
  });

  it("tightens the spacing on phones", () => {
    expect(declarationsFor(rules, ".prose", ["@media (max-width: 479.98px)"])).toEqual({
      "--prose-flow": "var(--space-xs)",
    });
  });

  it("is part of the stylesheet", () => {
    expect(read("../../stylesheet.css")).toContain('@import "./components/Prose/Prose.css";');
  });
});
