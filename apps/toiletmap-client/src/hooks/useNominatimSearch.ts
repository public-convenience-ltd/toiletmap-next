import type L from "leaflet";
import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

export interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

interface UseNominatimSearchOptions {
  /** Map to pan/zoom when a suggestion is selected. Selecting never moves anything else. */
  mapRef?: RefObject<L.Map | null>;
  /** Zoom level used when panning to a selected suggestion. Defaults to 15. */
  selectZoom?: number;
  /**
   * @deprecated Kept for backward compatibility. Prefer panning via `mapRef`;
   * search results must not be written into a toilet's location.
   */
  onSelect?: (lat: number, lng: number) => void;
}

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const DEFAULT_SELECT_ZOOM = 15;

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
  const { mapRef, onSelect, selectZoom = DEFAULT_SELECT_ZOOM } = options;
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
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

  const handleSearchInput = (value: string) => {
    setQuery(value);
    setSuggestions([]);
    cancelPending();
    const requestId = ++requestIdRef.current;
    setIsSearching(false);

    if (value.trim().length < MIN_QUERY_LENGTH) return;

    debounceRef.current = setTimeout(async () => {
      debounceRef.current = null;
      const controller = new AbortController();
      abortRef.current = controller;
      setIsSearching(true);
      try {
        const res = await fetch(buildSearchUrl(value.trim()), { signal: controller.signal });
        if (!res.ok) return;
        const results = (await res.json()) as NominatimResult[];
        if (requestId !== requestIdRef.current) return; // out-of-order response
        setSuggestions(Array.isArray(results) ? results : []);
      } catch {
        // search is best-effort (aborts land here too)
      } finally {
        if (requestId === requestIdRef.current) {
          setIsSearching(false);
          if (abortRef.current === controller) abortRef.current = null;
        }
      }
    }, DEBOUNCE_MS);
  };

  const handleSuggestionSelect = (result: NominatimResult) => {
    cancelPending();
    requestIdRef.current++;
    setIsSearching(false);
    setSuggestions([]);
    setQuery(result.display_name);
    const lat = Number.parseFloat(result.lat);
    const lng = Number.parseFloat(result.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    mapRef?.current?.setView([lat, lng], selectZoom, { animate: false });
    onSelectRef.current?.(lat, lng);
  };

  return { query, isSearching, suggestions, handleSearchInput, handleSuggestionSelect };
}
