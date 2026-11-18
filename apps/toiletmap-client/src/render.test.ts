// @vitest-environment node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { env as workerEnv } from "./test/cloudflare-workers.stub";
import { FakeDatasetBucket } from "./test/r2-fake";

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

  it.skipIf(!distExists)(
    "routes the legacy GraphQL URLs /api and /api/ to the server's /api/graphql without credentials (needs dist/)",
    async () => {
      const upstream: Request[] = [];
      const bindings = {
        ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
        PUBLIC_API_URL: "https://toiletmap-server.gbtoiletmap.workers.dev",
        API: {
          fetch: (request: Request) => {
            upstream.push(request);
            return Promise.resolve(
              new Response('{"data":{"__typename":"Query"}}', {
                headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
              }),
            );
          },
        },
      };
      Object.assign(workerEnv, bindings);
      const entry = (await import(/* @vite-ignore */ pathToFileURL(entryPath).href)) as {
        default: { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> };
      };
      const ctx = { waitUntil: () => undefined };

      const flutter = await entry.default.fetch(
        new Request("https://www.toiletmap.org.uk/api/?query=%7B__typename%7D", {
          headers: { cookie: "access_token=secret" },
        }),
        bindings,
        ctx,
      );
      expect(flutter.status).toBe(200);
      expect(flutter.headers.get("access-control-allow-origin")).toBe("*");
      const post = await entry.default.fetch(
        new Request("https://www.toiletmap.org.uk/api", {
          method: "POST",
          headers: {
            origin: "https://explorer.toiletmap.org.uk",
            "content-type": "application/json",
            cookie: "access_token=secret",
          },
          body: '{"query":"{ __typename }"}',
        }),
        bindings,
        ctx,
      );
      expect(post.status).toBe(200);

      expect(upstream.map((request) => [request.method, new URL(request.url).pathname])).toEqual([
        ["GET", "/api/graphql"],
        ["POST", "/api/graphql"],
      ]);
      for (const request of upstream) {
        expect(request.headers.get("cookie")).toBeNull();
        expect(request.headers.get("authorization")).toBeNull();
      }
      Object.assign(workerEnv, { API: undefined });
    },
  );

  describe("/dataset (needs dist/)", () => {
    type Handler = { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> };
    const ctx = { waitUntil: () => undefined };
    const loadWorker = async () =>
      ((await import(/* @vite-ignore */ pathToFileURL(entryPath).href)) as { default: Handler })
        .default;
    const baseBindings = {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      PUBLIC_API_URL: "https://toiletmap-server.gbtoiletmap.workers.dev",
    };
    const manifest = {
      schemaVersion: 1,
      generatedAt: "2026-11-18T00:17:00.000Z",
      date: "2026-11-18",
      rowCount: 15_432,
      licence: "CC-BY-4.0",
      files: [
        {
          name: "toilets.json",
          format: "json",
          key: "latest/toilets.json",
          archiveKey: "archive/2026-11-18/toilets.json",
          contentType: "application/json; charset=utf-8",
          size: 9_120_000,
          sha256: "a".repeat(64),
        },
        {
          name: "toilets.csv",
          format: "csv",
          key: "latest/toilets.csv",
          archiveKey: "archive/2026-11-18/toilets.csv",
          contentType: "text/csv; charset=utf-8",
          size: 7_944_338,
          sha256: "b".repeat(64),
        },
      ],
      archives: ["2026-11-18", "2026-11-17"],
    };

    it.skipIf(!distExists)("lists the downloads, archive, fields and licence", async () => {
      const bucket = new FakeDatasetBucket();
      bucket.put("latest/manifest.json", JSON.stringify(manifest));
      const bindings = { ...baseBindings, EXPORTS: bucket };
      Object.assign(workerEnv, bindings);
      try {
        const worker = await loadWorker();
        const res = await worker.fetch(
          new Request("https://www.toiletmap.org.uk/dataset"),
          bindings,
          ctx,
        );
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toMatch(/<h1[^>]*>Toilet Data<\/h1>/);
        expect(html).toMatch(/href="\/dataset\/latest\/toilets\.json"[^>]*>\s*JSON \(9\.12 MB\)/);
        expect(html).toMatch(/href="\/dataset\/latest\/toilets\.csv"[^>]*>\s*CSV \(7\.94 MB\)/);
        expect(html).toContain("18/11/2026, 00:17");
        expect(html).toContain("15,432");
        expect(html).toContain('href="/dataset/archive/2026-11-17/toilets.csv"');
        expect(html).toContain("<title>Toilet Map: Our Data</title>");
        // Each archive link names its day for screen readers.
        expect(html).toMatch(
          /href="\/dataset\/archive\/2026-11-17\/toilets\.json"[^>]*>\s*JSON<span class="visually-hidden"[^>]*> for 2026-11-17<\/span>/,
        );
        expect(html).toMatch(/each day, at <code[^>]*>\/dataset\/archive\//);
        for (const field of ["opening_times", "no_payment", "verified_at", "longitude"]) {
          expect(html).toMatch(new RegExp(`<code[^>]*>${field}</code>`));
        }
        // Private columns are not part of the dataset.
        expect(html).not.toContain("removal_reason");
        expect(html).not.toMatch(/<code[^>]*>contributors<\/code>/);
        expect(html).toContain("https://creativecommons.org/licenses/by/4.0/");
        expect(html).toContain("Contains data from the Toilet Map © 2025");
        expect(html).not.toContain("map-page");
      } finally {
        Object.assign(workerEnv, { EXPORTS: undefined });
      }
    });

    it.skipIf(!distExists)("says downloads are temporarily unavailable when R2 fails", async () => {
      const bucket = new FakeDatasetBucket();
      bucket.put("latest/manifest.json", JSON.stringify(manifest));
      bucket.failNextGet = true;
      const bindings = { ...baseBindings, EXPORTS: bucket };
      Object.assign(workerEnv, bindings);
      try {
        const worker = await loadWorker();
        const res = await worker.fetch(
          new Request("https://www.toiletmap.org.uk/dataset"),
          bindings,
          ctx,
        );
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("Downloads are temporarily unavailable");
        expect(html).not.toContain("hasn't been published yet");
      } finally {
        Object.assign(workerEnv, { EXPORTS: undefined });
      }
    });

    it.skipIf(!distExists)("says downloads are live-site only without the bucket", async () => {
      Object.assign(workerEnv, baseBindings, { EXPORTS: undefined });
      const worker = await loadWorker();
      const page = await worker.fetch(
        new Request("http://localhost:4321/dataset"),
        baseBindings,
        ctx,
      );
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("Data downloads are only available on the live site");
      expect(html).toContain("Licence Information");

      const file = await worker.fetch(
        new Request("http://localhost:4321/dataset/latest/toilets.csv"),
        baseBindings,
        ctx,
      );
      expect(file.status).toBe(503);
    });

    it.skipIf(!distExists)("serves a file from the bucket with its headers", async () => {
      const bucket = new FakeDatasetBucket();
      bucket.put("latest/toilets.csv", '"id"\n"a"', {
        contentType: "text/csv; charset=utf-8",
        customMetadata: { date: "2026-11-18" },
      });
      const bindings = { ...baseBindings, EXPORTS: bucket };
      Object.assign(workerEnv, bindings);
      try {
        const worker = await loadWorker();
        const res = await worker.fetch(
          new Request("https://www.toiletmap.org.uk/dataset/latest/toilets.csv"),
          bindings,
          ctx,
        );
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('"id"\n"a"');
        expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
        expect(res.headers.get("content-disposition")).toBe(
          'attachment; filename="toilets-2026-11-18.csv"',
        );
        const etag = res.headers.get("etag") ?? "";
        const notModified = await worker.fetch(
          new Request("https://www.toiletmap.org.uk/dataset/latest/toilets.csv", {
            headers: { "If-None-Match": etag },
          }),
          bindings,
          ctx,
        );
        expect(notModified.status).toBe(304);
        const unknown = await worker.fetch(
          new Request("https://www.toiletmap.org.uk/dataset/_state/run.json"),
          bindings,
          ctx,
        );
        expect(unknown.status).toBe(404);
      } finally {
        Object.assign(workerEnv, { EXPORTS: undefined });
      }
    });
  });
});
