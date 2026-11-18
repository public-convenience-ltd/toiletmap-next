import type L from "leaflet";
import type { RefObject } from "preact";
import { useId, useRef, useState } from "preact/hooks";
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
  /**
   * "Find a toilet near me": the map owns geolocation (it tracks the viewer and draws the
   * "you are here" dot), so the button only asks for it.
   */
  onFindNearMe: () => void;
  /** Why the viewer's location couldn't be found, shown under the bar. */
  locationError?: string | null;
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
  onFindNearMe,
  locationError = null,
}: MapControlsPanelProps) {
  const { query, isSearching, suggestions, handleSearchInput, handleSuggestionSelect, dismiss } =
    useNominatimSearch({ mapRef });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterPanelId = useId();
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLUListElement>(null);

  const activeCount = Object.values(activeFilters).filter(Boolean).length;

  return (
    // Positioned by LooMap's floating chrome; data-map-control marks it as covering the map
    // (the selected marker is kept clear of it). Escape with the suggestions open closes them
    // (from the box or a suggestion) and goes no further; otherwise only the search box keeps
    // it (data-owns-escape: the browser clears the box), and Escape on the bar's buttons
    // reaches the map like anywhere else on it.
    <search
      className={styles.floatingBar}
      aria-label="Map search and filters"
      data-map-control
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented || suggestions.length === 0) return;
        e.preventDefault();
        // A focused suggestion is about to go: keep focus in the bar, on the search box.
        const fromSuggestion =
          e.target instanceof Node && suggestionsRef.current?.contains(e.target);
        dismiss();
        if (fromSuggestion) searchBoxRef.current?.querySelector("input")?.focus();
      }}
    >
      {/* Search row */}
      <div className={styles.searchRow}>
        <div className={styles.searchWrapper} ref={searchBoxRef} data-owns-escape>
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
          onClick={onFindNearMe}
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
            aria-controls={filtersOpen ? filterPanelId : undefined}
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
        <ul className={styles.suggestions} ref={suggestionsRef} aria-label="Location suggestions">
          {suggestions.map((s) => (
            <li key={s.place_id} className={styles.suggestionItem}>
              <button
                type="button"
                className={styles.suggestion}
                onClick={() => handleSuggestionSelect(s)}
              >
                <Icon icon="map-location-dot" size="medium" aria-hidden="true" />
                <span>{s.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Filter chips */}
      {filtersOpen && (
        <div className={styles.filterPanel} id={filterPanelId}>
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

      {locationError && (
        <p className={styles.geoError} role="alert">
          {locationError}
        </p>
      )}
    </search>
  );
}
