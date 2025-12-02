import { get, set } from "idb-keyval";
import { getApiUrl } from "./config";
import { CACHE_KEYS } from "./constants";

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
 * Cache structure for storing loo details in IndexedDB.
 */
interface LooDetailCache {
  [id: string]: LooDetail;
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
export async function getLooById(apiUrl: string, id: string): Promise<LooDetail | null> {
  try {
    // 1. Try to get from cache
    const cache: LooDetailCache = (await get(CACHE_KEYS.LOO_DETAIL)) || {};
    if (cache[id]) {
      console.log(`[Cache Hit] Loo ${id}`);
      return cache[id];
    }

    // 2. Fetch from API
    console.log(`[API Fetch] Loo ${id}`);
    const response = await fetch(getApiUrl(apiUrl, `/api/loos/${id}`));

    if (!response.ok) {
      console.error(`Failed to fetch loo ${id}: ${response.statusText}`);
      return null;
    }

    const data = (await response.json()) as LooDetail;

    // 3. Save to cache
    cache[id] = data;
    await set(CACHE_KEYS.LOO_DETAIL, cache);

    return data;
  } catch (error) {
    console.error("Error getting loo details:", error);
    return null;
  }
}
