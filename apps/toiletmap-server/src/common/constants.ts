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

/**
 * Loo ids: 24 lowercase hexadecimal characters (12 random bytes, the format
 * of the legacy MongoDB ObjectIds and of `generateLooId`). Inputs are
 * lowercased before they are checked.
 */
export const LOO_ID_PATTERN = /^[0-9a-f]{24}$/;

/**
 * The box a non-admin may place a toilet in (WGS84 degrees). It covers Great
 * Britain (St Kilda at 8.6°W, Muckle Flugga at 60.86°N, Lowestoft at
 * 1.76°E, the Isles of Scilly), Northern Ireland (to 8.18°W), the Isle of Man
 * and the Channel Islands (Les Minquiers at 48.97°N). A box is deliberately
 * coarse: it also takes in Ireland and the north coast of France, and only
 * stops gross mistakes such as swapped lat/lng, 0,0 or another continent.
 * Admins may write any valid coordinate.
 */
export const SERVICE_AREA_BOUNDS = {
  minLat: 48.9,
  maxLat: 61.0,
  minLng: -8.7,
  maxLng: 1.9,
} as const;

/**
 * Furthest (metres) a non-admin may move an existing toilet directly. A
 * bigger move is queued for moderation even for a trusted contributor
 * (matches the client's "big move" warning).
 */
export const MAX_DIRECT_MOVE_METRES = 50;
