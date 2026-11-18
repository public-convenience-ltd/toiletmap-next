// @vitest-environment node
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env as workerEnv } from "./test/cloudflare-workers.stub";

/**
 * Pages, statuses and meta from the built worker (dist/server/entry.mjs): the real 404 on
 * /loos/:id, the toilet's meta and JSON-LD, the 500 page, robots.txt, the sitemap and RSS.
 *
 * Like render.test.ts this needs `astro build` output. It is skipped when dist/ is missing
 * or was built before these routes existed (no /robots.txt in the build manifest), so a stale
 * dist/ can't fail it. The API is a fake service binding (env.API), so nothing leaves the
 * machine; ASSETS serves dist/client, which is where the prerendered 500 page and RSS live.
 */
const distDir = resolve(import.meta.dirname, "../dist");
const entryPath = join(distDir, "server/entry.mjs");
const built =
  existsSync(entryPath) && readFileSync(entryPath, "utf8").includes('"route":"/robots.txt"');

const SITE = "https://www.toiletmap.org.uk";
const ID = "0123456789abcdef01234567";
const UNKNOWN_ID = "ffffffffffffffffffffffff";

const activeLoo = {
  id: ID,
  name: "Victoria Park",
  area: [{ name: "Tower Hamlets", type: "London Borough" }],
  location: { lat: 51.5362, lng: -0.0392 },
  accessible: true,
  allGender: null,
  men: true,
  women: true,
  children: null,
  babyChange: true,
  radar: true,
  automatic: false,
  noPayment: true,
  paymentDetails: null,
  openingTimes: [["09:00", "17:00"], ["09:00", "17:00"], [], [], [], [], []],
  updatedAt: "2026-10-01T12:00:00.000Z",
  active: true,
};

type ApiHandler = (request: Request) => Response | Promise<Response>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The fake toiletmap-server: one active and one removed toilet, everything else 404. */
const defaultApi: ApiHandler = (request) => {
  const { pathname } = new URL(request.url);
  if (pathname === `/api/loos/${ID}`) return json(200, activeLoo);
  if (pathname === "/api/loos/bbbbbbbbbbbbbbbbbbbbbbbb") {
    return json(200, { ...activeLoo, id: "bbbbbbbbbbbbbbbbbbbbbbbb", active: false });
  }
  if (pathname === "/api/loos/dump") {
    return json(200, { data: [[ID, "gcpvn", 9]], count: 1, cursor: "x" });
  }
  return json(404, { message: "Not Found" });
};

/** ASSETS: files from dist/client, the way the Workers assets binding serves them. */
const assets = {
  fetch: (input: Request | string): Promise<Response> => {
    const { pathname } = new URL(typeof input === "string" ? input : input.url);
    for (const candidate of [pathname, `${pathname}.html`, `${pathname}/index.html`]) {
      const file = join(distDir, "client", candidate);
      if (existsSync(file) && statSync(file).isFile()) {
        return Promise.resolve(
          new Response(readFileSync(file), {
            headers: { "content-type": candidate.endsWith(".html") ? "text/html" : "text/plain" },
          }),
        );
      }
    }
    return Promise.resolve(new Response("Not found", { status: 404 }));
  },
};

const apiCalls: string[] = [];

const fetchBuilt = async (
  path: string,
  { environment = "production", api = defaultApi }: { environment?: string; api?: ApiHandler } = {},
) => {
  const bindings = {
    ASSET: assets,
    ASSETS: assets,
    PUBLIC_API_URL: "https://api.invalid",
    ENVIRONMENT: environment,
    API: {
      fetch: (request: Request) => {
        apiCalls.push(new URL(request.url).pathname);
        return Promise.resolve(api(request));
      },
    },
  };
  Object.assign(workerEnv, bindings);
  const entry = (await import(/* @vite-ignore */ pathToFileURL(entryPath).href)) as {
    default: { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> };
  };
  return entry.default.fetch(new Request(`http://localhost:4321${path}`), bindings, {
    waitUntil: () => undefined,
  });
};

/** The parsed JSON-LD blocks of a page. */
const jsonLd = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (match) => JSON.parse(match[1]) as Record<string, unknown>,
  );

afterEach(() => {
  apiCalls.length = 0;
  vi.restoreAllMocks();
});

