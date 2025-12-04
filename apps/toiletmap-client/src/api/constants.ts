/**
 * Constants for the Toilet Map client application.
 * Centralizes cache keys and configuration values to avoid magic strings.
 */

/**
 * Cache configuration
 */
export const CACHE_KEYS = {
  /** Cache key for the compressed list of all loos */
  LOOS_LIST: "loos-cache",
  /** Cache key for the timestamp of the loos list cache */
  LOOS_LIST_TIME: "loos-cache-time",
  /** Cache key for individual loo details */
  LOO_DETAIL: "loos-detail-cache",
  /** Cache key for the last time the loos list was updated */
  LAST_UPDATED: "loos-last-updated",
  /** Cache key to track if rich dump has been downloaded */
  RICH_DUMP_DOWNLOADED: "rich-dump-downloaded",
  /** Cache key for the timestamp when rich dump was downloaded */
  RICH_DUMP_TIMESTAMP: "rich-dump-timestamp",
} as const;

/**
 * Cache duration in milliseconds (1 hour)
 */
export const CACHE_DURATION = 1000 * 60 * 60;
