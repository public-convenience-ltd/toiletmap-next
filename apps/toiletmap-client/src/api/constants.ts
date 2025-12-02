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
} as const;

/**
 * Cache duration in milliseconds (1 hour)
 */
export const CACHE_DURATION = 1000 * 60 * 60;
