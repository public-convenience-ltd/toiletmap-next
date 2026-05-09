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
  mapRef?: RefObject<L.Map | null>;
  onSelect?: (lat: number, lng: number) => void;
}

export function useNominatimSearch(options: UseNominatimSearchOptions = {}) {
  const { mapRef, onSelect } = options;
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleSearchInput = (value: string) => {
    setQuery(value);
    setSuggestions([]);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) return;

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(value)}`,
          { headers: { "Accept-Language": "en" } },
        );
        setSuggestions((await res.json()) as NominatimResult[]);
      } catch {
        // search is best-effort
      } finally {
        setIsSearching(false);
      }
    }, 300);
  };

  const handleSuggestionSelect = (result: NominatimResult) => {
    const lat = Number.parseFloat(result.lat);
    const lng = Number.parseFloat(result.lon);
    setSuggestions([]);
    setQuery(result.display_name);
    mapRef?.current?.setView([lat, lng], 15, { animate: false });
    onSelect?.(lat, lng);
  };

  return { query, isSearching, suggestions, handleSearchInput, handleSuggestionSelect };
}
