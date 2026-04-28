import type L from "leaflet";
import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ActiveFilters, FilterKey } from "../../types/filters";
import styles from "./MapControlsPanel.module.css";

interface MapControlsPanelProps {
  mapRef: RefObject<L.Map | null>;
  activeFilters: ActiveFilters;
  onFilterChange: (key: FilterKey, value: boolean) => void;
  onResetFilters: () => void;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

const FILTER_OPTIONS: Array<{ key: FilterKey; label: string; faIcon: string }> = [
  { key: "ACCESSIBLE", label: "Accessible", faIcon: "fa-wheelchair" },
  { key: "BABY_CHNG", label: "Baby Change", faIcon: "fa-baby" },
  { key: "ALL_GENDER", label: "All Gender", faIcon: "fa-person-dress" },
  { key: "NO_PAYMENT", label: "Free", faIcon: "fa-sterling-sign" },
  { key: "RADAR", label: "Radar Key", faIcon: "fa-key" },
];

export default function MapControlsPanel({
  mapRef,
  activeFilters,
  onFilterChange,
  onResetFilters,
}: MapControlsPanelProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const activeCount = Object.values(activeFilters).filter(Boolean).length;

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

  const handleFindNearMe = () => {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError("Geolocation is not supported by your browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        mapRef.current?.flyTo([pos.coords.latitude, pos.coords.longitude], 16, {
          animate: true,
          duration: 1,
        });
      },
      () => {
        setGeoError("Unable to determine your location.");
      },
    );
  };

  const panelContent = (
    <div className={styles.content}>
      <h2 className={styles.title}>Search</h2>

      {/* Location search */}
      <div className={styles.searchWrapper}>
        <i className={`fa-solid fa-magnifying-glass ${styles.searchIcon}`} aria-hidden="true" />
        <input
          type="search"
          className={styles.searchInput}
          value={query}
          onInput={(e) => handleSearchInput((e.target as HTMLInputElement).value)}
          placeholder="Search for a location…"
          autoComplete="off"
          aria-label="Search for a location"
        />
        {isSearching && (
          <i className={`fa-solid fa-spinner fa-spin ${styles.searchSpinner}`} aria-hidden="true" />
        )}
      </div>

      {suggestions.length > 0 && (
        <ul className={styles.suggestions} aria-label="Location suggestions">
          {suggestions.map((s) => (
            <li key={s.place_id} className={styles.suggestionItem}>
              <button
                type="button"
                className={styles.suggestion}
                onClick={() => handleSuggestionSelect(s)}
              >
                <i className="fa-solid fa-map-location-dot" aria-hidden="true" />
                <span>{s.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Filter section */}
      <div className={styles.filterHeader}>
        <button
          type="button"
          className={styles.filterToggleBtn}
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
        >
          <i className="fa-solid fa-filter" aria-hidden="true" />
          <span>Filter{activeCount > 0 && <b> ({activeCount})</b>}</span>
          <i
            className={`fa-solid ${filtersOpen ? "fa-chevron-up" : "fa-chevron-down"}`}
            aria-hidden="true"
          />
        </button>
        {filtersOpen && activeCount > 0 && (
          <button type="button" className={styles.resetBtn} onClick={onResetFilters}>
            Reset Filter
          </button>
        )}
      </div>

      {filtersOpen && (
        <ul className={styles.filterList}>
          {FILTER_OPTIONS.map(({ key, label, faIcon }) => {
            const active = activeFilters[key];
            return (
              <li key={key}>
                <button
                  type="button"
                  className={`${styles.filterBtn} ${active ? styles.filterBtnActive : ""}`}
                  onClick={() => onFilterChange(key, !active)}
                  aria-pressed={active}
                >
                  <i className={`fa-solid ${faIcon}`} aria-hidden="true" />
                  <span className={styles.filterLabel}>{label}</span>
                  {active && <i className="fa-solid fa-check" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Quick links */}
      <button type="button" className={styles.quickLink} onClick={handleFindNearMe}>
        <i className="fa-solid fa-map-location-dot" aria-hidden="true" />
        <span>Find a toilet near me</span>
        <i className="fa-solid fa-angle-right" aria-hidden="true" />
      </button>
      {geoError && <p className={styles.geoError}>{geoError}</p>}

      <button type="button" className={styles.quickLink} disabled title="Coming soon">
        <i className="fa-solid fa-circle-plus" aria-hidden="true" />
        <span>Add a Toilet</span>
        <i className="fa-solid fa-angle-right" aria-hidden="true" />
      </button>
    </div>
  );

  return (
    <>
      {/* Desktop: fixed left panel */}
      <aside className={styles.panel} aria-label="Map controls">
        {panelContent}
      </aside>

      {/* Mobile: floating toggle button */}
      <button
        type="button"
        className={styles.mobileToggle}
        onClick={() => setIsDrawerOpen(true)}
        aria-label={`Open map controls${activeCount > 0 ? ` (${activeCount} filters active)` : ""}`}
        aria-expanded={isDrawerOpen}
      >
        <i className="fa-solid fa-sliders" aria-hidden="true" />
        {activeCount > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {activeCount}
          </span>
        )}
      </button>

      {/* Mobile: slide-in drawer */}
      {isDrawerOpen && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: Overlay backdrop closes drawer on click
        // biome-ignore lint/a11y/noStaticElementInteractions: Overlay backdrop
        <div className={styles.overlay} onClick={() => setIsDrawerOpen(false)}>
          <div className={styles.drawer} role="dialog" aria-modal="true" aria-label="Map controls">
            <div className={styles.drawerHeader}>
              <span className={styles.drawerTitle}>Map Controls</span>
              <button
                type="button"
                className={styles.drawerClose}
                onClick={() => setIsDrawerOpen(false)}
                aria-label="Close map controls"
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>
            {panelContent}
          </div>
        </div>
      )}
    </>
  );
}
