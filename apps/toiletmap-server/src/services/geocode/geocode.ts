/**
 * GB place search for the map's search boxes.
 *
 * Anything that looks like a UK postcode or outcode goes to postcodes.io
 * first. Everything else (and a postcode postcodes.io doesn't know) goes to
 * OpenStreetMap's Nominatim, following its usage policy
 * (https://operations.osmfoundation.org/policies/nominatim/): an identifying
 * User-Agent and Referer, at most one request per second, cached results and
 * no autocomplete.
 *
 * Two modes:
 * - `search` (an explicit search: Enter or the search button) may reach
 *   Nominatim;
 * - `suggest` (search-as-you-type) never does: it answers postcodes and
 *   outcodes from postcodes.io and nothing else, so typing never becomes
 *   Nominatim autocomplete traffic, however it reaches the server.
 *
 * Nominatim's limit is enforced in layers, because Workers run many isolates
 * in many locations: each isolate spaces its own requests a second apart and
 * refuses (GeocodeBusyError) rather than queue more than one; the caller's
 * `allowNominatim` check (the route uses a rate-limit binding with one shared
 * key, so all isolates in a location share a budget) can refuse too; and the
 * route limits explicit searches per client IP. Identical queries in flight
 * share one upstream call and recent results are kept in memory. The route
 * also puts results in the edge cache, but that does nothing on workers.dev
 * (until the custom domain), so it isn't relied on.
 */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type GeocodeKind = "postcode" | "place";

export interface GeocodeResult {
  /** Human-readable name, e.g. "SW1A 1AA, Westminster" or a Nominatim display name. */
  label: string;
  lat: number;
  lng: number;
  /** The result's extent as [west, south, east, north] (GeoJSON order), when known. */
  bbox?: [number, number, number, number];
  kind: GeocodeKind;
}

export interface GeocodeResponse {
  results: GeocodeResult[];
  /** Attribution the results require when shown (OpenStreetMap's for Nominatim), or null. */
  attribution: string | null;
}

/** Nominatim's own licence string for its results. */
export const OSM_ATTRIBUTION =
  "Data © OpenStreetMap contributors, ODbL 1.0. https://osm.org/copyright";

export const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
export const POSTCODES_IO_URL = "https://api.postcodes.io";
export const GEOCODER_USER_AGENT = "ToiletMap/1.0 (+https://www.toiletmap.org.uk)";
export const GEOCODER_REFERER = "https://www.toiletmap.org.uk/";

export const GEOCODE_QUERY_MIN_LENGTH = 2;
export const GEOCODE_QUERY_MAX_LENGTH = 200;
const RESULT_LIMIT = 5;

const NOMINATIM_TIMEOUT_MS = 5000;
const POSTCODES_TIMEOUT_MS = 3000;
/** Nominatim's absolute maximum is one request per second. */
const NOMINATIM_INTERVAL_MS = 1000;
/**
 * A request that would queue longer than this for a Nominatim slot is refused
 * instead: at most one request waits behind the one in progress.
 */
const NOMINATIM_MAX_WAIT_MS = NOMINATIM_INTERVAL_MS;

const MEMORY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MEMORY_CACHE_MAX_ENTRIES = 500;

const FULL_POSTCODE = /^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/;
const OUTCODE = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;

/** An upstream geocoder failed (HTTP error, timeout, unreadable body). */
export class GeocodeUpstreamError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GeocodeUpstreamError";
  }
}

/** Nominatim's budget is used up (queued requests here, or the shared budget). */
export class GeocodeBusyError extends Error {
  constructor() {
    super("Too many place searches at once");
    this.name = "GeocodeBusyError";
  }
}

/**
 * The query as it is searched and cached: Unicode-normalised, whitespace
 * collapsed, trimmed and lower-cased, so "  Trafalgar   Square" and
 * "trafalgar square" share one cache entry.
 */
export const normaliseQuery = (query: string): string =>
  query.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

/** "sw1a 1aa" → { kind: "postcode", code: "SW1A1AA" }, "m1" → outcode, else null. */
export const classifyPostcode = (
  query: string,
): { type: "postcode" | "outcode"; code: string } | null => {
  const compact = query.replace(/\s+/g, "").toUpperCase();
  if (FULL_POSTCODE.test(compact)) return { type: "postcode", code: compact };
  if (OUTCODE.test(compact)) return { type: "outcode", code: compact };
  return null;
};

