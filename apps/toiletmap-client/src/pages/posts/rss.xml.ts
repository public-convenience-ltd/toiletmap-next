import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { buildRss, RSS_HEADERS } from "../../utils/rss";

/**
 * The blog's RSS feed. Prerendered: posts only change with a deploy (the CMS commits to
 * git), so the built file is always current.
 */
export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  const posts = await getCollection("posts");
  return new Response(buildRss({ site, posts }), { headers: RSS_HEADERS });
};
