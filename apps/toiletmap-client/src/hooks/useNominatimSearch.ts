import type L from "leaflet";
import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

export interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  /**
   * The result's extent as Nominatim returns it: [south, north, west, east], as strings.
   * Absent in older fixtures and some results.
   */
  boundingbox?: [string, string, string, string];
}

interface UseNominatimSearchOptions {
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

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const DEFAULT_SELECT_ZOOM = 15;
const DEFAULT_MAX_ZOOM = 18;

/** [[south, west], [north, east]] from a Nominatim bounding box, or null if it isn't usable. */
export function resultBounds(
  result: Pick<NominatimResult, "boundingbox">,
): [[number, number], [number, number]] | null {
  const box = result.boundingbox;
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [south, north, west, east] = box.map((v) => Number.parseFloat(String(v)));
  if (![south, north, west, east].every(Number.isFinite)) return null;
  if (south > north || west > east) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180) return null;
  return [
    [south, west],
    [north, east],
  ];
}

const buildSearchUrl = (query: string) => {
  const params = new URLSearchParams({
    format: "json",
    limit: "5",
    countrycodes: "gb",
    "accept-language": "en",
    q: query,
  });
  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
};

export function useNominatimSearch(options: UseNominatimSearchOptions = {}) {
  const {
    mapRef,
    onSelect,
    selectZoom = DEFAULT_SELECT_ZOOM,
    fitResultBounds = false,
    maxZoom = DEFAULT_MAX_ZOOM,
  } = options;
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  /** The latest search for the current query finished and found nothing. */
  const [noResults, setNoResults] = useState(false);
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

  /** Run the search for `value` now; only request `requestId` (the latest) may update state. */
  const runSearch = async (value: string, requestId: number) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setIsSearching(true);
    try {
      const res = await fetch(buildSearchUrl(value.trim()), { signal: controller.signal });
      if (!res.ok) return;
      const results = (await res.json()) as NominatimResult[];
      if (requestId !== requestIdRef.current) return; // out-of-order response
      const list = Array.isArray(results) ? results : [];
      setSuggestions(list);
      setNoResults(list.length === 0);
    } catch {
      // search is best-effort (aborts land here too)
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
    setSuggestions([]);
    setNoResults(false);
    cancelPending();
    const requestId = ++requestIdRef.current;
    setIsSearching(false);

    if (value.trim().length < MIN_QUERY_LENGTH) return;

    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      runSearch(value, requestId);
    }, DEBOUNCE_MS);
  };

  /** Search for the current query straight away, skipping the debounce (e.g. on Enter). */
  const searchNow = () => {
    const value = queryRef.current;
    if (value.trim().length < MIN_QUERY_LENGTH) return;
    cancelPending();
    setSuggestions([]);
    setNoResults(false);
    runSearch(value, ++requestIdRef.current);
  };

  /** Close the results (Escape, a tap elsewhere, the map moving), keeping the typed query. */
  const dismiss = () => {
    cancelPending();
    requestIdRef.current++;
    setIsSearching(false);
    setSuggestions([]);
    setNoResults(false);
  };

  const handleSuggestionSelect = (result: NominatimResult) => {
    cancelPending();
    requestIdRef.current++;
    setIsSearching(false);
    setSuggestions([]);
    setNoResults(false);
    setQuery(result.display_name);
    queryRef.current = result.display_name;
    const lat = Number.parseFloat(result.lat);
    const lng = Number.parseFloat(result.lon);
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
    suggestions,
    handleSearchInput,
    handleSuggestionSelect,
    searchNow,
    dismiss,
  };
}
