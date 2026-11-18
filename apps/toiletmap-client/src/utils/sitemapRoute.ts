/**
 * The request handler behind /sitemap.xml and /sitemap-<n>.xml (src/pages/), kept here so
 * both routes share it. Reads the content collections and the API's toilet dump.
 */

import { getCollection } from "astro:content";
import { env } from "cloudflare:workers";
import type { APIContext } from "astro";
import { fetchActiveLooIds, sitemapDocument, sitemapEntries, sitemapResponse } from "./sitemap";

export async function handleSitemap(context: APIContext, part: number | null): Promise<Response> {
  let looIds: string[];
  try {
    looIds = await fetchActiveLooIds(env, context.url);
  } catch (error) {
    // Better no sitemap for ten minutes than one that silently drops every toilet.
    console.error("Sitemap: could not list toilets:", error);
    return sitemapResponse(null);
  }
  const [pages, posts] = await Promise.all([getCollection("pages"), getCollection("posts")]);
  const entries = sitemapEntries({ site: context.site, pages, posts, looIds });
  return sitemapResponse(sitemapDocument(entries, part, context.site));
}
