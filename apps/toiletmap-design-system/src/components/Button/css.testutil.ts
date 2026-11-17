/**
 * A small CSS reader for tests: the style rules of a stylesheet with their at-rule context and
 * declarations, so tests can check what a rule says rather than how its source is formatted.
 */

export interface CssRule {
  /** Enclosing at-rule preludes, outermost first (whitespace collapsed), e.g. "@media (hover: hover)". */
  at: string[];
  selectors: string[];
  declarations: Record<string, string>;
}

const collapse = (text: string) =>
  text.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();

/** Splits on `separator` outside parentheses. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map(collapse).filter(Boolean);
}

export function parseCss(source: string): CssRule[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  const walk = (from: number, to: number, at: string[]) => {
    let i = from;
    while (i < to) {
      const open = css.indexOf("{", i);
      if (open < 0 || open >= to) return;
      let depth = 0;
      let close = open;
      for (; close < to; close++) {
        if (css[close] === "{") depth++;
        else if (css[close] === "}" && --depth === 0) break;
      }
      const prelude = collapse(css.slice(i, open));
      if (prelude.startsWith("@")) {
        walk(open + 1, close, [...at, prelude]);
      } else {
        const declarations: Record<string, string> = {};
        for (const declaration of splitTopLevel(css.slice(open + 1, close), ";")) {
          const colon = declaration.indexOf(":");
          if (colon > 0) {
            declarations[collapse(declaration.slice(0, colon))] = collapse(
              declaration.slice(colon + 1),
            );
          }
        }
        rules.push({ at, selectors: splitTopLevel(prelude, ","), declarations });
      }
      i = close + 1;
    }
  };
  walk(0, css.length, []);
  return rules;
}

/**
 * The declarations for `selector` in the given at-rule context (top level by default), merged
 * in source order.
 */
export function declarationsFor(
  rules: CssRule[],
  selector: string,
  at: string[] = [],
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const rule of rules) {
    if (rule.at.join(" | ") !== at.join(" | ")) continue;
    if (!rule.selectors.includes(selector)) continue;
    Object.assign(merged, rule.declarations);
  }
  return merged;
}

/** WCAG contrast ratio between two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
