/**
 * Server-side loading of one toilet for its pages (/loos/:id, /edit, /remove). The fetch goes
 * straight upstream (service binding or PUBLIC_API_URL, see fetchApi), not through the
 * browser's /api proxy, to the same `GET /api/loos/:id` the details panel uses.
 *
 * Nothing in this module may be imported by browser islands.
 */
import type { LooDetail } from "../api/loos";
import { type ApiEnv, fetchApi } from "./api";

export type LooLoad =
  | { kind: "found"; loo: LooDetail }
  /** No such toilet, or an id the API rejects (400): the page answers 404. */
  | { kind: "not-found" }
  /** The API failed or could not be reached: the page decides how to degrade. */
  | { kind: "unavailable"; status: number | null };

/**
 * Ids are 24 characters today; anything far outside what the API could accept (empty, very
 * long, or with characters that never appear in an id) is a 404 without a request.
 */
const PLAUSIBLE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isPlausibleLooId(id: string | null | undefined): id is string {
  return typeof id === "string" && PLAUSIBLE_ID.test(id);
}

export interface LoadLooOptions {
  env: ApiEnv;
  /** The page's URL (picks the matching preview server, see getUpstreamApiUrl). */
  url: URL;
  id: string | null | undefined;
  /** The visitor's IP, forwarded so the API's rate limits see them, not the worker. */
  clientIp?: string | null;
  /** Used in log lines, e.g. "the details page". */
  purpose?: string;
  /**
   * Give up after this many milliseconds (the response and its body) and report the API as
   * unavailable. Unset: wait as long as the platform allows.
   */
  timeoutMs?: number;
}

/** How long the /loos/:id map page waits for the toilet before rendering without it. */
export const LOO_PAGE_TIMEOUT_MS = 2500;

class LooLoadTimeout extends Error {
  override name = "TimeoutError";
}

/** `promise`, or a LooLoadTimeout once `signal` aborts (mocked fetches may ignore signals). */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new LooLoadTimeout());
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export async function loadLoo({
  env,
  url,
  id,
  clientIp,
  purpose = "a page",
  timeoutMs,
}: LoadLooOptions): Promise<LooLoad> {
  if (!isPlausibleLooId(id)) return { kind: "not-found" };
  const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
  try {
    const res = await untilAborted(
      fetchApi(env, url, `/api/loos/${encodeURIComponent(id)}`, {
        headers: {
          accept: "application/json",
          ...(clientIp ? { "cf-connecting-ip": clientIp, "x-forwarded-for": clientIp } : {}),
        },
        signal,
      }),
      signal,
    );
    if (res.status === 404 || res.status === 400) return { kind: "not-found" };
    if (!res.ok) {
      console.error(`Failed to load loo ${id} for ${purpose}: HTTP ${res.status}`);
      return { kind: "unavailable", status: res.status };
    }
    const loo = (await untilAborted(res.json(), signal)) as LooDetail;
    if (!loo || typeof loo !== "object" || typeof loo.id !== "string") {
      console.error(`Failed to load loo ${id} for ${purpose}: unexpected body`);
      return { kind: "unavailable", status: res.status };
    }
    return { kind: "found", loo };
  } catch (error) {
    if (signal?.aborted) {
      console.error(`Failed to load loo ${id} for ${purpose}: timed out after ${timeoutMs} ms`);
    } else {
      console.error(`Failed to load loo ${id} for ${purpose}:`, error);
    }
    return { kind: "unavailable", status: null };
  }
}

/**
 * A body-less 404 for a page to return from its frontmatter: Astro then renders the site's
 * own 404 page (src/pages/404.astro) with that status.
 */
export const notFoundResponse = (): Response =>
  new Response(null, { status: 404, statusText: "Not Found" });
