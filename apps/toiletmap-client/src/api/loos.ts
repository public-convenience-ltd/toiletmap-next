import { get, set } from "idb-keyval";
import { getApiUrl } from "./config";
import { CACHE_KEYS } from "./constants";

/**
 * Metadata wrapper for cached data
 */
interface CachedData<T> {
  data: T;
  cachedAt: string; // ISO timestamp
  version: number; // Cache format version
}

const CACHE_VERSION = 1;

/**
 * Wraps data with metadata for caching
 */
function wrapWithMetadata<T>(data: T): CachedData<T> {
  return {
    data,
    cachedAt: new Date().toISOString(),
    version: CACHE_VERSION,
  };
}

/**
 * Safely unwraps cached data, handling both old and new formats
 */
function unwrapCacheData<T>(cached: unknown): T | null {
  if (!cached) return null;

  // Check if it's wrapped with metadata
  if (
    typeof cached === "object" &&
    cached !== null &&
    "data" in cached &&
    "cachedAt" in cached &&
    "version" in cached
  ) {
    return (cached as CachedData<T>).data;
  }

  // Old format without wrapper - return as-is
  return cached as T;
}

/**
 * Interface for individual loo (toilet) details.
 * This represents the full data returned from the API for a specific loo.
 */
export interface LooDetail {
  id: string;
  name: string;
  // Add other properties as needed based on the server response
  [key: string]: unknown;
}

/**
 * Fetches detailed information for a specific loo by ID.
 * Implements a cache-first strategy using IndexedDB for better performance.
 *
 * @param apiUrl - The base URL for the API server
 * @param id - The unique identifier of the loo
 * @returns The loo details if found, or null if not found or an error occurred
 *
 * @example
 * ```typescript
 * const loo = await getLooById('https://api.example.com', 'abc123');
 * if (loo) {
 *   console.log(`Found loo: ${loo.name}`);
 * }
 * ```
 */
/**
 * Fetches detailed information for a specific loo by ID.
 * Implements a cache-first strategy using IndexedDB for better performance.
 *
 * @param apiUrl - The base URL for the API server
 * @param id - The unique identifier of the loo
 * @returns The loo details if found, or null if not found or an error occurred
 */
export async function getLooById(apiUrl: string, id: string): Promise<LooDetail | null> {
  try {
    // 1. Try to get from cache
    const cached = await get(`loo:${id}`);
    const unwrapped = unwrapCacheData<LooDetail>(cached);
    if (unwrapped) {
      // console.log(`[Cache Hit] Loo ${id}`);
      return unwrapped;
    }

    // 2. Fetch from API
    console.log(`[API Fetch] Loo ${id}`);
    const response = await fetch(getApiUrl(apiUrl, `/api/loos/${id}`));

    if (!response.ok) {
      console.error(`Failed to fetch loo ${id}: ${response.statusText}`);
      return null;
    }

    const data = (await response.json()) as LooDetail;

    // 3. Save to cache with metadata
    await set(`loo:${id}`, wrapWithMetadata(data));

    return data;
  } catch (error) {
    console.error("Error getting loo details:", error);
    return null;
  }
}

/**
 * Fetches detailed information for multiple loos by their IDs.
 * Checks cache first, then fetches missing ones from API in a single batch request.
 *
 * @param apiUrl - The base URL for the API server
 * @param ids - Array of loo IDs to fetch
 * @returns Array of loo details
 */
export async function getLoosByIds(apiUrl: string, ids: string[]): Promise<LooDetail[]> {
  if (!ids.length) return [];

  const results: LooDetail[] = [];
  const missingIds: string[] = [];

  // 1. Check cache for each ID
  await Promise.all(
    ids.map(async (id) => {
      const cached = await get(`loo:${id}`);
      const unwrapped = unwrapCacheData<LooDetail>(cached);
      if (unwrapped) {
        results.push(unwrapped);
      } else {
        missingIds.push(id);
      }
    }),
  );

  // 2. Fetch missing IDs from API
  if (missingIds.length > 0) {
    console.log(`[API Fetch] Batch fetching ${missingIds.length} loos`);
    try {
      // Chunk requests if too many IDs (e.g., max 50 per request to be safe with URL length)
      const chunkSize = 50;
      for (let i = 0; i < missingIds.length; i += chunkSize) {
        const chunk = missingIds.slice(i, i + chunkSize);
        const params = new URLSearchParams();
        chunk.forEach((id) => {
          params.append("ids", id);
        });

        const response = await fetch(getApiUrl(apiUrl, `/api/loos?${params.toString()}`));

        if (response.ok) {
          const json = (await response.json()) as { data: LooDetail[] };
          const fetchedLoos = json.data;

          // 3. Save fetched loos to cache with metadata and add to results
          await Promise.all(
            fetchedLoos.map(async (loo) => {
              await set(`loo:${loo.id}`, wrapWithMetadata(loo));
              results.push(loo);
            }),
          );
        } else {
          console.error(`Failed to batch fetch loos: ${response.statusText}`);
        }
      }
    } catch (error) {
      console.error("Error batch fetching loos:", error);
    }
  }

  return results;
}

/**
 * Fetches the full rich dump of all loos and caches them.
 *
 * @param apiUrl - The base URL for the API server
 * @param onProgress - Callback for progress updates
 */
export async function fetchRichDump(
  apiUrl: string,
  onProgress?: (fetched: number, total: number) => void,
): Promise<void> {
  try {
    const response = await fetch(getApiUrl(apiUrl, "/api/loos/dump?rich=true"));
    if (!response.ok) throw new Error("Failed to fetch rich dump");

    // We need to handle the stream manually to report progress if possible,
    // but for now, let's just get the blob/json.
    // Since it's a large file, we might want to use a stream reader.
    // For simplicity in this first pass, we'll just await json.
    // NOTE: Progress for download is hard without Content-Length or stream reading.
    // We'll simulate "downloading" state or just wait.

    if (onProgress) onProgress(0, 100); // Indeterminate

    const json = (await response.json()) as { data: LooDetail[] };
    const loos = json.data;

    if (onProgress) onProgress(50, 100); // Downloaded, now caching

    // Cache all loos
    // Using a transaction or batch set would be better if idb-keyval supported it easily.
    // We'll just loop.
    let cachedCount = 0;
    const total = loos.length;

    // Chunk the caching to avoid blocking UI
    const chunkSize = 100;
    for (let i = 0; i < total; i += chunkSize) {
      const chunk = loos.slice(i, i + chunkSize);
      await Promise.all(chunk.map((loo) => set(`loo:${loo.id}`, wrapWithMetadata(loo))));
      cachedCount += chunk.length;
      if (onProgress) onProgress(50 + Math.round((cachedCount / total) * 50), 100);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (onProgress) onProgress(100, 100);

    // Set persistence flags to track that rich dump has been downloaded
    await set(CACHE_KEYS.RICH_DUMP_DOWNLOADED, true);
    await set(CACHE_KEYS.RICH_DUMP_TIMESTAMP, new Date().toISOString());
  } catch (error) {
    console.error("Error fetching rich dump:", error);
    throw error;
  }
}
