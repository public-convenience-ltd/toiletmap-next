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

/**
 * The Cloudflare adapter puts the worker's ExecutionContext on `locals.cfContext`, but the
 * adapter version in use doesn't declare it on `App.Locals`, so read it through a narrow type.
 */
type WithExecutionContext = { cfContext?: { waitUntil(promise: Promise<unknown>): void } };

export const ALL: APIRoute = ({ request, locals }) =>
  proxyPlausibleScript({
    env,
    request,
    cache: edgeCache(),
    waitUntil: (promise) => (locals as WithExecutionContext).cfContext?.waitUntil(promise),
  });
