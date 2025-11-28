export const RECENT_WINDOW_DAYS = 30;

/**
 * The required length for loo IDs.
 * IDs are 24 characters (12 bytes in hex encoding).
 */
export const LOO_ID_LENGTH = 24;

/**
 * Maximum number of entries allowed in the in-memory rate limiter store
 * before old entries are pruned
 */
export const MAX_RATE_LIMIT_STORE_SIZE = 10000;

/**
 * Maximum number of results that can be returned in a search query
 */
export const MAX_SEARCH_LIMIT = 200;

/**
 * Minimum number of results that can be requested in a search query
 */
export const MIN_SEARCH_LIMIT = 1;

/**
 * Default proximity radius in meters when searching for nearby loos
 */
export const DEFAULT_PROXIMITY_RADIUS = 1000;

/**
 * Maximum proximity radius in meters for nearby loo searches
 */
export const MAX_PROXIMITY_RADIUS = 50000;
