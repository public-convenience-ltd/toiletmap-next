import type L from "leaflet";
import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { IconName } from "toiletmap-design-system";
import { Icon, IconButton, InputField, Sheet, Tag } from "toiletmap-design-system";
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

const FILTER_OPTIONS: Array<{ key: FilterKey; label: string; icon: IconName }> = [
  { key: "ACCESSIBLE", label: "Accessible", icon: "wheelchair-move" },
  { key: "BABY_CHNG", label: "Baby Change", icon: "baby" },
  { key: "ALL_GENDER", label: "All Gender", icon: "person-dress" },
  { key: "NO_PAYMENT", label: "Free", icon: "sterling-sign" },
  { key: "RADAR", label: "Radar Key", icon: "key" },
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
      {/* Location search */}
      <div className={styles.searchWrapper}>
        <Icon icon="magnifying-glass" size="small" class={styles.searchIcon} />
        <InputField
          type="search"
          class={styles.searchInput}
          value={query}
          onInput={(e) => handleSearchInput((e.target as HTMLInputElement).value)}
          placeholder="Search for a location…"
          autoComplete="off"
          aria-label="Search for a location"
        />
        {isSearching && <Icon icon="spinner" size="small" spin class={styles.searchSpinner} />}
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
                <Icon icon="map-location-dot" size="small" />
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
          <Icon icon="filter" size="small" />
          <span>Filter{activeCount > 0 && <b> ({activeCount})</b>}</span>
          <Icon
            icon="chevron-down"
            size="small"
            style={{
              transform: filtersOpen ? "rotate(180deg)" : "none",
              transition: "transform 0.2s ease",
            }}
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
          {FILTER_OPTIONS.map(({ key, label, icon }) => {
            const active = activeFilters[key];
            return (
              <li key={key}>
                <Tag
                  active={active}
                  class={styles.filterTag}
                  onClick={() => onFilterChange(key, !active)}
                >
                  <Icon icon={icon} size="small" />
                  <span className={styles.filterLabel}>{label}</span>
                  {active && <Icon icon="check" size="small" />}
                </Tag>
              </li>
            );
          })}
        </ul>
      )}

      {/* Quick links */}
      <button type="button" className={styles.quickLink} onClick={handleFindNearMe}>
        <Icon icon="map-location-dot" size="small" />
        <span>Find a toilet near me</span>
        <Icon icon="angle-right" size="small" />
      </button>
      {geoError && <p className={styles.geoError}>{geoError}</p>}

      <button type="button" className={styles.quickLink} disabled title="Coming soon">
        <Icon icon="circle-plus" size="small" />
        <span>Add a Toilet</span>
        <Icon icon="angle-right" size="small" />
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
        aria-label={`Open menu${activeCount > 0 ? ` (${activeCount} filters active)` : ""}`}
        aria-expanded={isDrawerOpen}
      >
        <Icon icon="bars" size="small" />
        <span>Menu</span>
        {activeCount > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {activeCount}
          </span>
        )}
      </button>

      {/* Mobile: slide-in Sheet drawer */}
      <Sheet
        visible={isDrawerOpen}
        side="left"
        onClose={() => setIsDrawerOpen(false)}
        zIndex={1200}
      >
        <div className={styles.drawerHeader}>
          <span className={styles.drawerTitle}>Search & Filter</span>
          <IconButton icon="xmark" aria-label="Close menu" onClick={() => setIsDrawerOpen(false)} />
        </div>
        {panelContent}
      </Sheet>
    </>
  );
}
