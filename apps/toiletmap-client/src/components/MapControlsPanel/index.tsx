import type L from "leaflet";
import type { RefObject } from "preact";
import { useId, useRef, useState } from "preact/hooks";
import type { IconName } from "toiletmap-design-system";
import { Icon, IconButton, InputField, Notice, Tag } from "toiletmap-design-system";
import { usePlaceSearch } from "../../hooks/usePlaceSearch";
import type { ActiveFilters, FilterKey } from "../../types/filters";
import PlaceSearchAttribution from "../PlaceSearchAttribution";
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

/** What the search box is doing, for the status line under it (empty when nothing to say). */
export function searchStatusText({
  isSearching,
  noResults,
  failed,
  awaitingSubmit,
}: {
  isSearching: boolean;
  noResults: boolean;
  failed: boolean;
  awaitingSubmit: boolean;
}): string {
  if (isSearching) return "Searching…";
  if (failed) return "Place search isn't working right now. Try again in a moment.";
  if (noResults) return "No places found. Try a postcode or street name.";
  if (awaitingSubmit) return "Press Enter to search for places.";
  return "";
}

export default function MapControlsPanel({
  mapRef,
  activeFilters,
  onFilterChange,
  onResetFilters,
  onFindNearMe,
  locationError = null,
}: MapControlsPanelProps) {
  const {
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
  } = usePlaceSearch({ mapRef });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterPanelId = useId();
  const searchStatusId = useId();
  const searchStatus = searchStatusText({ isSearching, noResults, failed, awaitingSubmit });
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

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
            // Enter (the keyboard's Search key) picks the first result when there are some, as
            // in the add/edit form's search, or searches for places now.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const first = suggestions[0];
                if (first) handleSuggestionSelect(first);
                else searchNow();
              }
            }}
            aria-describedby={searchStatusId}
            // Short enough to show whole beside the buttons on a 360px phone.
            placeholder="Search places…"
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

      {/* "Searching…", "No places found…": empty (and zero height) the rest of the time. */}
      <p id={searchStatusId} className={styles.searchStatus} role="status" aria-live="polite">
        {searchStatus}
      </p>

      {/* Autocomplete suggestions */}
      {suggestions.length > 0 && (
        <div ref={suggestionsRef}>
          <ul className={styles.suggestions} aria-label="Location suggestions">
            {suggestions.map((s) => (
              <li key={`${s.label}@${s.lat},${s.lng}`} className={styles.suggestionItem}>
                <button
                  type="button"
                  className={styles.suggestion}
                  onClick={() => handleSuggestionSelect(s)}
                >
                  <Icon icon="map-location-dot" size="medium" aria-hidden="true" />
                  <span className={styles.suggestionLabel}>{s.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <PlaceSearchAttribution attribution={attribution} class={styles.attribution} />
        </div>
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
        <div className={styles.geoError}>
          <Notice tone="error" size="compact">
            {locationError}
          </Notice>
        </div>
      )}
    </search>
  );
}
