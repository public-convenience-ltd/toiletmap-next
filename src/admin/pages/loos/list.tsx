import { Context } from 'hono';
import { Layout } from '../../components/Layout';
import { Button } from '../../components/DesignSystem';
import { Env } from '../../../types';
import { RECENT_WINDOW_DAYS } from '../../../common/constants';
import {
    AREA_COLORS,
    CURRENT_PATH,
    FILTER_TO_API_PARAM,
    PAGE_SIZE_OPTIONS,
    TABLE_FILTERS,
} from './constants';
import { clampPageSize, serializeConfig } from './helpers';
import { loosListClientScript } from './scripts';

const SORT_COLUMNS = ['name', 'updated_at', 'verified_at', 'created_at'] as const;
const TABLE_COLUMNS: Array<{ key: string; label: string; sortKey?: SortKey }> = [
    { key: 'name', label: 'Location', sortKey: 'name' },
    { key: 'verified_at', label: 'Status', sortKey: 'verified_at' },
    { key: 'access', label: 'Access & facilities' },
    { key: 'cost', label: 'Cost & contributors' },
    { key: 'updated_at', label: 'Activity', sortKey: 'updated_at' },
];
type SortKey = typeof SORT_COLUMNS[number];
type SortOrder = 'asc' | 'desc';

type QueryState = {
    searchQuery: string;
    page: number;
    pageSize: number;
    sortBy: SortKey;
    sortOrder: SortOrder;
    hasCustomSort: boolean;
    filters: Record<string, string>;
};

const buildBaseParams = (state: QueryState) => {
    const params = new URLSearchParams();
    if (state.searchQuery) params.set('search', state.searchQuery);
    if (state.hasCustomSort && state.sortBy) {
        params.set('sortBy', state.sortBy);
        params.set('sortOrder', state.sortOrder);
    }
    params.set('pageSize', String(state.pageSize));
    params.set('page', String(state.page));
    Object.entries(state.filters).forEach(([key, value]) => {
        if (value && value !== 'all') {
            params.set(key, value);
        }
    });
    return params;
};

const buildUrl = (state: QueryState, overrides: Record<string, string | number | undefined>) => {
    const params = buildBaseParams(state);
    Object.entries(overrides).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
            params.delete(key);
        } else {
            params.set(key, String(value));
        }
    });
    const query = params.toString();
    return query ? `${CURRENT_PATH}?${query}` : CURRENT_PATH;
};

const renderHiddenStateInputs = (
    state: QueryState,
    options?: { omit?: string[]; overrides?: Record<string, string>; replaceAll?: boolean },
) => {
    const params = buildBaseParams(state);
    if (options?.replaceAll) {
        params.forEach((_value, key) => params.delete(key));
    }
    options?.omit?.forEach((key) => params.delete(key));
    Object.entries(options?.overrides || {}).forEach(([key, value]) => {
        if (value === '') {
            params.delete(key);
        } else {
            params.set(key, value);
        }
    });
    return Array.from(params.entries()).map(([key, value]) => (
        <input type="hidden" name={key} value={value} />
    ));
};

const getFilterLabel = (key: string, value: string) => {
    const filter = TABLE_FILTERS.find((f) => f.key === key);
    return filter?.options.find((opt) => opt.value === value)?.label;
};

const renderSortIcon = (sortBy: SortKey | '', sortOrder: SortOrder, colKey: SortKey) => {
    if (!sortBy || sortBy !== colKey) {
        return <i class="fa-solid fa-sort sort-icon" aria-hidden="true"></i>;
    }
    if (sortOrder === 'asc') {
        return <i class="fa-solid fa-sort-up sort-icon" aria-hidden="true"></i>;
    }
    return <i class="fa-solid fa-sort-down sort-icon" aria-hidden="true"></i>;
};

