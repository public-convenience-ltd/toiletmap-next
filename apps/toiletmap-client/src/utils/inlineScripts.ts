/**
 * Every inline script the site itself ships, and their CSP hashes.
 *
 * The site's script-src allows exactly these hashes (plus same-origin files), everywhere:
 * worker-rendered pages (src/middleware.ts) and static ones (the generated _headers). A
 * response's own content is never hashed, so a `<script>` injected into a page (through a
 * template or sanitisation bug, or raw HTML in a Markdown post) is not allowed by the policy.
 * The build fails if a prerendered page contains an inline script that isn't listed here
 * (src/integrations/securityHeaders.ts), and e2e/csp.spec.ts catches one on a
 * worker-rendered page. See docs/security.md.
 *
 * The scripts:
 * - Astro's island loader and its client directive scripts (`client:load`, `client:only`,
 *   ...), which Astro writes inline before the first island that needs each. Taken from
 *   Astro itself, so an upgrade that changes them changes the hashes too. Astro picks the
 *   development build of the island loader when NODE_ENV is "development", which depends on
 *   the runtime (`astro dev` under workerd uses the production one), so both are allowed.
 * - The blog post's Share button script (src/utils/shareButtonScript.ts).
 */

// astro 7.4.9 and later no longer ship these prebuilt files, so package.json pins astro to
// 7.4.7 exactly (and renovate.json holds it below 7.4.9) until this module is ported.
import idleDirective from "astro/runtime/client/idle.prebuilt.js";
import loadDirective from "astro/runtime/client/load.prebuilt.js";
import mediaDirective from "astro/runtime/client/media.prebuilt.js";
import onlyDirective from "astro/runtime/client/only.prebuilt.js";
import visibleDirective from "astro/runtime/client/visible.prebuilt.js";
import islandLoader from "astro/runtime/server/astro-island.prebuilt.js";
import islandLoaderDev from "astro/runtime/server/astro-island.prebuilt-dev.js";
import { scriptHash } from "./securityHeaders";
import { SHARE_BUTTON_SCRIPT } from "./shareButtonScript";

/** The text of every inline script the site ships. */
export function knownInlineScripts(): string[] {
  return [
    islandLoader,
    islandLoaderDev,
    idleDirective,
    loadDirective,
    mediaDirective,
    onlyDirective,
    visibleDirective,
    SHARE_BUTTON_SCRIPT,
  ];
}

let cached: Promise<string[]> | undefined;

/** `'sha256-…'` sources for {@link knownInlineScripts} (deduplicated, sorted; computed once). */
export function knownInlineScriptHashes(): Promise<string[]> {
  cached ??= Promise.all(knownInlineScripts().map(scriptHash)).then((list) =>
    [...new Set(list)].sort(),
  );
  return cached;
}
