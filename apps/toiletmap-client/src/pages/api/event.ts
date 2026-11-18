import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { proxyPlausibleEvent } from "../../utils/plausible";

/**
 * `POST /api/event`: Plausible events, forwarded to plausible.io (src/utils/plausible.ts).
 * A 404 unless PLAUSIBLE_DOMAIN is set. As a static route it takes priority over the
 * generic `/api/[...path]` proxy, which would otherwise answer it (and never forwards
 * it upstream: `/api/event` is not in that proxy's allow-list).
 */
export const prerender = false;

export const ALL: APIRoute = (context) => {
  const { request } = context;
  let clientIp = request.headers.get("cf-connecting-ip");
  if (!clientIp) {
    try {
      // Throws when the adapter cannot determine the address.
      clientIp = context.clientAddress;
    } catch {
      clientIp = null;
    }
  }
  return proxyPlausibleEvent({ env, request, clientIp });
};
