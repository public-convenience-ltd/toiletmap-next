import type { APIRoute } from "astro";
import { sitemapResponse } from "../utils/sitemap";
import { handleSitemap } from "../utils/sitemapRoute";

/** One chunk of a sitemap too big for one file: /sitemap-1.xml, /sitemap-2.xml, ... */
export const prerender = false;

export const GET: APIRoute = (context) => {
  const raw = context.params.part ?? "";
  if (!/^[1-9][0-9]{0,4}$/.test(raw)) return sitemapResponse({ status: 404, body: null });
  return handleSitemap(context, Number(raw));
};
