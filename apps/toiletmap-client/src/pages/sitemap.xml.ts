import type { APIRoute } from "astro";
import { handleSitemap } from "../utils/sitemapRoute";

/**
 * The sitemap: one urlset, or an index of /sitemap-<n>.xml chunks once it passes 45,000
 * URLs (src/utils/sitemap.ts). Server-rendered, because the toilets come from the API.
 */
export const prerender = false;

export const GET: APIRoute = (context) => handleSitemap(context, null);