describe("/loos/:id in the built worker (needs dist/ from `astro build`; skipped without it)", () => {
  it.skipIf(!built)("an unknown toilet is a real 404, with the site's 404 page", async () => {
    const response = await fetchBuilt(`/loos/${UNKNOWN_ID}`);
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain("We can't find that page");
    expect(html).toContain("<title>Page not found – Toilet Map</title>");
    expect(html).toMatch(/<meta name="robots" content="noindex, follow">/);
    expect(apiCalls).toEqual([`/api/loos/${UNKNOWN_ID}`]);
  });

  it.skipIf(!built)("an id that can't exist is a 404 without asking the API", async () => {
    const response = await fetchBuilt(`/loos/${"x".repeat(80)}`);
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("We can't find that page");
    expect(apiCalls).toEqual([]);
  });

  it.skipIf(!built)(
    "an active toilet has its title, description, canonical and JSON-LD",
    async () => {
      const response = await fetchBuilt(`/loos/${ID}`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("<title>Victoria Park, Tower Hamlets – Toilet Map</title>");
      expect(html).toContain(`<link rel="canonical" href="${SITE}/loos/${ID}">`);
      expect(html).toContain(`<meta property="og:url" content="${SITE}/loos/${ID}">`);
      expect(html).toContain(
        '<meta property="og:title" content="Victoria Park, Tower Hamlets – Toilet Map">',
      );
      expect(html).toMatch(
        /<meta name="description" content="Public toilet in Tower Hamlets: [^"]+">/,
      );
      expect(html).not.toContain('name="robots"');
      const [outer] = jsonLd(html);
      const graph = outer["@graph"] as Record<string, unknown>[];
      expect(graph.map((node) => node["@type"])).toEqual(["WebPage", "PublicToilet"]);
      const data = graph[1];
      expect(data.geo).toEqual({
        "@type": "GeoCoordinates",
        latitude: 51.5362,
        longitude: -0.0392,
      });
      // The toilet's name in the server-rendered <h1>, not a generic one.
      expect(html).toMatch(
        /<h1 class="visually-hidden"[^>]*>Victoria Park, Tower Hamlets: public toilet<\/h1>/,
      );
      // Still the map page, with the panel opening on this toilet.
      expect(html).toContain('class="map-page"');
      expect(html).toContain(ID);
    },
  );

  it.skipIf(!built)("a removed toilet is 200 but noindex, with no JSON-LD", async () => {
    const response = await fetchBuilt("/loos/bbbbbbbbbbbbbbbbbbbbbbbb");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<meta name="robots" content="noindex, follow">');
    expect(html).toContain("<title>Removed: Victoria Park, Tower Hamlets – Toilet Map</title>");
    expect(jsonLd(html)).toEqual([]);
    // noindex, so no canonical (mixed signals otherwise).
    expect(html).not.toContain('rel="canonical"');
  });

  it.skipIf(!built)("when the API is down the map still renders, with generic meta", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await fetchBuilt(`/loos/${ID}`, { api: () => json(503, {}) });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("<title>Toilet Map</title>");
    expect(html).toContain(`<link rel="canonical" href="${SITE}/loos/${ID}">`);
    expect(html).toContain('class="map-page"');
  });

  it.skipIf(!built)("the edit page 404s an unknown toilet with the site's 404 page", async () => {
    const response = await fetchBuilt(`/loos/${UNKNOWN_ID}/edit`);
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("We can't find that page");
  });

  it.skipIf(!built)(
    "the edit page answers 500 with the site's error page when the API fails",
    async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const response = await fetchBuilt(`/loos/${ID}/edit`, { api: () => json(500, {}) });
      expect(response.status).toBe(500);
      const html = await response.text();
      expect(html).toContain("Something went wrong");
      expect(html).toContain("<title>Something went wrong – Toilet Map</title>");
    },
  );

  it.skipIf(!built)("preview deployments are never indexed", async () => {
    const html = await (await fetchBuilt(`/loos/${ID}`, { environment: "preview" })).text();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it.skipIf(!built)("the home page describes the WebSite and Organization", async () => {
    const response = await fetchBuilt("/");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
    const [outer] = jsonLd(html);
    const graph = outer["@graph"] as Record<string, unknown>[];
    expect(graph.map((node) => node["@type"])).toEqual(["WebSite", "Organization"]);
  });
});

describe("robots.txt, sitemap and RSS in the built worker (needs dist/; skipped without it)", () => {
  it.skipIf(!built)("robots.txt points at the sitemap in production", async () => {
    const response = await fetchBuilt("/robots.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const text = await response.text();
    expect(text).toContain("Disallow: /loos/*/edit");
    expect(text).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });

  it.skipIf(!built)("robots.txt turns everyone away on a preview", async () => {
    const text = await (await fetchBuilt("/robots.txt", { environment: "preview" })).text();
    expect(text.split("\n")).toContain("Disallow: /");
    expect(text).not.toContain("Sitemap:");
  });

  it.skipIf(!built)("the sitemap lists the home page and the active toilets", async () => {
    const response = await fetchBuilt("/sitemap.xml");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(response.headers.get("cache-control")).toContain("max-age=3600");
    const xml = await response.text();
    expect(xml).toContain(`<url><loc>${SITE}/</loc></url>`);
    expect(xml).toContain(`<url><loc>${SITE}/dataset</loc></url>`);
    expect(xml).toContain(`<url><loc>${SITE}/loos/${ID}</loc></url>`);
    expect(apiCalls).toEqual(["/api/loos/dump"]);
  });

  it.skipIf(!built)("the sitemap is a 503 to retry when the API is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await fetchBuilt("/sitemap.xml", { api: () => json(500, {}) });
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBeTruthy();
  });

  it.skipIf(!built)("the RSS feed is built as a well-formed channel", () => {
    const xml = readFileSync(join(distDir, "client/posts/rss.xml"), "utf8");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<channel>");
    expect(xml).toContain(`<atom:link href="${SITE}/posts/rss.xml"`);
  });
});
