#!/usr/bin/env node
// Fails if the built client references an /_astro/ file that the build didn't emit.
//
// Why: Astro can drop a chunk's CSS from the client build while Vite's lazy-import
// preload list still names it (seen with Astro 7.2.0: the lazy settings panel's
// design-system CSS 404'd, so `import()` rejected and the map island broke). Unit
// tests and the Playwright suite (which runs `astro dev`) can't see this; only the
// built output can.
//
// Usage: node scripts/check-build-assets.mjs [distDir]   (default: ./dist)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const dist = process.argv[2] ?? "dist";
const assetsDir = join(dist, "client", "_astro");
if (!existsSync(assetsDir)) {
  console.error(`check-build-assets: ${assetsDir} not found. Run the build first.`);
  process.exit(1);
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(m?js|html|css)$/.test(name)) yield path;
  }
}

// `_astro/name.hash.ext` (preload lists, server-rendered <link>/<script> tags) and
// `./name.hash.ext` (relative imports between client chunks).
const ABSOLUTE = /_astro\/([\w@.-]+\.(?:js|css))/g;
const RELATIVE = /["'`]\.\/([\w@.-]+\.(?:js|css))["'`]/g;

const missing = new Map();
let refs = 0;
for (const file of walk(dist)) {
  const source = readFileSync(file, "utf8");
  const inClientAssets = relative(assetsDir, file).split(/[\\/]/)[0] !== "..";
  const patterns = inClientAssets ? [ABSOLUTE, RELATIVE] : [ABSOLUTE];
  for (const pattern of patterns) {
    for (const [, name] of source.matchAll(pattern)) {
      refs++;
      if (!existsSync(join(assetsDir, name))) {
        if (!missing.has(name)) missing.set(name, new Set());
        missing.get(name).add(relative(dist, file));
      }
    }
  }
}

if (missing.size > 0) {
  console.error(`check-build-assets: ${missing.size} referenced asset(s) missing from ${assetsDir}:`);
  for (const [name, from] of missing) console.error(`  ${name}  (referenced by ${[...from].join(", ")})`);
  process.exit(1);
}
console.log(`check-build-assets: OK (${refs} references, all present)`);
