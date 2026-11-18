// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildUrlset,
  chunk,
  fetchActiveLooIds,
  idsFromDump,
  SITEMAP_CACHE_CONTROL,
  sitemapDocument,
  sitemapEntries,
  sitemapResponse,
} from "./sitemap";
import { escapeXml } from "./xml";

const SITE = "https://www.toiletmap.org.uk";

const post = (id: string, date: string, draft = false) => ({
  id,
  data: { title: id, date: new Date(date), draft },
});

describe("escapeXml", () => {
  it("escapes markup and quotes and drops characters XML forbids", () => {
    expect(escapeXml(`a & b < c > "d" 'e'`)).toBe(
      "a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;",
    );
    expect(escapeXml("bell\u0007tab\tok")).toBe("belltab\tok");
  });
});

describe("sitemapEntries", () => {
  it("lists the fixed pages, content pages, published posts and toilets, once each", () => {
    const entries = sitemapEntries({
      site: SITE,
      pages: [
        { id: "privacy", data: { title: "Privacy" } },
        { id: "about", data: { title: "About" } },
        { id: "app/privacy", data: { title: "App privacy" } },
      ],
      posts: [
        post("older", "2024-01-01"),
        post("draft", "2026-01-01", true),
        post("newer", "2025-06-01"),
      ],
      looIds: ["aaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbb", "aaaaaaaaaaaaaaaaaaaaaaaa"],
    });
    expect(entries.map((entry) => entry.loc)).toEqual([
      `${SITE}/`,
      `${SITE}/posts`,
      `${SITE}/feedback`,
      `${SITE}/about`,
      `${SITE}/app/privacy`,
      `${SITE}/privacy`,
      `${SITE}/posts/newer`,
      `${SITE}/posts/older`,
      `${SITE}/loos/aaaaaaaaaaaaaaaaaaaaaaaa`,
      `${SITE}/loos/bbbbbbbbbbbbbbbbbbbbbbbb`,
    ]);
    expect(entries.find((entry) => entry.loc.endsWith("/posts/newer"))?.lastmod).toEqual(
      new Date("2025-06-01"),
    );
  });

  it("escapes URLs in the XML", () => {
    const xml = buildUrlset(
      sitemapEntries({
        site: SITE,
        pages: [{ id: "a&b <c>", data: { title: "x" } }],
        posts: [],
        looIds: [],
      }),
    );
    expect(xml).toContain(`<loc>${SITE}/a%26b%20%3Cc%3E</loc>`);
    expect(xml).not.toMatch(/<loc>[^<]*&(?!amp;|lt;|gt;|quot;|apos;)/);
  });
});

describe("buildUrlset", () => {
  it("is a well-formed sitemap with dates as YYYY-MM-DD", () => {
    const xml = buildUrlset([
      { loc: `${SITE}/?a=1&b=2` },
      { loc: `${SITE}/posts/x`, lastmod: new Date("2025-06-01T10:00:00Z") },
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain(`<url><loc>${SITE}/?a=1&amp;b=2</loc></url>`);
    expect(xml).toContain("<lastmod>2025-06-01</lastmod>");
    expect(xml.trim().endsWith("</urlset>")).toBe(true);
  });
});

describe("sitemapDocument", () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({ loc: `${SITE}/loos/${i}` }));

  it("is one urlset while it fits", () => {
    const doc = sitemapDocument(entries, null, SITE, 10);
    expect(doc.status).toBe(200);
    expect(doc.body).toContain("<urlset");
    expect(doc.body?.match(/<url>/g)).toHaveLength(5);
  });

  it("becomes an index of numbered chunks past the limit", () => {
    const index = sitemapDocument(entries, null, SITE, 2);
    expect(index.body).toContain("<sitemapindex");
    expect(index.body?.match(/<sitemap>/g)).toHaveLength(3);
    expect(index.body).toContain(`<loc>${SITE}/sitemap-1.xml</loc>`);
    expect(index.body).toContain(`<loc>${SITE}/sitemap-3.xml</loc>`);

    const last = sitemapDocument(entries, 3, SITE, 2);
    expect(last.body?.match(/<url>/g)).toHaveLength(1);
    expect(last.body).toContain(`${SITE}/loos/4`);
  });

  it("404s a chunk that doesn't exist", () => {
    expect(sitemapDocument(entries, 4, SITE, 2).status).toBe(404);
    expect(sitemapDocument(entries, 0, SITE, 2).status).toBe(404);
    // A single-file sitemap still answers /sitemap-1.xml.
    expect(sitemapDocument(entries, 1, SITE, 10).status).toBe(200);
  });

  it("chunks evenly", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("idsFromDump / fetchActiveLooIds", () => {
  it("reads ids from the compressed dump tuples", () => {
    expect(
      idsFromDump({ data: [["a", "gcpv", 3], ["b", "gcpu", 0], [null], []], count: 4 }),
    ).toEqual(["a", "b"]);
  });

  it("rejects a body that isn't a dump", () => {
    expect(() => idsFromDump({ message: "error" })).toThrow();
  });

  it("asks the API for /api/loos/dump and fails loudly on an error", async () => {
    const seen: string[] = [];
    const env = {
      PUBLIC_API_URL: "https://api.example.test",
      API: {
        fetch: (request: Request) => {
          seen.push(new URL(request.url).pathname);
          return Promise.resolve(
            new Response(JSON.stringify({ data: [["x", "g", 0]] }), { status: 200 }),
          );
        },
      },
    };
    expect(await fetchActiveLooIds(env, new URL(`${SITE}/sitemap.xml`))).toEqual(["x"]);
    expect(seen).toEqual(["/api/loos/dump"]);

    const down = {
      ...env,
      API: { fetch: () => Promise.resolve(new Response("no", { status: 500 })) },
    };
    await expect(fetchActiveLooIds(down, new URL(`${SITE}/sitemap.xml`))).rejects.toThrow("500");
  });
});

describe("sitemapResponse", () => {
  it("serves XML with cache headers", async () => {
    const response = sitemapResponse({ status: 200, body: "<urlset/>" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe(SITEMAP_CACHE_CONTROL);
    expect(await response.text()).toBe("<urlset/>");
  });

  it("is a 503 to retry later, never cached, when the API is down", () => {
    const response = sitemapResponse(null);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("600");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("passes a 404 through", () => {
    expect(sitemapResponse({ status: 404, body: null }).status).toBe(404);
  });
});
