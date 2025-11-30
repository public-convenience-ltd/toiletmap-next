/** @jsxImportSource hono/jsx/dom */

import { useEffect, useState } from "hono/jsx";
import { TABLE_FILTERS } from "../../constants";
import type { ScriptState } from "../utils/types";

type LoosSearchControlsProps = {
  state: ScriptState;
  onSearchChange: (search: string) => void;
  onFilterChange: (key: string, value: string) => void;
  onRefresh: () => void;
  loading: boolean;
  onResetFilters: () => void;
};

export function LoosSearchControls({
  state,
  onSearchChange,
  onFilterChange,
  onRefresh,
  loading,
  onResetFilters,
}: LoosSearchControlsProps) {
  const [localSearch, setLocalSearch] = useState(state.search);

  useEffect(() => {
    setLocalSearch(state.search);
  }, [state.search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (localSearch !== state.search) {
        onSearchChange(localSearch);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [localSearch, state.search, onSearchChange]);

  const handleSearchInput = (e: Event) => {
    const target = e.target as HTMLInputElement;
    setLocalSearch(target.value);
  };

  const handleClearSearch = () => {
    setLocalSearch("");
    onSearchChange("");
  };

  const appliedFilters = TABLE_FILTERS.map((filter) => {
    const value = state.filters[filter.key];
    if (!value || value === "all") return null;
    const option = filter.options.find((opt) => opt.value === value);
    return {
      key: filter.key,
      label: filter.label,
      value,
      valueLabel: option?.label ?? value,
    };
  }).filter(Boolean) as { key: string; label: string; value: string; valueLabel: string }[];

  return (
    <section class="table-controls">
      <div class="table-controls__row">
        <div class="search-form">
          <div class="search-form__row">
            <div class="search-input-wrapper">
              <label class="visually-hidden" for="loos-search">
                Search
              </label>
              <input
                id="loos-search"
                type="text"
                class="input search-input"
                placeholder="Search by name, notes, geohash, or area"
                value={localSearch}
                onInput={handleSearchInput}
                autocomplete="off"
              />
              <i class="fa-solid fa-magnifying-glass search-input-icon" aria-hidden="true" />
              {localSearch && (
                <button
                  type="button"
                  class="search-clear-btn"
                  onClick={handleClearSearch}
                  aria-label="Clear search"
                >
                  <i class="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              )}
            </div>

            <fieldset class="filter-controls">
              <legend class="visually-hidden">Filters</legend>
              {TABLE_FILTERS.map((filter) => (
                <div class="filter-select-wrapper">
                  <label class="visually-hidden" for={`filter-${filter.key}`}>
                    {filter.label}
                  </label>
                  <select
                    id={`filter-${filter.key}`}
                    class="input filter-select"
                    value={state.filters[filter.key] || "all"}
                    onChange={(e) => {
                      const target = e.target as HTMLSelectElement;
                      onFilterChange(filter.key, target.value);
                    }}
                  >
                    {filter.options.map((opt) => (
                      <option value={opt.value} selected={state.filters[filter.key] === opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </fieldset>
          </div>
        </div>

        <button
          type="button"
          class="button button--secondary table-controls__refresh"
          onClick={onRefresh}
          disabled={loading}
        >
          <i class="fa-solid fa-rotate" aria-hidden="true" />
          <span style="margin-left: var(--space-3xs);">Refresh</span>
        </button>
      </div>

      {appliedFilters.length > 0 && (
        <div class="active-filters">
          {appliedFilters.map((filter) => (
            <div class="filter-chip">
              <span class="filter-chip__label">
                {filter.label}: {filter.valueLabel}
              </span>
              <button
                type="button"
                class="filter-chip__remove"
                aria-label={`Remove filter ${filter.label}`}
                onClick={() => onFilterChange(filter.key, "all")}
              >
                <i class="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>
          ))}
          <button type="button" class="filter-chip filter-chip--reset" onClick={onResetFilters}>
            <i class="fa-solid fa-rotate" aria-hidden="true" />
            <span class="filter-chip__label">Reset filters</span>
          </button>
        </div>
      )}
    </section>
  );
}
