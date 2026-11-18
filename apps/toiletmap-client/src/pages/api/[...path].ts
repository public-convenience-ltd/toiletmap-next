import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { proxyApiRequest } from "../../utils/api";

/**
 * Same-origin API proxy: the browser calls `/api/*` on this worker and we
 * forward allow-listed paths (`/api/loos[/...]`, the public `POST
 * /api/feedback` and `GET /api/geocode`) to toiletmap-server,
 * attaching the httpOnly access token for state-changing requests. Other
 * paths get a 404. See `proxyApiRequest` / `isAllowedApiPath` for the rules.
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

  return proxyApiRequest({
    request,
    env,
    accessToken: cookies.get("access_token")?.value ?? null,
    clientIp,
  });
};
