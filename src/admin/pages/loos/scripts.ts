type FilterMappings = Record<string, { param: string; mapping?: Record<string, string> }>;
type SortOrder = 'asc' | 'desc';

type ScriptState = {
    search: string;
    page: number;
    pageSize: number;
    sortBy: string;
    sortOrder: SortOrder;
    hasCustomSort: boolean;
    filters: Record<string, string>;
};

type SearchResponse = {
    data: Array<Record<string, unknown>>;
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
};

type MetricsResponse = {
    totals?: Record<string, number>;
    areas?: Array<{ name: string | null; count: number }>;
};

const loosListClientBootstrap = () => {
    if (typeof window === 'undefined') {
        return;
    }

    const isObject = (value: unknown): value is Record<string, unknown> => {
        return typeof value === 'object' && value !== null;
    };

    const configEl = document.getElementById('loos-page-config');
    if (!configEl) {
        return;
    }

    let config: Record<string, unknown> = {};
    try {
        const raw = configEl.textContent || '{}';
        config = JSON.parse(raw);
    } catch (error) {
        console.error('Failed to parse loos page config', error);
        return;
    }

    const queryConfig = isObject(config.query) ? (config.query as Record<string, unknown>) : {};
    const filtersInput = isObject(queryConfig.filters) ? (queryConfig.filters as Record<string, unknown>) : {};
    const normalizedFilters: Record<string, string> = {};
    Object.keys(filtersInput).forEach((key) => {
        const value = filtersInput[key];
        if (typeof value === 'string') {
            normalizedFilters[key] = value;
        }
    });

    const state: ScriptState = {
        search: typeof queryConfig.search === 'string' ? queryConfig.search : '',
        page: Number(queryConfig.page) || 1,
        pageSize: Number(queryConfig.pageSize) || 25,
        sortBy: typeof queryConfig.sortBy === 'string' ? queryConfig.sortBy : 'updated_at',
        sortOrder: queryConfig.sortOrder === 'asc' ? 'asc' : 'desc',
        hasCustomSort: Boolean(queryConfig.hasCustomSort),
        filters: normalizedFilters,
    };

    const filterMappings: FilterMappings = isObject(config.filterMappings)
        ? (config.filterMappings as FilterMappings)
        : {};
    const areaColors = Array.isArray(config.areaColors)
        ? (config.areaColors as unknown[]).filter((color): color is string => typeof color === 'string')
        : [];
    const recentWindowDays = Number(config.recentWindowDays) || 14;
    const currentPath = typeof config.currentPath === 'string' ? config.currentPath : window.location.pathname;
    const apiConfig = isObject(config.api) ? (config.api as Record<string, unknown>) : {};
    const searchEndpoint = typeof apiConfig.search === 'string' ? apiConfig.search : '/api/loos/search';
    const metricsEndpoint = typeof apiConfig.metrics === 'string' ? apiConfig.metrics : '/api/loos/metrics';

    const querySelector = <T extends Element>(selector: string, root?: Document | Element | null) => {
        const context: Document | Element = root || document;
        const element = context.querySelector(selector);
        return (element as T | null) || null;
    };

    const tableRoot = querySelector<HTMLElement>('[data-loos-table-root]');
    const table = querySelector<HTMLTableElement>('[data-loos-table]', tableRoot);
    const tableBody = querySelector<HTMLTableSectionElement>('[data-loos-table-body]', table);
    const tableLoading = querySelector<HTMLElement>('[data-loos-table-loading]', tableRoot);
    const tableError = querySelector<HTMLElement>('[data-loos-table-error]', tableRoot);
    const tableEmpty = querySelector<HTMLElement>('[data-loos-table-empty]', tableRoot);
    const retryButton = querySelector<HTMLButtonElement>('[data-loos-retry]', tableRoot);
    const refreshButton = querySelector<HTMLButtonElement>('[data-loos-refresh]');
    const paginationInfo = querySelector<HTMLElement>('[data-loos-pagination-info]');
    const paginationButtons = querySelector<HTMLElement>('[data-loos-page-buttons]');
    const prevLink = querySelector<HTMLAnchorElement>('[data-loos-prev]');
    const nextLink = querySelector<HTMLAnchorElement>('[data-loos-next]');
    const insightsContainer = querySelector<HTMLElement>('[data-loos-insights]');
    const featureList = querySelector<HTMLElement>('[data-loos-feature-list]');
    const featureLoading = querySelector<HTMLElement>('[data-loos-features-loading]');
    const areaList = querySelector<HTMLElement>('[data-loos-area-list]');
    const areaLoading = querySelector<HTMLElement>('[data-loos-areas-loading]');

    const numberFormatter = new Intl.NumberFormat('en-GB');
    let activeController: AbortController | null = null;

    const toggle = (el: Element | null, shouldShow: boolean) => {
        if (!el) return;
        if (shouldShow) {
            el.removeAttribute('hidden');
        } else {
            el.setAttribute('hidden', 'true');
        }
    };

    const setTableState = (view: 'loading' | 'error' | 'empty' | 'data') => {
        toggle(tableLoading, view === 'loading');
        toggle(tableError, view === 'error');
        toggle(tableEmpty, view === 'empty');
        toggle(table, view === 'data');
    };

    const disableActions = (disabled: boolean) => {
        if (refreshButton) refreshButton.disabled = disabled;
        if (retryButton) retryButton.disabled = disabled;
    };

    const sanitizeSortColumn = (column: string) => {
        const allowed = ['name', 'updated_at', 'verified_at', 'created_at'];
        return allowed.indexOf(column) >= 0 ? column : 'updated_at';
    };

    const mapSortToApiSort = (column: string, order: SortOrder) => {
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

    const getEffectiveSort = (): { column: string; order: SortOrder } => {
        if (state.hasCustomSort) {
            return {
                column: sanitizeSortColumn(state.sortBy),
                order: state.sortOrder,
            };
        }
        return { column: 'updated_at', order: 'desc' };
    };

    const buildSearchParams = () => {
        const params = new URLSearchParams();
        if (state.search) {
            params.set('search', state.search);
        }
        params.set('page', String(state.page));
        params.set('limit', String(state.pageSize));
        const effectiveSort = getEffectiveSort();
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

    const buildMetricsParams = () => {
        const params = buildSearchParams();
        params.delete('limit');
        params.delete('page');
        params.set('recentWindowDays', String(recentWindowDays));
        return params;
    };

    const escapeHtml = (value: string) => {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    const formatDate = (value?: string | null) => {
        if (!value) return '—';
        const date = new Date(value);
        if (isNaN(date.getTime())) return '—';
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const percentage = (value: number, total: number) => {
        if (!total) return 0;
        return Math.round((value / total) * 100);
    };

    const getOpeningLabel = (openingTimes: unknown): string => {
        if (!Array.isArray(openingTimes) || openingTimes.length === 0) {
            return 'Hours unknown';
        }
        const normalized = openingTimes.filter(
            (slot) => Array.isArray(slot) && slot.length === 2 && slot[0] && slot[1],
        );
        if (
            normalized.length === openingTimes.length &&
            normalized.every((slot) => slot[0] === '00:00' && slot[1] === '00:00')
        ) {
            return 'Open 24h';
        }
        if (normalized.length > 0) {
            return 'Custom hours';
        }
        return 'Hours unknown';
    };

    const buildNavigationUrl = (overrides: Record<string, string | number | undefined> = {}) => {
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

    const updateInsights = (metrics: MetricsResponse, totalCount: number) => {
        if (!insightsContainer) return;
        const searchMeta = state.search ? 'Matching “' + state.search + '”' : 'Full dataset slice';
        const totals = metrics.totals || {};
        const cards = [
            { title: 'Filtered records', value: totalCount, meta: searchMeta },
            {
                title: 'Active coverage',
                value: totals.active || 0,
                meta: percentage(totals.active || 0, totalCount) + '% active',
            },
            {
                title: 'Accessibility ready',
                value: totals.accessible || 0,
                meta: percentage(totals.accessible || 0, totalCount) + '% accessible',
            },
            {
                title: 'Updated last ' + recentWindowDays + 'd',
                value: totals.recent || 0,
                meta: totals.recent ? 'Recently edited' : 'Needs attention',
            },
        ];

        insightsContainer.innerHTML = cards
            .map(
                (card) => `
                    <div class="metric-card">
                        <p class="metric-label">${escapeHtml(card.title)}</p>
                        <p class="metric-value">${numberFormatter.format(card.value)}</p>
                        <p class="metric-meta">${escapeHtml(card.meta)}</p>
                    </div>
                `,
            )
            .join('');
    };

    const updateFeatureList = (metrics: MetricsResponse, totalCount: number) => {
        if (!featureList) return;
        const totals = metrics.totals || {};
        const stats = [
            { label: 'Baby changing', value: totals.babyChange || 0 },
            { label: 'RADAR key', value: totals.radar || 0 },
            { label: 'Free to use', value: totals.freeAccess || 0 },
            { label: 'Verified', value: totals.verified || 0 },
        ];
        featureList.innerHTML = stats
            .map((stat) => {
                const pct = percentage(stat.value, totalCount);
                return `
                    <li class="stat-progress-item">
                        <div class="stat-progress">
                            <span>${escapeHtml(stat.label)}</span>
                            <span>${numberFormatter.format(stat.value)}</span>
                        </div>
                        <div class="stat-progress-bar">
                            <div class="stat-progress-bar__fill" style="width: ${pct}%"></div>
                        </div>
                        <span class="stat-progress-meta">${pct}% of filtered set</span>
                    </li>
                `;
            })
            .join('');
        toggle(featureLoading, false);
        toggle(featureList, true);
    };

    const updateAreaList = (metrics: MetricsResponse) => {
        if (!areaList) return;
        const areas = Array.isArray(metrics.areas) ? metrics.areas : [];
        if (areas.length === 0) {
            areaList.innerHTML = `
                <li class="stat-list-item">
                    <span class="stat-list-label muted-text">No areas match the current filters.</span>
                </li>
            `;
        } else {
            areaList.innerHTML = areas
                .map((area, index) => {
                    const color = areaColors[index % areaColors.length] || '#0a165e';
                    return `
                        <li class="stat-list-item">
                            <span class="stat-list-label">
                                <span class="status-dot" style="background: ${color};"></span>
                                ${escapeHtml(area.name || 'Unnamed area')}
                            </span>
                            <strong>${numberFormatter.format(area.count || 0)}</strong>
                        </li>
                    `;
                })
                .join('');
        }
        toggle(areaLoading, false);
        toggle(areaList, true);
    };

    const showMetricsError = (message: string) => {
        if (insightsContainer) {
            insightsContainer.innerHTML = `
                <div class="metric-card metric-card--error">
                    <p class="metric-label">Metrics unavailable</p>
                    <p class="metric-meta">${escapeHtml(message)}</p>
                </div>
            `;
        }
        if (featureList) {
            featureList.innerHTML = '<li class="stat-progress-item"><span class="muted-text">' + escapeHtml(message) + '</span></li>';
            toggle(featureLoading, false);
            toggle(featureList, true);
        }
        if (areaList) {
            areaList.innerHTML = '<li class="stat-list-item"><span class="stat-list-label muted-text">' + escapeHtml(message) + '</span></li>';
            toggle(areaLoading, false);
            toggle(areaList, true);
        }
    };

    const renderRows = (rows: Array<Record<string, unknown>>) => {
        return rows
            .map((row) => {
                const name = typeof row.name === 'string' && row.name ? row.name : 'Unnamed location';
                const area = Array.isArray(row.area) && row.area[0] && typeof row.area[0].name === 'string'
                    ? row.area[0].name
                    : 'Unassigned area';
                const geohash = typeof row.geohash === 'string' ? row.geohash : '';
                const id = typeof row.id === 'string' ? row.id : '';
                const active = typeof row.active === 'boolean' ? row.active : null;
                const verificationDate =
                    typeof row.verified_at === 'string'
                        ? row.verified_at
                        : typeof row.verifiedAt === 'string'
                            ? row.verifiedAt
                            : null;
                const accessible = typeof row.accessible === 'boolean' ? row.accessible : null;
                const babyChange =
                    typeof row.baby_change === 'boolean'
                        ? row.baby_change
                        : typeof row.babyChange === 'boolean'
                            ? row.babyChange
                            : null;
                const noPayment =
                    typeof row.no_payment === 'boolean'
                        ? row.no_payment
                        : typeof row.noPayment === 'boolean'
                            ? row.noPayment
                            : null;
                const radar = typeof row.radar === 'boolean' ? row.radar : null;
                const updatedAt =
                    typeof row.updated_at === 'string'
                        ? row.updated_at
                        : typeof row.updatedAt === 'string'
                            ? row.updatedAt
                            : null;
                const createdAt =
                    typeof row.created_at === 'string'
                        ? row.created_at
                        : typeof row.createdAt === 'string'
                            ? row.createdAt
                            : null;
                const contributorsCount =
                    typeof row.contributorsCount === 'number'
                        ? row.contributorsCount
                        : typeof row.contributors_count === 'number'
                            ? row.contributors_count
                            : 0;
                const openingLabel = getOpeningLabel(row.openingTimes || (row as Record<string, unknown>).opening_times);

                const statusLabel = active === true ? 'Active' : active === false ? 'Inactive' : 'Status unknown';
                const statusTone = active === true ? 'positive' : active === false ? 'negative' : 'muted';
                const verificationLabel = verificationDate ? 'Verified ' + formatDate(verificationDate) : 'Awaiting verification';
                let accessLabel = 'Unknown';
                if (accessible === true) accessLabel = 'Accessible';
                if (accessible === false) accessLabel = 'Limited access';
                const facilities: string[] = [];
                if (babyChange === true) facilities.push('Baby change');
                if (babyChange === false) facilities.push('No baby change');
                if (radar === true) facilities.push('RADAR key');
                if (radar === false) facilities.push('Open access');
                const facilityValue = facilities.length ? facilities.join(' / ') : 'Details unavailable';
                let costLabel = 'Unknown';
                if (noPayment === true) costLabel = 'Free to use';
                if (noPayment === false) costLabel = 'Paid access';

                return `
                    <tr>
                        <td>
                            <div class="table-cell-primary">
                                <strong>${escapeHtml(name)}</strong>
                                <div class="table-cell-meta">
                                    <span>${escapeHtml(area)}</span>
                                    ${geohash ? '<span class="table-cell-subtle">' + escapeHtml(geohash) + '</span>' : ''}
                                    <span class="table-cell-subtle">#${escapeHtml(id.slice(-6))}</span>
                                </div>
                                <div class="meta-pill-group">
                                    <span class="meta-pill">${escapeHtml(openingLabel)}</span>
                                </div>
                            </div>
                        </td>
                        <td>
                            <div class="detail-stack">
                                <span class="status-line">
                                    <span class="status-dot status-dot--${statusTone}"></span>
                                    ${statusLabel}
                                </span>
                                <span class="muted-text">${escapeHtml(verificationLabel)}</span>
                            </div>
                        </td>
                        <td>
                            <div class="detail-stack">
                                <div class="detail-row">
                                    <span class="detail-label">Access</span>
                                    <span class="detail-value">${escapeHtml(accessLabel)}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">Facilities</span>
                                    <span class="detail-value">${escapeHtml(facilityValue)}</span>
                                </div>
                            </div>
                        </td>
                        <td>
                            <div class="detail-stack">
                                <div class="detail-row">
                                    <span class="detail-label">Cost</span>
                                    <span class="detail-value">${escapeHtml(costLabel)}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">Contributors</span>
                                    <span class="detail-value">${numberFormatter.format(contributorsCount)}</span>
                                </div>
                            </div>
                        </td>
                        <td>
                            <div class="detail-stack">
                                <div class="detail-row">
                                    <span class="detail-label">Updated</span>
                                    <span class="detail-value">${escapeHtml(formatDate(updatedAt))}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">Created</span>
                                    <span class="detail-value">${escapeHtml(formatDate(createdAt))}</span>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
            })
            .join('');
    };

    const updatePagination = (searchData: SearchResponse) => {
        const total = Number(searchData.total) || 0;
        const currentPage = Number(searchData.page) || state.page;
        const pageSize = Number(searchData.pageSize) || state.pageSize;
        const rowsCount = Array.isArray(searchData.data) ? searchData.data.length : 0;
        const totalPages = Math.max(1, Math.ceil(total / (pageSize || 1)));
        const startIndex = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
        const endIndex = total === 0 ? 0 : startIndex + rowsCount - 1;

        state.page = currentPage;
        state.pageSize = pageSize;

        if (paginationInfo) {
            paginationInfo.textContent =
                total === 0 ? 'No results to display' : 'Showing ' + startIndex + '-' + endIndex + ' of ' + numberFormatter.format(total);
        }

        if (paginationButtons) {
            if (total === 0) {
                paginationButtons.innerHTML = '<span class="muted-text">No pages to display</span>';
            } else {
                const buttons: string[] = [];
                const visibleCount = Math.min(5, totalPages);
                let startPage = 1;
                if (totalPages > 5) {
                    if (currentPage <= 3) {
                        startPage = 1;
                    } else if (currentPage >= totalPages - 2) {
                        startPage = totalPages - 4;
                    } else {
                        startPage = currentPage - 2;
                    }
                }
                for (let i = 0; i < visibleCount; i += 1) {
                    const pageNum = startPage + i;
                    const isActive = pageNum === currentPage;
                    buttons.push(
                        '<a href="' +
                            buildNavigationUrl({ page: pageNum }) +
                            '" class="pagination-btn' +
                            (isActive ? ' active' : '') +
                            '">' +
                            pageNum +
                            '</a>',
                    );
                }
                paginationButtons.innerHTML = buttons.join('');
            }
        }

        const disablePrev = currentPage <= 1;
        if (prevLink) {
            prevLink.href = buildNavigationUrl({ page: Math.max(1, currentPage - 1) });
            prevLink.style.pointerEvents = disablePrev ? 'none' : '';
            prevLink.style.opacity = disablePrev ? '0.4' : '';
        }

        const disableNext = !searchData.hasMore || currentPage >= totalPages;
        if (nextLink) {
            nextLink.href = buildNavigationUrl({ page: Math.min(totalPages, currentPage + 1) });
            nextLink.style.pointerEvents = disableNext ? 'none' : '';
            nextLink.style.opacity = disableNext ? '0.4' : '';
        }
    };

    const updateTable = (searchData: SearchResponse) => {
        if (!tableBody) return;
        const rows = Array.isArray(searchData.data) ? searchData.data : [];
        if (rows.length === 0) {
            tableBody.innerHTML = '';
            setTableState('empty');
        } else {
            tableBody.innerHTML = renderRows(rows);
            setTableState('data');
        }
        updatePagination(searchData);
    };

    const fetchJson = async <T>(path: string, params: URLSearchParams, signal: AbortSignal): Promise<T> => {
        const response = await fetch(path + '?' + params.toString(), { signal });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(text || 'Request failed with ' + response.status);
        }
        return response.json() as Promise<T>;
    };

    const loadMetrics = async (signal: AbortSignal, totalCount: number) => {
        try {
            const metrics = await fetchJson<MetricsResponse>(metricsEndpoint, buildMetricsParams(), signal);
            updateInsights(metrics, totalCount);
            updateFeatureList(metrics, totalCount);
            updateAreaList(metrics);
        } catch (error) {
            console.error('Failed to load metrics', error);
            showMetricsError('Unable to load metrics right now. Please try refreshing.');
        }
    };

    const loadData = async () => {
        if (activeController) {
            activeController.abort();
        }
        const controller = new AbortController();
        activeController = controller;

        disableActions(true);
        setTableState('loading');

        try {
            const searchData = await fetchJson<SearchResponse>(searchEndpoint, buildSearchParams(), controller.signal);
            if (controller.signal.aborted) {
                return;
            }
            updateTable(searchData);
            await loadMetrics(controller.signal, Number(searchData.total) || 0);
        } catch (error) {
            if (controller.signal.aborted) {
                return;
            }
            console.error('Failed to load loos data', error);
            setTableState('error');
        } finally {
            if (activeController === controller) {
                activeController = null;
            }
            disableActions(false);
        }
    };

    if (refreshButton) {
        refreshButton.addEventListener('click', () => {
            loadData();
        });
    }

    if (retryButton) {
        retryButton.addEventListener('click', () => {
            loadData();
        });
    }

    loadData();
};

const nameHelper = `
if (typeof __name === "undefined") {
  var __name = function(target, value) {
    try {
      Object.defineProperty(target, "name", { value, configurable: true });
    } catch (_) {
      // ignore defineProperty failures (IE, older browsers)
    }
    return target;
  };
}
`.trim();

export const loosListClientScript = `${nameHelper};(${loosListClientBootstrap.toString()})();`;
