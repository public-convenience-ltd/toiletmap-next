export const RECENT_WINDOW_DAYS = 30;

/**
 * The required length for loo IDs.
 * IDs are 24 characters (12 bytes in hex encoding).
 */
export const LOO_ID_LENGTH = 24;

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

/**
 * Largest row offset (`(page - 1) * limit`) the search endpoint accepts. The
 * whole dataset, inactive loos included, is a few tens of thousands of rows,
 * so every page the admin explorer offers fits even at 10 per page; it only
 * stops absurd offsets.
 */
export const MAX_SEARCH_OFFSET = 100_000;

/** Highest `page` the search endpoint accepts (reachable only at `limit=1`). */
export const MAX_SEARCH_PAGE = MAX_SEARCH_OFFSET + 1;

/** Most ids one `GET /api/loos?ids=` request may ask for (after removing duplicates). */
export const MAX_IDS_PER_REQUEST = 100;

/**
 * Geohash prefixes for `GET /api/loos/geohash/:geohash`: base32 characters
 * only, at least 4 (a cell about 39 km by 20 km; the legacy GraphQL API calls
 * shorter prefixes "broad") and at most 12 (full geohash precision).
 */
export const MIN_GEOHASH_PREFIX_LENGTH = 4;
export const MAX_GEOHASH_PREFIX_LENGTH = 12;

/**
 * Proximity searches wider than this (metres) count as heavy reads and take
 * the stricter per-IP limit. The website asks for 100-150 m and the Flutter
 * app's radius setting tops out at 5000 m.
 */
export const HEAVY_PROXIMITY_RADIUS = 5000;

/**
 * Decimal places proximity `lat`/`lng` are rounded to (about 1 m) before the
 * query and the edge-cache key, so near-identical coordinates share one
 * cache entry instead of each minting a new one.
 */
export const PROXIMITY_COORDINATE_DECIMALS = 5;
