/**
 * The hand-rolled sitemap (/sitemap.xml, and /sitemap-<n>.xml chunks when it grows past
 * SITEMAP_URL_LIMIT): the fixed pages, the content collections and every active toilet.
 *
 * Toilets come from the API's compressed dump (`GET /api/loos/dump`: active, located toilets
 * only), so removed toilets are never listed. Nothing in this module may be imported by
 * browser islands.
 */
import { type ApiEnv, fetchApi } from "./api";
import { type PageLike, type PostLike, pagePath, postPath, publishedPosts } from "./content";
import { absoluteUrl } from "./seo";
import { BLOG_PATH } from "./siteNav";
import { escapeXml, XML_DECLARATION } from "./xml";

/** Google allows 50,000 URLs (and 50 MB) per file; stay well under it. */
export const SITEMAP_URL_LIMIT = 45_000;

/**
 * Pages that are always there (content pages come from the `pages` collection). `/dataset`
 * is the open dataset page (src/pages/dataset.astro); its downloads under `/dataset/*` are
 * files, not pages, so they are not listed.
 */
export const STATIC_SITEMAP_PATHS = ["/", BLOG_PATH, "/feedback", "/dataset"] as const;

/** An hour fresh, then served stale for a day while it refreshes. */
export const SITEMAP_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

export interface SitemapEntry {
  /** Absolute URL. */
  loc: string;
  lastmod?: Date | string | null;
}

const lastmodText = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const urlElement = (tag: "url" | "sitemap", { loc, lastmod }: SitemapEntry) => {
  const mod = lastmodText(lastmod);
  return `<${tag}><loc>${escapeXml(loc)}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ""}</${tag}>`;
};

/** A `<urlset>` document. */
export function buildUrlset(entries: readonly SitemapEntry[]): string {
  return [
    XML_DECLARATION,
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((entry) => urlElement("url", entry)),
    "</urlset>",
    "",
  ].join("\n");
}

/** A `<sitemapindex>` document listing the chunk files. */
export function buildSitemapIndex(sitemaps: readonly SitemapEntry[]): string {
  return [
    XML_DECLARATION,
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...sitemaps.map((entry) => urlElement("sitemap", entry)),
    "</sitemapindex>",
    "",
  ].join("\n");
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Toilet ids from a `/api/loos/dump` body (`{ data: [id, geohash, mask][] }`). */
export function idsFromDump(body: unknown): string[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new Error("Unexpected /api/loos/dump body");
  const ids: string[] = [];
  for (const row of data) {
    const id = Array.isArray(row) ? row[0] : (row as { id?: unknown } | null)?.id;
    if (typeof id === "string" && id) ids.push(id);
  }
  return ids;
}

export interface SitemapSources {
  site: URL | string | undefined | null;
  pages: readonly PageLike[];
  posts: readonly PostLike[];
  looIds: readonly string[];
}

/** Every URL in the sitemap, in a stable order: fixed pages, pages, posts, toilets. */
export function sitemapEntries({ site, pages, posts, looIds }: SitemapSources): SitemapEntry[] {
  const seen = new Set<string>();
  const entries: SitemapEntry[] = [];
  const add = (path: string, lastmod?: Date) => {
    const loc = absoluteUrl(path, site);
    if (seen.has(loc)) return;
    seen.add(loc);
    entries.push({ loc, lastmod });
  };
  for (const path of STATIC_SITEMAP_PATHS) add(path);
  for (const page of [...pages].sort((a, b) => a.id.localeCompare(b.id))) add(pagePath(page.id));
  for (const post of publishedPosts(posts)) add(postPath(post.id), post.data.date);
  for (const id of looIds) add(`/loos/${encodeURIComponent(id)}`);
  return entries;
}

export interface SitemapDocument {
  status: number;
  body: string | null;
}

/**
 * The document for /sitemap.xml (`part` null) or /sitemap-<part>.xml: one urlset while
 * everything fits in SITEMAP_URL_LIMIT, otherwise an index at /sitemap.xml pointing at
 * numbered chunks (from 1). An unknown chunk is a 404.
 */
export function sitemapDocument(
  entries: readonly SitemapEntry[],
  part: number | null,
  site: URL | string | undefined | null,
  limit = SITEMAP_URL_LIMIT,
): SitemapDocument {
  const chunks = chunk(entries, limit);
  if (part === null) {
    if (chunks.length <= 1) return { status: 200, body: buildUrlset(entries) };
    return {
      status: 200,
      body: buildSitemapIndex(
        chunks.map((_, i) => ({ loc: absoluteUrl(`/sitemap-${i + 1}.xml`, site) })),
      ),
    };
  }
  if (!Number.isInteger(part) || part < 1 || part > Math.max(chunks.length, 1)) {
    return { status: 404, body: null };
  }
  return { status: 200, body: buildUrlset(chunks[part - 1] ?? []) };
}

/** The active toilets' ids, from the API (service binding or PUBLIC_API_URL). */
export async function fetchActiveLooIds(env: ApiEnv, url: URL): Promise<string[]> {
  const res = await fetchApi(env, url, "/api/loos/dump", {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`/api/loos/dump answered HTTP ${res.status}`);
  return idsFromDump(await res.json());
}

/** The Response for a sitemap document (503 with Retry-After when the API is down). */
export function sitemapResponse(document: SitemapDocument | null): Response {
  if (!document) {
    return new Response("The sitemap is temporarily unavailable.", {
      status: 503,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "retry-after": "600",
      },
    });
  }
  if (document.status !== 200 || document.body === null) {
    return new Response("Not found", {
      status: document.status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(document.body, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": SITEMAP_CACHE_CONTROL,
      "x-content-type-options": "nosniff",
    },
  });
}
