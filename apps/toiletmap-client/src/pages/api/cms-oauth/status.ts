import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { cmsOAuthConfig } from "../../../utils/cmsOAuth";

/**
 * GET /api/cms-oauth/status: `{"configured": true|false}`, whether GitHub sign-in is set up.
 * The CMS page (public/cms/index.html) asks first, so that until it is it can say so
 * instead of offering a sign-in button that can only fail. Reveals nothing else.
 */
export const prerender = false;

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ configured: cmsOAuthConfig(env) !== null }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
