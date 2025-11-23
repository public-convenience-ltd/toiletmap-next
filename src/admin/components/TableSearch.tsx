import { Badge } from './DesignSystem';

interface Column {
    key: string;
    label: string;
    sortable?: boolean;
    render?: (value: any, row: any) => any;
}

interface Filter {
    key: string;
    label: string;
    options: { value: string; label: string }[];
}

interface TableSearchProps {
    data: any[];
    columns: Column[];
    filters?: Filter[];
    searchPlaceholder?: string;
    emptyMessage?: string;
    pageSize?: number;
    currentPage?: number;
    searchQuery?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    activeFilters?: Record<string, string>;
    currentPath?: string;
    mode?: 'client' | 'server';
    totalItems?: number;
    datasetLabel?: string;
    persistedParams?: Record<string, string>;
}

const getFilterLabel = (filters: Filter[], key: string, value: string) => {
    const filter = filters.find((f) => f.key === key);
    return filter?.options.find((opt) => opt.value === value)?.label;
};

export const TableSearch = (props: TableSearchProps) => {
    const {
        data,
        columns,
        filters = [],
        searchPlaceholder = 'Search...',
        emptyMessage = 'No records found for this view.',
        pageSize = 25,
        currentPage = 1,
        searchQuery = '',
        sortBy = '',
        sortOrder = 'asc',
        activeFilters = {},
        currentPath = '/admin/loos',
        mode = 'client',
        totalItems: totalItemsProp,
        persistedParams = {},
    } = props;

    const isServerMode = mode === 'server';

    const buildBaseParams = () => {
        const params = new URLSearchParams();
        Object.entries(persistedParams).forEach(([key, value]) => {
            params.set(key, value);
        });
        if (searchQuery) params.set('search', searchQuery);
        if (sortBy) {
            params.set('sortBy', sortBy);
            params.set('sortOrder', sortOrder);
        }
        if (pageSize) params.set('pageSize', String(pageSize));
        if (currentPage) params.set('page', String(currentPage));
        Object.entries(activeFilters).forEach(([key, value]) => {
            if (value && value !== 'all') {
                params.set(key, value);
            }
        });
        return params;
    };

    const buildUrl = (newParams: Record<string, string | number | undefined | null>) => {
        const params = buildBaseParams();
        Object.entries(newParams).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') {
                params.delete(key);
            } else {
                params.set(key, String(value));
            }
        });
        const query = params.toString();
        return query ? `${currentPath}?${query}` : currentPath;
    };

    const renderHiddenStateInputs = (options?: { omit?: string[]; overrides?: Record<string, string> }) => {
        const params = buildBaseParams();
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

    let workingData = [...data];

    if (!isServerMode && searchQuery) {
        const query = searchQuery.toLowerCase();
        workingData = workingData.filter((row) =>
            columns.some((col) => {
                const value = row[col.key];
                if (value === null || value === undefined) return false;
                return String(value).toLowerCase().includes(query);
            })
        );
    }

    if (!isServerMode && Object.keys(activeFilters).length > 0) {
        Object.entries(activeFilters).forEach(([key, value]) => {
            if (value && value !== 'all') {
                workingData = workingData.filter((row) => {
                    const rowValue = row[key];
                    if (value === 'true') return rowValue === true;
                    if (value === 'false') return rowValue === false;
                    if (value === 'null') return rowValue === null || rowValue === undefined;
                    return String(rowValue) === value;
                });
            }
        });
    }

    if (!isServerMode && sortBy) {
        workingData = [...workingData].sort((a, b) => {
            const aVal = a[sortBy];
            const bVal = b[sortBy];

            if (aVal === null || aVal === undefined) return 1;
            if (bVal === null || bVal === undefined) return -1;

            let comparison = 0;
            if (typeof aVal === 'string') {
                comparison = aVal.localeCompare(bVal);
            } else if (aVal instanceof Date && bVal instanceof Date) {
                comparison = aVal.getTime() - bVal.getTime();
            } else {
                comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            }

            return sortOrder === 'asc' ? comparison : -comparison;
        });
    }

    const computedTotalItems = isServerMode ? (totalItemsProp ?? workingData.length) : workingData.length;
    const safePage = Math.max(1, currentPage);
    const totalPages = Math.max(1, Math.ceil(computedTotalItems / pageSize));
    const normalizedPage = Math.min(safePage, totalPages);
    const startIndex = computedTotalItems === 0 ? 0 : (normalizedPage - 1) * pageSize;

    const paginatedData = isServerMode
        ? workingData
        : workingData.slice(startIndex, startIndex + pageSize);

    const endIndex = computedTotalItems === 0
        ? 0
        : Math.min(startIndex + paginatedData.length, computedTotalItems);

    const renderSortIcon = (colKey: string) => {
        if (sortBy !== colKey) {
            return <i class="fa-solid fa-sort sort-icon" aria-hidden="true"></i>;
        }
        if (sortOrder === 'asc') {
            return <i class="fa-solid fa-sort-up sort-icon" aria-hidden="true"></i>;
        }
        return <i class="fa-solid fa-sort-down sort-icon" aria-hidden="true"></i>;
    };

    const handleSort = (colKey: string) => {
        if (sortBy !== colKey) {
            return buildUrl({ sortBy: colKey, sortOrder: 'asc', page: '1' });
        }
        if (sortOrder !== 'desc') {
            return buildUrl({ sortOrder: 'desc', page: '1' });
        }
        return buildUrl({ sortBy: '', sortOrder: '', page: '1' });
    };

    const appliedFilters = filters
        .map((filter) => {
            const value = activeFilters[filter.key];
            if (!value || value === 'all') return null;
            return {
                key: filter.key,
                label: filter.label,
                value,
                valueLabel: getFilterLabel(filters, filter.key, value) ?? value,
            };
        })
        .filter(Boolean) as { key: string; label: string; value: string; valueLabel: string }[];

    const clearFiltersUrl = buildUrl(
        filters.reduce(
            (acc, filter) => ({ ...acc, [filter.key]: '' }),
            { page: '1' } as Record<string, string>
        )
    );

    return (
        <div class="table-container">
            <div class="search-bar">
                <form
                    method="get"
                    action={currentPath}
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
                                placeholder={searchPlaceholder}
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

                    {filters.length > 0 && (
                        <div class="filter-controls" role="group" aria-label="Filters">
                            {filters.map((filter) => (
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
                                        {filter.options.map((opt) => {
                                            const currentValue = activeFilters[filter.key] ?? 'all';
                                            return (
                                                <option value={opt.value} selected={currentValue === opt.value}>
                                                    {opt.label}
                                                </option>
                                            );
                                        })}
                                    </select>
                                </div>
                            ))}
                        </div>
                    )}

                    {renderHiddenStateInputs({
                        omit: ['search', ...filters.map((filter) => filter.key)],
                        overrides: { page: '1' },
                    })}
                </form>
            </div>

            {appliedFilters.length > 0 && (
                <div class="active-filters">
                    {appliedFilters.map((filter) => (
                        <form method="get" action={currentPath} class="filter-chip">
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
                            {renderHiddenStateInputs({
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

            <div class="table-overflow">
                {paginatedData.length === 0 ? (
                    <div class="empty-state">
                        <i class="fa-solid fa-inbox" aria-hidden="true"></i>
                        <h3>No Results Found</h3>
                        <p>{emptyMessage}</p>
                    </div>
                ) : (
                    <table class="data-table">
                        <thead>
                            <tr>
                                {columns.map((col) => {
                                    const headerClass = [
                                        col.sortable ? 'sortable' : '',
                                        sortBy === col.key ? 'sorted' : '',
                                    ]
                                        .filter(Boolean)
                                        .join(' ');
                                    return (
                                        <th class={headerClass}>
                                            {col.sortable ? (
                                                <a
                                                    href={handleSort(col.key)}
                                                    style="color: inherit; text-decoration: none;"
                                                >
                                                    {col.label}
                                                    {renderSortIcon(col.key)}
                                                </a>
                                            ) : (
                                                col.label
                                            )}
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedData.map((row) => (
                                <tr>
                                    {columns.map((col) => (
                                        <td>
                                            {col.render ? col.render(row[col.key], row) : row[col.key]}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {computedTotalItems > 0 && (
                <div class="pagination">
                    <div class="pagination-info">
                        Showing {computedTotalItems === 0 ? 0 : startIndex + 1}-{endIndex} of {computedTotalItems}
                    </div>

                    <div class="pagination-controls">
                        <a
                            href={buildUrl({ page: String(Math.max(1, normalizedPage - 1)) })}
                            class="pagination-btn"
                            style={normalizedPage === 1 ? 'pointer-events: none; opacity: 0.4;' : ''}
                        >
                            <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                        </a>

                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                            let pageNum;
                            if (totalPages <= 5) {
                                pageNum = i + 1;
                            } else if (safePage <= 3) {
                                pageNum = i + 1;
                            } else if (safePage >= totalPages - 2) {
                                pageNum = totalPages - 4 + i;
                            } else {
                                pageNum = safePage - 2 + i;
                            }
                            return (
                                <a
                                    href={buildUrl({ page: String(pageNum) })}
                                    class={`pagination-btn ${pageNum === normalizedPage ? 'active' : ''}`}
                                >
                                    {pageNum}
                                </a>
                            );
                        })}

                        <a
                            href={buildUrl({ page: String(Math.min(totalPages, normalizedPage + 1)) })}
                            class="pagination-btn"
                            style={normalizedPage === totalPages ? 'pointer-events: none; opacity: 0.4;' : ''}
                        >
                            <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                        </a>
                    </div>

                    <div class="page-size-selector">
                        <label for="page-size-select">Show:</label>
                        <form method="get" action={currentPath} style="display: inline-block;">
                            <select
                                id="page-size-select"
                                name="pageSize"
                                onchange="this.form.submit()"
                            >
                                {[10, 25, 50, 100].map((size) => (
                                    <option value={size} selected={pageSize === size}>
                                        {size}
                                    </option>
                                ))}
                            </select>
                            {renderHiddenStateInputs({
                                omit: ['pageSize'],
                                overrides: { page: '1' },
                            })}
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export const BooleanBadge = (
    value: boolean | null | undefined,
    trueLabel = 'Yes',
    falseLabel = 'No',
    unknownLabel = 'Unknown',
) => {
    if (value === true) {
        return <Badge variant="yes" icon="fa-check">{trueLabel}</Badge>;
    }
    if (value === false) {
        return <Badge variant="no" icon="fa-xmark">{falseLabel}</Badge>;
    }
    return <Badge variant="unknown" icon="fa-question">{unknownLabel}</Badge>;
};

export const formatDate = (date: Date | string | null | undefined) => {
    if (!date) return '—';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
