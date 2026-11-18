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
});