const finiteNumber = (value: unknown): number | null => {
  const n =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

const validLatLng = (lat: number | null, lng: number | null): lat is number =>
  lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Nominatim's [south, north, west, east] strings → [west, south, east, north], or undefined. */
export const toBbox = (box: unknown): GeocodeResult["bbox"] => {
  if (!Array.isArray(box) || box.length !== 4) return undefined;
  const [south, north, west, east] = box.map(finiteNumber);
  if (south === null || north === null || west === null || east === null) return undefined;
  if (south > north || west > east) return undefined;
  if (south < -90 || north > 90 || west < -180 || east > 180) return undefined;
  return [west, south, east, north];
};

/** Every result is in Great Britain, so the country adds nothing to the label. */
const shortenLabel = (label: string): string => label.replace(/,\s*United Kingdom$/, "");

/** Maps a Nominatim jsonv2 search body to results, dropping anything unusable. */
export const mapNominatimResults = (body: unknown): GeocodeResult[] => {
  if (!Array.isArray(body)) throw new GeocodeUpstreamError("Nominatim returned a non-array body");
  const results: GeocodeResult[] = [];
  for (const item of body) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const lat = finiteNumber(record.lat);
    const lng = finiteNumber(record.lon);
    if (!validLatLng(lat, lng) || lng === null) continue;
    if (typeof record.display_name !== "string" || !record.display_name.trim()) continue;
    const bbox = toBbox(record.boundingbox);
    results.push({
      label: shortenLabel(record.display_name.trim()),
      lat,
      lng,
      ...(bbox ? { bbox } : {}),
      kind: "place",
    });
    if (results.length === RESULT_LIMIT) break;
  }
  return results;
};

/** Maps a postcodes.io `/postcodes/<pc>` or `/outcodes/<oc>` result, or null without coordinates. */
export const mapPostcodeResult = (
  result: unknown,
  type: "postcode" | "outcode",
): GeocodeResult | null => {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  const lat = finiteNumber(record.latitude);
  const lng = finiteNumber(record.longitude);
  if (!validLatLng(lat, lng) || lng === null) return null;
  const code = type === "postcode" ? record.postcode : record.outcode;
  if (typeof code !== "string" || !code) return null;
  // /postcodes gives one district as a string; /outcodes lists every district it spans.
  const district = Array.isArray(record.admin_district)
    ? record.admin_district.find((d): d is string => typeof d === "string" && d.length > 0)
    : typeof record.admin_district === "string"
      ? record.admin_district
      : undefined;
  return {
    label: district ? `${code}, ${district}` : code,
    lat,
    lng,
    kind: "postcode",
  };
};

const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

