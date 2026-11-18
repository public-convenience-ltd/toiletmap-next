import { env } from "cloudflare:workers";
import type { MiddlewareHandler } from "astro";
import { knownInlineScriptHashes } from "./utils/inlineScripts";
import { applySecurityHeaders } from "./utils/securityHeaders";

/**
 * Security headers and the Content Security Policy for every response the worker renders
 * (pages, endpoints, the API proxy, redirects). script-src allows the inline scripts the site
 * ships (src/utils/inlineScripts.ts), never ones found in the response. Static assets never
 * reach the worker: the build puts the same headers in _headers
 * (src/integrations/securityHeaders.ts). See docs/security.md.
 *
 * Legacy URL redirects are routes, not middleware (src/utils/legacyRedirects.ts): a route
 * always matches, whereas middleware doesn't run for a path that falls through to the
 * prerendered catch-all in `astro dev`.
 */
export const onRequest: MiddlewareHandler = async (context, next) => {
  const response = await next();
  const dev = import.meta.env.DEV;
  return applySecurityHeaders(response, {
    url: context.url,
    scriptHashes: await knownInlineScriptHashes(),
    environment: env.ENVIRONMENT,
    dev,
  });
};