const buildSortUrl = (state: QueryState, currentSortBy: SortKey | '', currentSortOrder: SortOrder, colKey: SortKey) => {
    if (currentSortBy !== colKey) {
        return buildUrl(state, { sortBy: colKey, sortOrder: 'asc', page: '1' });
    }
    if (currentSortOrder !== 'desc') {
        return buildUrl(state, { sortOrder: 'desc', page: '1' });
    }
    return buildUrl(state, { sortBy: '', sortOrder: '', page: '1' });
};

export const loosList = async (c: Context<{ Bindings: Env }>) => {
    const url = new URL(c.req.url);
    const searchQuery = (url.searchParams.get('search') ?? '').trim();
    const requestedPage = parseInt(url.searchParams.get('page') ?? '1', 10);
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const requestedPageSize = parseInt(url.searchParams.get('pageSize') ?? '25', 10);
    const pageSize = clampPageSize(requestedPageSize);

    const sortParam = url.searchParams.get('sortBy');
    const normalizedSortParam = sortParam && SORT_COLUMNS.includes(sortParam as SortKey) ? (sortParam as SortKey) : null;
    const sortBy: SortKey = normalizedSortParam ?? 'updated_at';
    const hasCustomSort = Boolean(normalizedSortParam);
    const sortOrder: SortOrder = url.searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';

    const sanitizeFilter = (key: string, allowed: string[]) => {
        const value = url.searchParams.get(key);
        if (value && allowed.includes(value)) {
            return value;
        }
        return 'all';
    };

    const filtersState = {
        status: sanitizeFilter('status', ['all', 'active', 'inactive']),
        access: sanitizeFilter('access', ['all', 'accessible', 'not_accessible']),
        payment: sanitizeFilter('payment', ['all', 'free', 'paid']),
        verification: sanitizeFilter('verification', ['all', 'verified', 'unverified']),
    };

    const uiSortBy: SortKey | '' = hasCustomSort ? sortBy : '';
    const uiSortOrder: SortOrder = hasCustomSort ? sortOrder : 'asc';

    const state: QueryState = {
        searchQuery,
        page,
        pageSize,
        sortBy,
        sortOrder,
        hasCustomSort,
        filters: filtersState,
    };

    const appliedFilters = TABLE_FILTERS.map((filter) => {
        const value = filtersState[filter.key];
        if (!value || value === 'all') return null;
        return {
            key: filter.key,
            label: filter.label,
            value,
            valueLabel: getFilterLabel(filter.key, value) ?? value,
        };
    }).filter(Boolean) as { key: string; label: string; value: string; valueLabel: string }[];

    const clearFiltersOverrides = TABLE_FILTERS.reduce(
        (acc, filter) => ({ ...acc, [filter.key]: '' }),
        { page: '1' } as Record<string, string>,
    );
    const clearFiltersUrl = buildUrl(state, clearFiltersOverrides);

    const pageConfig = {
        api: {
            search: '/api/loos/search',
            metrics: '/api/loos/metrics',
        },
        currentPath: CURRENT_PATH,
        query: {
            search: searchQuery,
            page,
            pageSize,
            sortBy,
            sortOrder,
            hasCustomSort,
            filters: filtersState,
        },
        recentWindowDays: RECENT_WINDOW_DAYS,
        areaColors: AREA_COLORS,
        pageSizeOptions: PAGE_SIZE_OPTIONS,
        filterMappings: FILTER_TO_API_PARAM,
    };

    const serializedConfig = serializeConfig(pageConfig);

    return c.html(
        <Layout title="Loos">
            <noscript>
                <div class="empty-state" style="margin-bottom: var(--space-l);">
                    <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
                    <h3>JavaScript is required</h3>
                    <p>The admin dataset explorer now loads data in the browser. Please enable JavaScript.</p>
                </div>
            </noscript>

            <div class="page-header">
                <div>
                    <p class="form-label" style="margin: 0;">Dataset Explorer</p>
                    <h1 style="margin: var(--space-3xs) 0;">Understand every loo in seconds</h1>
                    <p style="max-width: 60ch; color: var(--color-neutral-grey);">
                        Search, slice, and order the dataset with filters that reflect our domain—stay on top of verification and coverage work at a glance.
                    </p>
                </div>
                <Button href="/admin/loos/create">Add New Loo</Button>
            </div>

            <section class="stats-panel" data-loos-metrics>
                <div class="metric-grid" data-loos-insights>
                    {Array.from({ length: 4 }).map(() => (
                        <div class="metric-card metric-card--loading">
                            <p class="metric-label">Loading…</p>
                            <p class="metric-value">—</p>
                            <p class="metric-meta">Fetching latest metrics</p>
                        </div>
                    ))}
                </div>

                <div class="stat-sections">
                    <div class="stat-section">
                        <p class="stat-heading">Feature coverage</p>
                        <div class="async-state" data-loos-features-loading>
                            <div class="loading-indicator">
                                <span class="loading-spinner" aria-hidden="true"></span>
                                <p>Calculating feature stats…</p>
                            </div>
                        </div>
                        <ul class="stat-progress-list" data-loos-feature-list hidden></ul>
                    </div>

                    <div class="stat-section">
                        <p class="stat-heading">Top areas</p>
                        <div class="async-state" data-loos-areas-loading>
                            <div class="loading-indicator">
                                <span class="loading-spinner" aria-hidden="true"></span>
                                <p>Gathering area insights…</p>
                            </div>
                        </div>
                        <ul class="stat-list" data-loos-area-list hidden></ul>
                    </div>
                </div>
            </section>

            <section class="table-controls">
                <div class="table-controls__row">
                    <form
                        method="get"
                        action={CURRENT_PATH}
                        class="search-form"
                        data-autosubmit="search"
                        data-allow-empty="true"
                    >
                        <div class="search-form__row">
                            <div class="search-input-wrapper">
                                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                                <input
                                    type="text"
                                    class="search-input"
                                    placeholder="Search by name, notes, geohash, or area"
                                    name="search"
                                    value={searchQuery}
                                    autocomplete="off"
                                />
                                {searchQuery && (
                                    <button type="button" class="search-clear-btn" data-clear-search>
                                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                                    </button>
                                )}
                            </div>
                        </div>

                        <div class="filter-controls" role="group" aria-label="Filters">
                            {TABLE_FILTERS.map((filter) => (
                                <div class="filter-select-wrapper">
                                    <label class="visually-hidden" for={`filter-${filter.key}`}>
                                        {filter.label}
                                    </label>
                                    <select
                                        id={`filter-${filter.key}`}
                                        class="filter-select"
                                        name={filter.key}
                                        onchange="this.form.requestSubmit()"
                                    >
                                        {filter.options.map((opt) => (
                                            <option
                                                value={opt.value}
                                                selected={(filtersState as Record<string, string>)[filter.key] === opt.value}
                                            >
                                                {opt.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            ))}
                        </div>

                        {renderHiddenStateInputs(state, {
                            omit: ['search', ...TABLE_FILTERS.map((filter) => filter.key)],
                            overrides: { page: '1' },
                        })}
                    </form>

                    <button type="button" class="button button--secondary" data-loos-refresh>
                        <i class="fa-solid fa-rotate" aria-hidden="true"></i>
                        <span style="margin-left: var(--space-3xs);">Refresh data</span>
                    </button>
                </div>

                {appliedFilters.length > 0 && (
                    <div class="active-filters">
                        {appliedFilters.map((filter) => (
                            <form method="get" action={CURRENT_PATH} class="filter-chip">
                                <span class="filter-chip__label">
                                    {filter.label}: {filter.valueLabel}
                                </span>
                                <button
                                    type="submit"
                                    class="filter-chip__remove"
                                    aria-label={`Remove filter ${filter.label}`}
                                >
                                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                                </button>
                                {renderHiddenStateInputs(state, {
                                    omit: [filter.key],
                                    overrides: { page: '1' },
                                })}
                            </form>
                        ))}
                        <a class="filter-chip filter-chip--reset" href={clearFiltersUrl}>
                            <i class="fa-solid fa-rotate" aria-hidden="true"></i>
                            <span class="filter-chip__label">Reset filters</span>
                        </a>
                    </div>
                )}
            </section>

            <section class="table-section">
                <div class="table-overflow" data-loos-table-root>
                    <div class="async-state" data-loos-table-loading>
                        <div class="loading-indicator">
                            <span class="loading-spinner" aria-hidden="true"></span>
                            <p>Loading loos…</p>
                        </div>
                    </div>
                    <div class="async-state async-state--error" data-loos-table-error hidden>
                        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                        <p>We could not load the loos right now.</p>
                        <button type="button" class="button" data-loos-retry>Try again</button>
                    </div>
                    <div class="async-state async-state--empty" data-loos-table-empty hidden>
                        <i class="fa-solid fa-inbox" aria-hidden="true"></i>
                        <h3>No results match this filter set</h3>
                        <p>Try broadening your filters or resetting pagination.</p>
                    </div>
                    <table class="data-table" data-loos-table hidden>
                        <thead>
                            <tr>
                                {TABLE_COLUMNS.map((column) => {
                                    const isSortable = Boolean(column.sortKey);
                                    const headerClass = [
                                        isSortable ? 'sortable' : '',
                                        column.sortKey && uiSortBy === column.sortKey ? 'sorted' : '',
                                    ]
                                        .filter(Boolean)
                                        .join(' ');
                                    if (isSortable && column.sortKey) {
                                        const sortLink = buildSortUrl(state, uiSortBy, uiSortOrder, column.sortKey);
                                        return (
                                            <th class={headerClass}>
                                                <a href={sortLink} style="color: inherit; text-decoration: none;">
                                                    {column.label}
                                                    {renderSortIcon(uiSortBy, uiSortOrder, column.sortKey)}
                                                </a>
                                            </th>
                                        );
                                    }
                                    return <th class={headerClass}>{column.label}</th>;
                                })}
                            </tr>
                        </thead>
                        <tbody data-loos-table-body></tbody>
                    </table>
                </div>

                <div class="pagination" data-loos-pagination>
                    <div class="pagination-info" data-loos-pagination-info>
                        Loading dataset stats…
                    </div>
                    <div class="pagination-controls">
                        <a
                            href={buildUrl(state, { page: String(Math.max(1, page - 1)) })}
                            class="pagination-btn"
                            data-loos-prev
                            style={page <= 1 ? 'pointer-events: none; opacity: 0.4;' : ''}
                        >
                            <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                        </a>
                        <div class="pagination-dynamic" data-loos-page-buttons></div>
                        <a
                            href={buildUrl(state, { page: String(page + 1) })}
                            class="pagination-btn"
                            data-loos-next
                        >
                            <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                        </a>
                    </div>
                    <div class="page-size-selector">
                        <label for="page-size-select">Show:</label>
                        <form method="get" action={CURRENT_PATH} style="display: inline-block;">
                            <select id="page-size-select" name="pageSize" onchange="this.form.submit()">
                                {PAGE_SIZE_OPTIONS.map((size) => (
                                    <option value={size} selected={pageSize === size}>
                                        {size}
                                    </option>
                                ))}
                            </select>
                            {renderHiddenStateInputs(state, {
                                omit: ['pageSize'],
                                overrides: { page: '1' },
                            })}
                        </form>
                    </div>
                </div>
            </section>

            <script
                type="application/json"
                id="loos-page-config"
                dangerouslySetInnerHTML={{ __html: serializedConfig }}
            ></script>
            <script dangerouslySetInnerHTML={{ __html: loosListClientScript }}></script>
        </Layout>,
    );
};
