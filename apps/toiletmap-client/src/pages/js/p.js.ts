import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { proxyPlausibleScript, type ScriptCache } from "../../utils/plausible";

/**
 * `GET /js/p.js`: Plausible's script served from our own origin (src/utils/plausible.ts),
 * cached in the Workers edge cache. A 404 unless PLAUSIBLE_DOMAIN is set.
 */
export const prerender = false;

/** `caches.default` in workerd; absent in Node and other runtimes. */
const edgeCache = (): ScriptCache | null => {
  const storage = (globalThis as { caches?: { default?: ScriptCache } }).caches;
  return storage?.default ?? null;
};

export const ALL: APIRoute = ({ request, locals }) =>
  proxyPlausibleScript({
    env,
    request,
    cache: edgeCache(),
    waitUntil: (promise) => locals.cfContext?.waitUntil(promise),
  });
