/** IndexedDB key of the versioned map dataset record (see src/api/mapCache.ts). */
export const MAP_CACHE_KEY = "loos-cache-v2";

/**
 * @deprecated Pre-v2 map cache keys (separate list + client-clock timestamp).
 * `loadMapCache()` deletes them on first load. Use `applyLocalMutation()` /
 * `clearMapCache()` from src/api/mapCache.ts instead of touching these.
 */
export const CACHE_KEYS = {
  LOOS_LIST: "loos-cache",
  LAST_UPDATED: "loos-last-updated",
} as const;

export const LEGACY_CACHE_KEYS: readonly string[] = [CACHE_KEYS.LOOS_LIST, CACHE_KEYS.LAST_UPDATED];
