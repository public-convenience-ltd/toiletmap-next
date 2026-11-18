import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { ROBOTS_CACHE_CONTROL, robotsTxt } from "../utils/robots";

/** Server-rendered: what it says depends on the deployment (ENVIRONMENT). */
export const prerender = false;

export const GET: APIRoute = ({ site }) =>
  new Response(robotsTxt({ environment: env.ENVIRONMENT, site }), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": ROBOTS_CACHE_CONTROL,
    },
  });
