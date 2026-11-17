import type { APIRoute } from "astro";

/**
 * Legacy `/loo/*` URLs (used briefly by the new client) permanently redirect
 * to the canonical `/loos/*` scheme, preserving the query string.
 */
export const prerender = false;

export const ALL: APIRoute = ({ url }) => {
  const rest = url.pathname.replace(/^\/loo\/?/, "");
  const location = `${rest ? `/loos/${rest}` : "/"}${url.search}`;
  return new Response(null, { status: 301, headers: { Location: location } });
};
