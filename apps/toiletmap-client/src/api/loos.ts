import { get, set } from "idb-keyval";

const LOO_DETAIL_CACHE_KEY = "loos-detail-cache";

export interface LooDetail {
  id: string;
  name: string;
  // Add other properties as needed based on the server response
  [key: string]: unknown;
}

export async function getLooById(id: string): Promise<LooDetail | null> {
  try {
    // 1. Try to get from cache
    const cache = (await get(LOO_DETAIL_CACHE_KEY)) || {};
    if (cache[id]) {
      console.log(`[Cache Hit] Loo ${id}`);
      return cache[id];
    }

    // 2. Fetch from API
    console.log(`[API Fetch] Loo ${id}`);
    const response = await fetch(`http://localhost:8787/api/loos/${id}`);

    if (!response.ok) {
      console.error(`Failed to fetch loo ${id}: ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    // 3. Save to cache
    cache[id] = data;
    await set(LOO_DETAIL_CACHE_KEY, cache);

    return data;
  } catch (error) {
    console.error("Error getting loo details:", error);
    return null;
  }
}