export interface GeocoderOptions {
  fetchImpl?: FetchLike;
  /** Milliseconds since the epoch (tests inject a fake clock). */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** `search` may use Nominatim; `suggest` (typing) only ever looks postcodes up. */
export type GeocodeMode = "search" | "suggest";

export interface SearchOptions {
  /** Defaults to `search`. */
  mode?: GeocodeMode;
  /**
   * Asked right before each Nominatim request: false refuses it with a
   * GeocodeBusyError. The route checks a budget shared across isolates here.
   */
  allowNominatim?: () => Promise<boolean>;
}

export interface Geocoder {
  /** Searches for `query`, which must already be normalised ({@link normaliseQuery}). */
  search(query: string, options?: SearchOptions): Promise<GeocodeResponse>;
}

const NO_RESULTS: GeocodeResponse = { results: [], attribution: null };

export const createGeocoder = ({
  fetchImpl = (input, init) => fetch(input, init),
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: GeocoderOptions = {}): Geocoder => {
  /** Earliest time the next Nominatim request may start, in this isolate. */
  let nextNominatimSlot = 0;
  const inFlight = new Map<string, Promise<GeocodeResponse>>();
  const memory = new Map<string, { expires: number; value: GeocodeResponse }>();

  const waitForNominatimSlot = async () => {
    const current = now();
    const start = Math.max(current, nextNominatimSlot);
    const wait = start - current;
    if (wait > NOMINATIM_MAX_WAIT_MS) throw new GeocodeBusyError();
    nextNominatimSlot = start + NOMINATIM_INTERVAL_MS;
    if (wait > 0) await sleep(wait);
  };

  const getJson = async (url: string, timeoutMs: number, headers: Record<string, string>) => {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: "application/json", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new GeocodeUpstreamError(`Request failed (${describeError(error)})`, { cause: error });
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch (error) {
      if (response.ok) {
        throw new GeocodeUpstreamError("Unreadable response body", { cause: error });
      }
    }
    return { status: response.status, ok: response.ok, body };
  };

  /** A postcode or outcode via postcodes.io; null when it is unknown or has no coordinates. */
  const searchPostcode = async (
    code: string,
    type: "postcode" | "outcode",
  ): Promise<GeocodeResult | null> => {
    const path = type === "postcode" ? "postcodes" : "outcodes";
    const { status, ok, body } = await getJson(
      `${POSTCODES_IO_URL}/${path}/${encodeURIComponent(code)}`,
      POSTCODES_TIMEOUT_MS,
      { "user-agent": GEOCODER_USER_AGENT },
    );
    if (status === 404) return null;
    if (!ok) throw new GeocodeUpstreamError(`postcodes.io answered ${status}`);
    return mapPostcodeResult((body as { result?: unknown } | null)?.result, type);
  };

  const searchNominatim = async (
    query: string,
    allowNominatim: SearchOptions["allowNominatim"],
  ): Promise<GeocodeResult[]> => {
    await waitForNominatimSlot();
    if (allowNominatim && !(await allowNominatim())) throw new GeocodeBusyError();
    const params = new URLSearchParams({
      q: query,
      format: "jsonv2",
      countrycodes: "gb",
      limit: String(RESULT_LIMIT),
      addressdetails: "1",
      "accept-language": "en-GB",
    });
    const { status, ok, body } = await getJson(
      `${NOMINATIM_SEARCH_URL}?${params.toString()}`,
      NOMINATIM_TIMEOUT_MS,
      { "user-agent": GEOCODER_USER_AGENT, referer: GEOCODER_REFERER },
    );
    if (!ok) throw new GeocodeUpstreamError(`Nominatim answered ${status}`);
    return mapNominatimResults(body);
  };

  const lookup = async (
    query: string,
    { mode = "search", allowNominatim }: SearchOptions,
  ): Promise<GeocodeResponse> => {
    const postcode = classifyPostcode(query);
    if (mode === "suggest") {
      // Typing: postcodes.io only (its errors are reported), never Nominatim.
      if (!postcode) return NO_RESULTS;
      const hit = await searchPostcode(postcode.code, postcode.type);
      return hit ? { results: [hit], attribution: null } : NO_RESULTS;
    }
    let postcodeError: unknown = null;
    if (postcode) {
      try {
        const hit = await searchPostcode(postcode.code, postcode.type);
        if (hit) return { results: [hit], attribution: null };
      } catch (error) {
        // Not fatal: Nominatim knows most postcodes too.
        postcodeError = error;
      }
    }
    try {
      const results = await searchNominatim(query, allowNominatim);
      return { results, attribution: OSM_ATTRIBUTION };
    } catch (error) {
      if (postcodeError && error instanceof GeocodeUpstreamError) {
        throw new GeocodeUpstreamError(
          `${error.message}; postcodes.io: ${describeError(postcodeError)}`,
          {
            cause: error,
          },
        );
      }
      throw error;
    }
  };

  const remember = (query: string, value: GeocodeResponse) => {
    memory.delete(query);
    memory.set(query, { expires: now() + MEMORY_CACHE_TTL_MS, value });
    while (memory.size > MEMORY_CACHE_MAX_ENTRIES) {
      const oldest = memory.keys().next().value;
      if (oldest === undefined) break;
      memory.delete(oldest);
    }
  };

  return {
    search(query, options = {}) {
      const key = `${options.mode ?? "search"}:${query}`;
      const cached = memory.get(key);
      if (cached && cached.expires > now()) return Promise.resolve(cached.value);
      if (cached) memory.delete(key);

      const pending = inFlight.get(key);
      if (pending) return pending;

      const request = lookup(query, options)
        .then((value) => {
          remember(key, value);
          return value;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, request);
      return request;
    },
  };
};
