/**
 * URL and API parameter builders for Loos List client components
 */

import type { ScriptState, SortOrder, FilterMappings } from './types';

/**
 * Sanitize sort column to allowed values
 */
const sanitizeSortColumn = (column: string): string => {
    const allowed = ['name', 'updated_at', 'verified_at', 'created_at'];
    return allowed.indexOf(column) >= 0 ? column : 'updated_at';
};

/**
 * Map UI sort column and order to API sort parameter
 */
const mapSortToApiSort = (column: string, order: SortOrder): string => {
    if (column === 'name') {
        return order === 'asc' ? 'name-asc' : 'name-desc';
    }
    if (column === 'created_at') {
        return order === 'asc' ? 'created-asc' : 'created-desc';
    }
    if (column === 'verified_at') {
        return order === 'asc' ? 'verified-asc' : 'verified-desc';
    }
    return order === 'asc' ? 'updated-asc' : 'updated-desc';
};

/**
 * Get the effective sort column and order (respecting custom sort flag)
 */
const getEffectiveSort = (state: ScriptState): { column: string; order: SortOrder } => {
    if (state.hasCustomSort) {
        return {
            column: sanitizeSortColumn(state.sortBy),
            order: state.sortOrder,
        };
    }
    return { column: 'updated_at', order: 'desc' };
};

/**
 * Build URL search parameters for the API search endpoint
 */
export const buildSearchParams = (state: ScriptState, filterMappings: FilterMappings): URLSearchParams => {
    const params = new URLSearchParams();
    if (state.search) {
        params.set('search', state.search);
    }
    params.set('page', String(state.page));
    params.set('limit', String(state.pageSize));
    const effectiveSort = getEffectiveSort(state);
    params.set('sort', mapSortToApiSort(effectiveSort.column, effectiveSort.order));

    Object.keys(state.filters).forEach((key) => {
        const value = state.filters[key];
        if (!value || value === 'all') {
            return;
        }
        const mapping = filterMappings[key];
        if (!mapping || !mapping.mapping) {
            return;
        }
        const mappedValue = mapping.mapping[value];
        if (mappedValue) {
            params.set(mapping.param, mappedValue);
        }
    });

    return params;
};

/**
 * Build URL search parameters for the API metrics endpoint
 */
export const buildMetricsParams = (
    state: ScriptState,
    filterMappings: FilterMappings,
    recentWindowDays: number,
): URLSearchParams => {
    const params = buildSearchParams(state, filterMappings);
    params.delete('limit');
    params.delete('page');
    params.set('recentWindowDays', String(recentWindowDays));
    return params;
};

/**
 * Build navigation URL for pagination and state changes
 */
export const buildNavigationUrl = (
    state: ScriptState,
    currentPath: string,
    overrides: Record<string, string | number | undefined> = {},
): string => {
    const params = new URLSearchParams();
    if (state.search) {
        params.set('search', state.search);
    }
    if (state.hasCustomSort) {
        params.set('sortBy', state.sortBy);
        params.set('sortOrder', state.sortOrder);
    }
    params.set('pageSize', String(state.pageSize));
    params.set('page', String(state.page));
    Object.keys(state.filters).forEach((key) => {
        const value = state.filters[key];
        if (value && value !== 'all') {
            params.set(key, value);
        }
    });

    Object.keys(overrides).forEach((key) => {
        const value = overrides[key];
        if (value === undefined || value === null || value === '') {
            params.delete(key);
        } else {
            params.set(key, String(value));
        }
    });

    const query = params.toString();
    return query ? currentPath + '?' + query : currentPath;
};
