// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { knownInlineScriptHashes, knownInlineScripts } from "./inlineScripts";
import { inlineScripts, scriptHash } from "./securityHeaders";
import { SHARE_BUTTON_SCRIPT } from "./shareButtonScript";

/**
 * The CSP allows exactly the inline scripts the site ships. The build's own check (every
 * prerendered page's inline scripts are among them) runs in src/integrations/securityHeaders.ts.
 */
const astroRuntime = resolve(import.meta.dirname, "../../node_modules/astro/dist/runtime");

describe("knownInlineScripts", () => {
  it("are Astro's island loaders and every client directive, plus the Share button", () => {
    const scripts = knownInlineScripts();
    expect(scripts).toHaveLength(8);
    expect(scripts).toContain(SHARE_BUTTON_SCRIPT);
    for (const directive of ["idle", "load", "media", "only", "visible"]) {
      expect(scripts.some((script) => script.includes(`.${directive}=`))).toBe(true);
    }
    expect(scripts.some((script) => script.includes("astro-island"))).toBe(true);
  });

  it("include both builds of the island loader (astro dev under workerd uses the production one)", () => {
    const loaders = knownInlineScripts().filter((script) => script.includes("astro-island"));
    expect(loaders).toHaveLength(2);
    expect(loaders[0]).not.toBe(loaders[1]);
  });

  it("match the text Astro writes into pages", () => {
    // The prebuilt files Astro's renderer (runtime/server/scripts.js) inlines.
    const load = readFileSync(resolve(astroRuntime, "client/load.prebuilt.js"), "utf8");
    const text = load.match(/export default `([\s\S]*)`;/)?.[1]?.replace(/\\`/g, "`");
    expect(knownInlineScripts()).toContain(text);
  });
});

describe("knownInlineScriptHashes", () => {
  it("hashes each known script once, sorted, and caches the result", async () => {
    const hashes = await knownInlineScriptHashes();
    expect(hashes).toHaveLength(8);
    expect(hashes).toEqual([...hashes].sort());
    expect(hashes).toContain(await scriptHash(SHARE_BUTTON_SCRIPT));
    expect(await knownInlineScriptHashes()).toBe(hashes);
  });

  it("allow the Share button as the blog post page renders it", async () => {
    const page = `<p>post</p><script>${SHARE_BUTTON_SCRIPT}</script>`;
    const [script] = inlineScripts(page);
    expect(await knownInlineScriptHashes()).toContain(await scriptHash(script ?? ""));
  });

  it("never include an arbitrary script", async () => {
    expect(await knownInlineScriptHashes()).not.toContain(
      await scriptHash("alert(document.cookie)"),
    );
  });
});
