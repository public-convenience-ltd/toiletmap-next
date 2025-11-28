/** @jsxImportSource hono/jsx/dom */

/**
 * Main Loos List client application component
 */

import { useState, useEffect } from 'hono/jsx';
import type { PageConfig, ScriptState, FilterMappings } from './utils/types';
import { useLoosState } from './hooks/useLoosState';
import { useLoosData } from './hooks/useLoosData';
import { LoosTable } from './components/LoosTable.client';
import { LoosPagination } from './components/LoosPagination.client';
import { LoosMetrics } from './components/LoosMetrics.client';

const isObject = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null;
};

export function LoosListApp() {
    const [config, setConfig] = useState<{
        filterMappings: FilterMappings;
        areaColors: string[];
        recentWindowDays: number;
        currentPath: string;
        searchEndpoint: string;
        metricsEndpoint: string;
        initialState: ScriptState;
    } | null>(null);

    // Bootstrap configuration from DOM
    useEffect(() => {
        if (typeof window === 'undefined') return;

        const configEl = document.getElementById('loos-page-config');
        if (!configEl) {
            console.error('Config element not found');
            return;
        }

        let parsedConfig: Record<string, unknown> = {};
        try {
            const raw = configEl.textContent || '{}';
            parsedConfig = JSON.parse(raw);
        } catch (error) {
            console.error('Failed to parse loos page config', error);
            return;
        }

        const queryConfig = isObject(parsedConfig.query) ? (parsedConfig.query as Record<string, unknown>) : {};
        const filtersInput = isObject(queryConfig.filters) ? (queryConfig.filters as Record<string, unknown>) : {};
        const normalizedFilters: Record<string, string> = {};
        Object.keys(filtersInput).forEach((key) => {
            const value = filtersInput[key];
            if (typeof value === 'string') {
                normalizedFilters[key] = value;
            }
        });

        const initialState: ScriptState = {
            search: typeof queryConfig.search === 'string' ? queryConfig.search : '',
            page: Number(queryConfig.page) || 1,
            pageSize: Number(queryConfig.pageSize) || 25,
            sortBy: typeof queryConfig.sortBy === 'string' ? queryConfig.sortBy : 'updated_at',
            sortOrder: queryConfig.sortOrder === 'asc' ? 'asc' : 'desc',
            hasCustomSort: Boolean(queryConfig.hasCustomSort),
            filters: normalizedFilters,
        };

        const filterMappings: FilterMappings = isObject(parsedConfig.filterMappings)
            ? (parsedConfig.filterMappings as FilterMappings)
            : {};
        const areaColors = Array.isArray(parsedConfig.areaColors)
            ? (parsedConfig.areaColors as unknown[]).filter((color): color is string => typeof color === 'string')
            : [];
        const recentWindowDays = Number(parsedConfig.recentWindowDays) || 14;
        const currentPath =
            typeof parsedConfig.currentPath === 'string' ? parsedConfig.currentPath : window.location.pathname;
        const apiConfig = isObject(parsedConfig.api) ? (parsedConfig.api as Record<string, unknown>) : {};
        const searchEndpoint = typeof apiConfig.search === 'string' ? apiConfig.search : '/api/loos/search';
        const metricsEndpoint = typeof apiConfig.metrics === 'string' ? apiConfig.metrics : '/api/loos/metrics';

        setConfig({
            filterMappings,
            areaColors,
            recentWindowDays,
            currentPath,
            searchEndpoint,
            metricsEndpoint,
            initialState,
        });
    }, []);

    // Don't render until config is loaded
    if (!config) {
        return <div>Loading configuration...</div>;
    }

    return (
        <LoosListAppContent
            filterMappings={config.filterMappings}
            areaColors={config.areaColors}
            recentWindowDays={config.recentWindowDays}
            currentPath={config.currentPath}
            searchEndpoint={config.searchEndpoint}
            metricsEndpoint={config.metricsEndpoint}
            initialState={config.initialState}
        />
    );
}

type LoosListAppContentProps = {
    filterMappings: FilterMappings;
    areaColors: string[];
    recentWindowDays: number;
    currentPath: string;
    searchEndpoint: string;
    metricsEndpoint: string;
    initialState: ScriptState;
};

import { LoosSearchControls } from './components/LoosSearchControls.client';

// ... (imports remain the same, but need to ensure LoosSearchControls is imported)

function LoosListAppContent({
    filterMappings,
    areaColors,
    recentWindowDays,
    currentPath,
    searchEndpoint,
    metricsEndpoint,
    initialState,
}: LoosListAppContentProps) {
    const {
        state,
        updateSearch,
        updatePage,
        updateFilter,
        resetFilters,
    } = useLoosState(initialState);

    const { searchData, metricsData, loading, error, metricsError, refetch } = useLoosData({
        state,
        searchEndpoint,
        metricsEndpoint,
        filterMappings,
        recentWindowDays,
    });

    return (
        <div>
            <LoosMetrics
                metrics={metricsData}
                totalCount={searchData?.total || 0}
                searchQuery={state.search}
                recentWindowDays={recentWindowDays}
                areaColors={areaColors}
                loading={loading}
                error={metricsError || undefined}
            />

            <LoosSearchControls
                state={state}
                onSearchChange={updateSearch}
                onFilterChange={updateFilter}
                onRefresh={refetch}
                loading={loading}
                onResetFilters={resetFilters}
            />

            <section class="table-section">
                <LoosTable searchData={searchData} loading={loading} error={error} onRetry={refetch} />

                {searchData && (
                    <LoosPagination searchData={searchData} state={state} currentPath={currentPath} />
                )}
            </section>
        </div>
    );
}
