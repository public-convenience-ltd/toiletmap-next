/**
 * Build step: writes the security headers for static assets into dist/client/_headers
 * (src/utils/staticSecurityHeaders.ts), so /about, /posts, /cms and the rest get the same
 * headers as the pages the worker renders (src/middleware.ts).
 *
 * script-src allows the site's own inline scripts (src/utils/inlineScripts.ts), as the
 * worker's policy does. The build fails if a prerendered page has an inline script that
 * isn't one of them (raw HTML in a Markdown post, say): the policy would block it, and
 * allowing it would allow it on every static page.
 *
 * HSTS is only added to production builds (`CLOUDFLARE_ENV=production`, i.e.
 * `pnpm build:production`); preview and plain builds leave it out.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { knownInlineScriptHashes } from "../utils/inlineScripts";
import { inlineScripts, scriptHash } from "../utils/securityHeaders";
import { withStaticSecurityHeaders } from "../utils/staticSecurityHeaders";

async function* htmlFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(path);
    else if (entry.name.endsWith(".html")) yield path;
  }
}

export interface UnknownInlineScript {
  /** The page, relative to the build's client directory. */
  file: string;
  /** The start of the script's text. */
  excerpt: string;
}

/** Inline scripts in the .html files under `dir` whose hash isn't in `allowed`. */
export async function unknownInlineScripts(
  dir: string,
  allowed: readonly string[],
): Promise<UnknownInlineScript[]> {
  const known = new Set(allowed);
  const unknown: UnknownInlineScript[] = [];
  for await (const file of htmlFiles(dir)) {
    for (const script of inlineScripts(await readFile(file, "utf8"))) {
      if (known.has(await scriptHash(script))) continue;
      unknown.push({
        file: relative(dir, file),
        excerpt: script.trim().replace(/\s+/g, " ").slice(0, 80),
      });
    }
  }
  return unknown;
}

export default function securityHeaders(): AstroIntegration {
  let clientDir: URL | undefined;
  return {
    name: "toiletmap:security-headers",
    hooks: {
      "astro:config:done": ({ config }) => {
        clientDir = config.build.client;
      },
      "astro:build:done": async ({ logger }) => {
        if (!clientDir) return;
        const dir = fileURLToPath(clientDir);
        const scriptHashes = await knownInlineScriptHashes();
        const unknown = await unknownInlineScripts(dir, scriptHashes);
        if (unknown.length > 0) {
          throw new Error(
            [
              "Prerendered pages have inline scripts the Content Security Policy doesn't allow.",
              "Move the code into a component script, or (for a script the site really ships) add it to src/utils/inlineScripts.ts. Markdown posts and pages must not contain <script> elements.",
              ...unknown.map(({ file, excerpt }) => `  ${file}: ${excerpt}`),
            ].join("\n"),
          );
        }
        const headersPath = join(dir, "_headers");
        const existing = await readFile(headersPath, "utf8").catch(() => "");
        const production = process.env.CLOUDFLARE_ENV === "production";
        await writeFile(
          headersPath,
          withStaticSecurityHeaders(existing, { production, scriptHashes }),
        );
        logger.info(
          `Wrote security headers to _headers (${scriptHashes.length} inline script hash(es)${production ? ", HSTS" : ""}).`,
        );
      },
    },
  };
}
