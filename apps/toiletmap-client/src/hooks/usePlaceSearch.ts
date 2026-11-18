import type L from "leaflet";
import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

/**
 * One result from toiletmap-server's `GET /api/geocode` (postcodes.io, then
 * OpenStreetMap's Nominatim, GB only), reached through the same-origin
 * `/api/*` proxy. The browser never calls a geocoder directly.
 *
 * Nominatim forbids autocomplete, so typing only looks up postcode-shaped input
 * (`mode=suggest`, which the server never sends to Nominatim); a place name is
 * searched when the person asks (Enter or a search button: `searchNow`).
 * Until then `awaitingSubmit` is true, so the box can say how to search.
 */
export interface PlaceResult {
  label: string;
  lat: number;
  lng: number;
  /** The result's extent as [west, south, east, north], when known. */
  bbox?: [number, number, number, number];
  kind: "postcode" | "place";
}

interface GeocodeResponse {
  results?: unknown;
  /** Attribution the results must be shown with (OpenStreetMap's for Nominatim), or null. */
  attribution?: unknown;
}

interface UsePlaceSearchOptions {
  /** Map to pan/zoom when a suggestion is selected. Selecting never moves anything else. */
  mapRef?: RefObject<L.Map | null>;
  /** Zoom level used when panning to a selected suggestion. Defaults to 15. */
  selectZoom?: number;
  /**
   * Fit the map to the result's bounding box (a street, a park, a town) instead of centring on
   * its point at `selectZoom`, never zooming in beyond `maxZoom`. Results without a usable box
   * still centre at `selectZoom`. Off by default.
   */
  fitResultBounds?: boolean;
  /** The closest `fitResultBounds` will zoom in. Defaults to 18. */
  maxZoom?: number;
  /**
   * @deprecated Kept for backward compatibility. Prefer panning via `mapRef`;
   * search results must not be written into a toilet's location.
   */
  onSelect?: (lat: number, lng: number) => void;
}

export const GEOCODE_PATH = "/api/geocode";
/** Typing waits this long before looking a postcode up. */
export const SEARCH_DEBOUNCE_MS = 400;
/** The shortest query searched: an outcode such as "M1". */
export const MIN_SUBMITTED_QUERY_LENGTH = 2;
/** A busy geocoder (503) is asked once more after its Retry-After, capped at this. */
export const MAX_RETRY_WAIT_MS = 3000;

const FULL_POSTCODE = /^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/;
const OUTCODE = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;

/** Shaped like a UK postcode ("SW1A 1AA") or outcode ("M1", "SW1A"): looked up while typing. */
export function looksLikePostcode(value: string): boolean {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  return FULL_POSTCODE.test(compact) || OUTCODE.test(compact);
}

type SearchMode = "search" | "suggest";
const DEFAULT_SELECT_ZOOM = 15;
const DEFAULT_MAX_ZOOM = 18;

/** [[south, west], [north, east]] from a result's [west, south, east, north] box, or null. */
export function resultBounds(
  result: Pick<PlaceResult, "bbox">,
): [[number, number], [number, number]] | null {
  const box = result.bbox;
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [west, south, east, north] = box;
  if (![south, north, west, east].every(Number.isFinite)) return null;
  if (south > north || west > east) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180) return null;
  return [
    [south, west],
    [north, east],
  ];
}

const isPlaceResult = (value: unknown): value is PlaceResult => {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.label === "string" &&
    typeof r.lat === "number" &&
    Number.isFinite(r.lat) &&
    typeof r.lng === "number" &&
    Number.isFinite(r.lng)
  );
};

const buildSearchUrl = (query: string, mode: SearchMode) =>
  `${GEOCODE_PATH}?${new URLSearchParams(mode === "suggest" ? { q: query, mode } : { q: query }).toString()}`;

/** How long a 503's Retry-After asks to wait (seconds), in ms, capped; 2 s when unreadable. */
const retryDelay = (response: Response): number => {
  const seconds = Number(response.headers.get("Retry-After"));
  const ms = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 2000;
  return Math.min(ms, MAX_RETRY_WAIT_MS);
};

/** Resolves after `ms`, or as soon as `signal` aborts. */
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

