// @vitest-environment node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { env as workerEnv } from "./test/cloudflare-workers.stub";

/**
 * Smoke test for the built Cloudflare worker (dist/server/entry.mjs).
 *
 * It needs `astro build` output, so it is skipped (and reported as skipped, not
 * silently passed) when dist/ is missing, e.g. in a plain `pnpm test` run. CI's
 * client build job runs `pnpm test` after `pnpm build` so it runs there.
 *
 * The built worker imports `cloudflare:workers`; vitest.config.ts aliases that to
 * ./test/cloudflare-workers.stub.ts, whose `env` this test fills in.
 */
const entryPath = resolve(import.meta.dirname, "../dist/server/entry.mjs");
const distExists = existsSync(entryPath);

describe("Client Worker SSR HTML Render", () => {
  it.skipIf(!distExists)(
    "renders valid HTML page and never returns [object Object] (needs dist/ from `astro build`; skipped without it)",
    async () => {
      const bindings = {
        ASSET: { fetch: async () => new Response("Not found", { status: 404 }) },
        ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
        PUBLIC_API_URL: "https://toiletmap-server.gbtoiletmap.workers.dev",
      };
      Object.assign(workerEnv, bindings);

      const entry = (await import(/* @vite-ignore */ pathToFileURL(entryPath).href)) as {
        default: { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> };
      };
      const handler = entry.default;

      const req = new Request("http://localhost:4321/");
      const ctx = {
        waitUntil: () => {
          /* noop */
        },
      };

      const res = await handler.fetch(req, bindings, ctx);
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).not.toBe("[object Object]");
      expect(text).not.toContain("[object Object]");
      expect(text.toLowerCase()).toContain("<!doctype html>");
    },
  );

  /** GET a path from the built worker with the given ENVIRONMENT var. */
  const fetchBuilt = async (path: string, environment: string) => {
    const bindings = {
      ASSET: { fetch: async () => new Response("Not found", { status: 404 }) },
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      PUBLIC_API_URL: "https://toiletmap-server.gbtoiletmap.workers.dev",
      ENVIRONMENT: environment,
    };
    Object.assign(workerEnv, bindings);
    const entry = (await import(/* @vite-ignore */ pathToFileURL(entryPath).href)) as {
      default: { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> };
    };
    return entry.default.fetch(new Request(`http://localhost:4321${path}`), bindings, {
      waitUntil: () => {
        /* noop */
      },
    });
  };

  it.skipIf(!distExists)(
    "the /dev/components kitchen sink is a 404 in production and renders in preview (needs dist/)",
    async () => {
      const production = await fetchBuilt("/dev/components", "production");
      expect(production.status).toBe(404);
      expect(await production.text()).not.toContain("Every component in");

      const preview = await fetchBuilt("/dev/components", "preview");
      expect(preview.status).toBe(200);
      const html = await preview.text();
      expect(html).toContain("Every component in");
      expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    },
  );

  it.skipIf(!distExists)(
    "an unknown path gets the site's own 404 page, with its header (needs dist/)",
    async () => {
      const response = await fetchBuilt("/no-such-page", "production");
      expect(response.status).toBe(404);
      const html = await response.text();
      expect(html).toContain("We can't find that page");
      expect(html).toContain("<title>Page not found – Toilet Map</title>");
      expect(html).toContain('href="/"');
      // Not Astro's development 404.
      expect(html).not.toContain("astro-logo");
    },
  );
});
