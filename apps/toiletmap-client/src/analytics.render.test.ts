// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env as workerEnv } from "./test/cloudflare-workers.stub";

/**
 * Plausible wiring in the built worker (dist/server/entry.mjs): the script tag on pages,
 * and /api/event reaching its own route rather than the generic /api proxy.
 *
 * Like render.test.ts this needs `astro build` output. It is skipped when dist/ is
 * missing or was built before the analytics routes existed (no /api/event route in the
 * build manifest), so a stale dist/ can't fail it.
 */
const entryPath = resolve(import.meta.dirname, "../dist/server/entry.mjs");
const builtWithAnalytics =
  existsSync(entryPath) && readFileSync(entryPath, "utf8").includes('"route":"/api/event"');

type Handler = { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> };

const fetchBuilt = async (request: Request, extra: Record<string, unknown> = {}) => {
  const bindings = {
    ASSET: { fetch: async () => new Response("Not found", { status: 404 }) },
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    PUBLIC_API_URL: "https://toiletmap-server.gbtoiletmap.workers.dev",
    ENVIRONMENT: "production",
    ...extra,
  };
  Object.assign(workerEnv, bindings);
  const entry = (await import(/* @vite-ignore */ pathToFileURL(entryPath).href)) as {
    default: Handler;
  };
  return entry.default.fetch(request, bindings, { waitUntil: () => undefined });
};

afterEach(() => {
  workerEnv.PLAUSIBLE_DOMAIN = undefined;
  vi.restoreAllMocks();
});

describe("Plausible in the built worker (needs dist/ from `astro build`; skipped without it)", () => {
  it.skipIf(!builtWithAnalytics)("emits nothing when PLAUSIBLE_DOMAIN is unset", async () => {
    const page = await fetchBuilt(new Request("http://localhost:4321/"));
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).not.toContain("/js/p.js");
    expect(html).not.toContain("data-domain");
    expect(html).not.toMatch(/plausible/i);

    const script = await fetchBuilt(new Request("http://localhost:4321/js/p.js"));
    expect(script.status).toBe(404);
  });

  it.skipIf(!builtWithAnalytics)("adds the first-party script tag when set", async () => {
    const page = await fetchBuilt(new Request("http://localhost:4321/"), {
      PLAUSIBLE_DOMAIN: "toiletmap.org.uk",
    });
    const html = await page.text();
    const tag = html.match(/<script[^>]*src="\/js\/p\.js"[^>]*>/)?.[0] ?? "";
    expect(tag).toContain("defer");
    expect(tag).toContain('data-domain="toiletmap.org.uk"');
    expect(tag).toContain('data-api="/api/event"');

    const gpc = await fetchBuilt(
      new Request("http://localhost:4321/", { headers: { "sec-gpc": "1" } }),
      { PLAUSIBLE_DOMAIN: "toiletmap.org.uk" },
    );
    expect(await gpc.text()).not.toContain("/js/p.js");
  });

  it.skipIf(!builtWithAnalytics)(
    "routes POST /api/event to plausible.io, not the generic API proxy",
    async () => {
      const upstream = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => new Response("ok", { status: 202 }));
      const response = await fetchBuilt(
        new Request("http://localhost:4321/api/event", {
          method: "POST",
          headers: {
            origin: "http://localhost:4321",
            "content-type": "text/plain",
            "cf-connecting-ip": "203.0.113.7",
            "user-agent": "Mozilla/5.0 (test)",
          },
          body: JSON.stringify({
            n: "pageview",
            u: "http://localhost:4321/",
            d: "toiletmap.org.uk",
          }),
        }),
        { PLAUSIBLE_DOMAIN: "toiletmap.org.uk" },
      );
      expect(response.status).toBe(202);
      const forwarded = upstream.mock.calls.map(([input]) =>
        input instanceof Request ? input : new Request(input),
      );
      expect(forwarded.map((request) => request.url)).toEqual(["https://plausible.io/api/event"]);
      expect(forwarded[0].headers.get("x-forwarded-for")).toBe("203.0.113.7");
    },
  );
});
