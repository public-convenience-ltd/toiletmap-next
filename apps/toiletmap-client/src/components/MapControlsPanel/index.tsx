import type L from "leaflet";
import type { RefObject } from "preact";
import { useState } from "preact/hooks";
import type { IconName } from "toiletmap-design-system";
import { Icon, IconButton, InputField, Tag } from "toiletmap-design-system";
import { useNominatimSearch } from "../../hooks/useNominatimSearch";
import type { ActiveFilters, FilterKey } from "../../types/filters";
import styles from "./MapControlsPanel.module.css";

interface MapControlsPanelProps {
  mapRef: RefObject<L.Map | null>;
  activeFilters: ActiveFilters;
  onFilterChange: (key: FilterKey, value: boolean) => void;
  onResetFilters: () => void;
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
  const { query, isSearching, suggestions, handleSearchInput, handleSuggestionSelect } =
    useNominatimSearch(mapRef);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const activeCount = Object.values(activeFilters).filter(Boolean).length;

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

  return (
    <search className={styles.floatingBar} aria-label="Map search and filters">
      {/* Search row */}
      <div className={styles.searchRow}>
        <div className={styles.searchWrapper}>
          <Icon icon="magnifying-glass" size="small" class={styles.searchIcon} aria-hidden="true" />
          <InputField
            type="search"
            class={styles.searchInput}
            value={query}
            onInput={(e) => handleSearchInput((e.target as HTMLInputElement).value)}
            placeholder="Search for a location…"
            autoComplete="off"
            aria-label="Search for a location"
          />
          {isSearching && (
            <Icon
              icon="spinner"
              size="small"
              spin
              class={styles.searchSpinner}
              aria-hidden="true"
            />
          )}
        </div>

        <IconButton
          icon="map-location-dot"
          aria-label="Find a toilet near me"
          variant="filled"
          size="medium"
          onClick={handleFindNearMe}
          class={styles.geoBtn}
        />

        <div className={styles.filterBtnWrapper}>
          <IconButton
            icon="filter"
            aria-label={`Filters${activeCount > 0 ? ` (${activeCount} active)` : ""}`}
            variant={activeCount > 0 ? "filled" : "ghost"}
            size="medium"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            class={styles.filterBtn}
          />
          {activeCount > 0 && (
            <span className={styles.filterBadge} aria-hidden="true">
              {activeCount}
            </span>
          )}
        </div>
      </div>

      {/* Autocomplete suggestions */}
      {suggestions.length > 0 && (
        <ul className={styles.suggestions} aria-label="Location suggestions">
          {suggestions.map((s) => (
            <li key={s.place_id} className={styles.suggestionItem}>
              <button
                type="button"
                className={styles.suggestion}
                onClick={() => handleSuggestionSelect(s)}
              >
                <Icon icon="map-location-dot" size="small" aria-hidden="true" />
                <span>{s.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Filter chips */}
      {filtersOpen && (
        <div className={styles.filterPanel}>
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
                    <Icon icon={icon} size="small" aria-hidden="true" />
                    <span>{label}</span>
                    {active && <Icon icon="check" size="small" aria-hidden="true" />}
                  </Tag>
                </li>
              );
            })}
          </ul>
          {activeCount > 0 && (
            <button type="button" className={styles.resetBtn} onClick={onResetFilters}>
              Reset filters
            </button>
          )}
        </div>
      )}

      {geoError && <p className={styles.geoError}>{geoError}</p>}
    </search>
  );
}
