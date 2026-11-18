import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { isLegacyGraphqlPath, proxyApiRequest, proxyLegacyGraphqlRequest } from "../../utils/api";

/**
 * Same-origin API proxy: the browser calls `/api/*` on this worker and we
 * forward allow-listed paths (currently `/api/loos[/...]`) to toiletmap-server,
 * attaching the httpOnly access token for state-changing requests. Other
 * paths get a 404. See `proxyApiRequest` / `isAllowedApiPath` for the rules.
 *
 * Exactly `/api` and `/api/` (the rest parameter matches them too) are the
 * legacy GraphQL API, proxied with no cookies or token to the server's
 * read-only `/api/graphql`; see `proxyLegacyGraphqlRequest`.
 */
export const prerender = false;

export const ALL: APIRoute = (context) => {
  const { request, cookies } = context;
  let clientIp = request.headers.get("cf-connecting-ip");
  if (!clientIp) {
    try {
      // Throws when the adapter cannot determine the address.
      clientIp = context.clientAddress;
    } catch {
      clientIp = null;
    }
  }

  if (isLegacyGraphqlPath(new URL(request.url).pathname)) {
    return proxyLegacyGraphqlRequest({ request, env, clientIp });
  }

  return proxyApiRequest({
    request,
    env,
    accessToken: cookies.get("access_token")?.value ?? null,
    clientIp,
  });
};