export function usePlaceSearch(options: UsePlaceSearchOptions = {}) {
  const {
    mapRef,
    onSelect,
    selectZoom = DEFAULT_SELECT_ZOOM,
    fitResultBounds = false,
    maxZoom = DEFAULT_MAX_ZOOM,
  } = options;
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceResult[]>([]);
  /** Attribution for the current suggestions (null when none is needed). */
  const [attribution, setAttribution] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  /** The latest search for the current query finished and found nothing. */
  const [noResults, setNoResults] = useState(false);
  /** The latest search for the current query failed (server or network error). */
  const [failed, setFailed] = useState(false);
  /**
   * The query is long enough to search but hasn't been searched for places yet: typing only
   * looks postcodes up, so the person has to press Enter (or a search button).
   */
  const [awaitingSubmit, setAwaitingSubmit] = useState(false);
  const queryRef = useRef("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Monotonic request id: only the latest request may update state.
  const requestIdRef = useRef(0);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const cancelPending = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
  };

  useEffect(() => cancelPending, []);

  const clearResults = () => {
    setSuggestions([]);
    setAttribution(null);
    setNoResults(false);
    setFailed(false);
    setAwaitingSubmit(false);
  };

  /**
   * Run the search for `value` now; only request `requestId` (the latest) may update state.
   * `suggest` (typing) only looks postcodes up; finding nothing then means "press Enter".
   */
  const runSearch = async (value: string, requestId: number, mode: SearchMode) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setIsSearching(true);
    try {
      const request = () =>
        fetch(buildSearchUrl(value.trim(), mode), {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
      let res = await request();
      // Place search is busy (Nominatim allows one request a second): ask once more.
      if (res.status === 503 && mode === "search" && requestId === requestIdRef.current) {
        await wait(retryDelay(res), controller.signal);
        if (requestId !== requestIdRef.current || controller.signal.aborted) return;
        res = await request();
      }
      if (requestId !== requestIdRef.current) return; // superseded
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const body = (await res.json()) as GeocodeResponse;
      if (requestId !== requestIdRef.current) return; // out-of-order response
      const list = Array.isArray(body?.results) ? body.results.filter(isPlaceResult) : [];
      setSuggestions(list);
      setAttribution(
        list.length > 0 && typeof body.attribution === "string" ? body.attribution : null,
      );
      if (mode === "suggest") setAwaitingSubmit(list.length === 0);
      else setNoResults(list.length === 0);
    } catch (error) {
      // An abort means a newer search (or a dismiss) took over: nothing to report.
      if (requestId === requestIdRef.current && !controller.signal.aborted) {
        console.warn("Place search failed", error);
        setFailed(true);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsSearching(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    }
  };

  const handleSearchInput = (value: string) => {
    setQuery(value);
    queryRef.current = value;
    clearResults();
    cancelPending();
    const requestId = ++requestIdRef.current;
    setIsSearching(false);

    const trimmed = value.trim();
    if (trimmed.length < MIN_SUBMITTED_QUERY_LENGTH) return;
    // A place name waits for Enter: Nominatim's policy forbids autocomplete.
    if (!looksLikePostcode(trimmed)) {
      setAwaitingSubmit(true);
      return;
    }

    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      runSearch(value, requestId, "suggest");
    }, SEARCH_DEBOUNCE_MS);
  };

  /** Search for the current query straight away (Enter, or a search button): places too. */
  const searchNow = () => {
    const value = queryRef.current;
    if (value.trim().length < MIN_SUBMITTED_QUERY_LENGTH) return;
    cancelPending();
    clearResults();
    runSearch(value, ++requestIdRef.current, "search");
  };

  /** Close the results (Escape, a tap elsewhere, the map moving), keeping the typed query. */
  const dismiss = () => {
    cancelPending();
    requestIdRef.current++;
    setIsSearching(false);
    clearResults();
  };

  const handleSuggestionSelect = (result: PlaceResult) => {
    cancelPending();
    requestIdRef.current++;
    setIsSearching(false);
    clearResults();
    setQuery(result.label);
    queryRef.current = result.label;
    const { lat, lng } = result;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const map = mapRef?.current;
    const bounds = fitResultBounds ? resultBounds(result) : null;
    if (map && bounds) {
      map.fitBounds(bounds, { maxZoom, animate: false });
    } else {
      map?.setView([lat, lng], selectZoom, { animate: false });
    }
    onSelectRef.current?.(lat, lng);
  };

  return {
    query,
    isSearching,
    noResults,
    failed,
    awaitingSubmit,
    suggestions,
    attribution,
    handleSearchInput,
    handleSuggestionSelect,
    searchNow,
    dismiss,
  };
}
