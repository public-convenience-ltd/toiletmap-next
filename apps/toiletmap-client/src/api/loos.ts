import { getApiUrl } from "./config";

export interface LooDetail {
  id: string;
  name: string | null;
  location: { lat: number; lng: number } | null;
  accessible: boolean | null;
  allGender: boolean | null;
  men: boolean | null;
  women: boolean | null;
  children: boolean | null;
  babyChange: boolean | null;
  radar: boolean | null;
  automatic: boolean | null;
  noPayment: boolean | null;
  paymentDetails: string | null;
  openingTimes: ([string, string] | [])[] | null;
  updatedAt: string | null;
  notes?: string | null;
  active?: boolean | null;
  removalReason?: string | null;
  urinalOnly?: boolean | null;
  attended?: boolean | null;
  createdAt?: string | null;
  verifiedAt?: string | null;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// In-memory detail cache (LRU) with ETag revalidation
// ---------------------------------------------------------------------------

/** Maximum number of loo details kept in memory. */
export const LOO_DETAIL_CACHE_SIZE = 200;

interface DetailEntry {
  loo: LooDetail;
  etag: string | null;
}

// A Map iterates in insertion order, so re-inserting on access makes the
// first key the least recently used one.
const detailCache = new Map<string, DetailEntry>();

const touch = (id: string, entry: DetailEntry) => {
  detailCache.delete(id);
  detailCache.set(id, entry);
  while (detailCache.size > LOO_DETAIL_CACHE_SIZE) {
    const oldest = detailCache.keys().next().value;
    if (oldest === undefined) break;
    detailCache.delete(oldest);
  }
};

/**
 * Seeds the detail cache (tests, or a caller that already holds a server
 * response in this page). Without an `etag` the next `getLooById` does a full
 * (unconditional) fetch.
 */
export function primeLooDetail(loo: LooDetail, etag: string | null = null): void {
  touch(loo.id, { loo, etag });
}

/** Drops one loo from the detail cache. */
export function evictLooDetail(id: string): void {
  detailCache.delete(id);
}

/** Returns the cached detail without any network request (or null). */
export function peekLooDetail(id: string): LooDetail | null {
  return detailCache.get(id)?.loo ?? null;
}

/** Test helper: empties the detail cache. */
export function clearLooDetailCache(): void {
  detailCache.clear();
}

export interface GetLooByIdOptions {
  /**
   * When true (default) a cached entry is revalidated with the server using
   * `If-None-Match`; a 304 keeps (and returns) the cached object. When false a
   * cached entry is returned without any request.
   */
  revalidate?: boolean;
}

export interface LooDetailResult {
  /** The loo, the cached copy when the request failed, or null (404, or failed with nothing cached). */
  loo: LooDetail | null;
  /**
   * True when the server answered for this request (200, 304, or 404, which is
   * definitive: the loo is gone). False when the request failed (network error,
   * 5xx, bad body) or was skipped (`revalidate: false`), so `loo` may be out of date.
   */
  fresh: boolean;
}

/**
 * Fetches a loo's details through the in-memory cache and says whether the
 * server confirmed the result. Returns the cached object itself when the
 * server answers 304 (so callers can compare identity to detect "no change").
 */
export async function getLooDetail(
  apiUrl: string,
  id: string,
  { revalidate = true }: GetLooByIdOptions = {},
): Promise<LooDetailResult> {
  const cached = detailCache.get(id);
  if (cached && !revalidate) {
    touch(id, cached);
    return { loo: cached.loo, fresh: false };
  }

  const headers: Record<string, string> = {};
  if (cached?.etag) headers["If-None-Match"] = cached.etag;

  try {
    const response = await fetch(getApiUrl(apiUrl, `/api/loos/${encodeURIComponent(id)}`), {
      headers,
    });
    if (response.status === 304 && cached) {
      touch(id, cached);
      return { loo: cached.loo, fresh: true };
    }
    if (response.status === 404) {
      evictLooDetail(id);
      return { loo: null, fresh: true };
    }
    if (!response.ok) {
      console.error(`Failed to fetch loo ${id}: ${response.status} ${response.statusText}`);
      return { loo: cached?.loo ?? null, fresh: false };
    }
    const loo = (await response.json()) as LooDetail;
    touch(id, { loo, etag: response.headers?.get?.("ETag") ?? null });
    return { loo, fresh: true };
  } catch (error) {
    console.error("Error getting loo details:", error);
    return { loo: cached?.loo ?? null, fresh: false };
  }
}

/**
 * {@link getLooDetail} without the freshness flag: falls back to the cached
 * copy when the request fails, and returns null only on a 404 or when nothing
 * is cached and the request failed. Use getLooDetail where a stale copy must
 * not be mistaken for the server's answer.
 */
export async function getLooById(
  apiUrl: string,
  id: string,
  options: GetLooByIdOptions = {},
): Promise<LooDetail | null> {
  return (await getLooDetail(apiUrl, id, options)).loo;
}

export async function getLoosByIds(apiUrl: string, ids: string[]): Promise<LooDetail[]> {
  if (!ids.length) return [];

  const results: LooDetail[] = [];
  const chunkSize = 50;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const params = new URLSearchParams();
    for (const id of chunk) params.append("ids", id);

    try {
      const response = await fetch(getApiUrl(apiUrl, `/api/loos?${params.toString()}`));
      if (response.ok) {
        const json = (await response.json()) as { data: LooDetail[] };
        results.push(...json.data);
      } else {
        console.error(`Failed to batch fetch loos: ${response.statusText}`);
      }
    } catch (error) {
      console.error("Error batch fetching loos:", error);
    }
  }

  return results;
}
