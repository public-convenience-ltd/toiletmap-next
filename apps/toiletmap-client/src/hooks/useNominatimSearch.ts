import type L from "leaflet";
import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

export interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

export function useNominatimSearch(mapRef: RefObject<L.Map | null>) {
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
    setSuggestions([]);
    setQuery(result.display_name);
    mapRef.current?.flyTo([Number.parseFloat(result.lat), Number.parseFloat(result.lon)], 15, {
      animate: true,
      duration: 1,
    });
  };

  return { query, isSearching, suggestions, handleSearchInput, handleSuggestionSelect };
}
