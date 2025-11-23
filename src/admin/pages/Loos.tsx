import { Context } from 'hono';
import { Layout } from '../components/Layout';
import { TriStateToggle, Input, Button, TextArea } from '../components/DesignSystem';
import { TableSearch, formatDate } from '../components/TableSearch';
import { looSchema } from '../utils/validation';
import { Env } from '../../types';
import { RECENT_WINDOW_DAYS } from '../../common/constants';
import { getSession } from '../utils/session';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const AREA_COLORS = ['#0a165e', '#ed3d62', '#92f9db', '#f4c430', '#7b61ff'];

const TABLE_FILTERS = [
    {
        key: 'status',
        label: 'Status',
        options: [
            { value: 'all', label: 'Any status' },
            { value: 'active', label: 'Active only' },
            { value: 'inactive', label: 'Inactive only' },
        ],
    },
    {
        key: 'access',
        label: 'Accessibility',
        options: [
            { value: 'all', label: 'All toilets' },
            { value: 'accessible', label: 'Accessible' },
            { value: 'not_accessible', label: 'Not accessible' },
        ],
    },
    {
        key: 'payment',
        label: 'Payment',
        options: [
            { value: 'all', label: 'Free & paid' },
            { value: 'free', label: 'Free to use' },
            { value: 'paid', label: 'Requires payment' },
        ],
    },
    {
        key: 'verification',
        label: 'Verification',
        options: [
            { value: 'all', label: 'Any verification state' },
            { value: 'verified', label: 'Verified' },
            { value: 'unverified', label: 'Awaiting verification' },
        ],
    },
] as const;

const clampPageSize = (value: number) => {
    return PAGE_SIZE_OPTIONS.includes(value as typeof PAGE_SIZE_OPTIONS[number]) ? value : 25;
};

const percentage = (value: number, total: number) => {
    if (!total) return 0;
    return Math.round((value / total) * 100);
};

type OpeningSchedule = [string, string][];

type ApiLoo = {
    id: string;
    name: string | null;
    area: Array<{ name: string | null }>;
    geohash: string | null;
    active: boolean | null;
    verifiedAt: string | null;
    accessible: boolean | null;
    babyChange: boolean | null;
    noPayment: boolean | null;
    radar: boolean | null;
    updatedAt: string | null;
    createdAt: string | null;
    contributorsCount?: number;
    openingTimes: OpeningSchedule | null;
};

type LooSearchResponse = {
    data: ApiLoo[];
    count: number;
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
};

type LooMetricsResponse = {
    recentWindowDays: number;
    totals: {
        filtered: number;
        active: number;
        verified: number;
        accessible: number;
        babyChange: number;
        radar: number;
        freeAccess: number;
        recent: number;
    };
    areas: Array<{
        areaId: string | null;
        name: string;
        count: number;
    }>;
};

const getOpeningLabel = (openingTimes: unknown): string => {
    if (!openingTimes || !Array.isArray(openingTimes)) return 'Hours unknown';
    const schedule = openingTimes as OpeningSchedule;
    if (schedule.length === 0) return 'Temporarily closed';

    const normalized = schedule.filter((slot) => Array.isArray(slot) && slot.length === 2 && slot[0] && slot[1]);
    if (
        normalized.length === schedule.length &&
        normalized.every((slot) => slot[0] === '00:00' && slot[1] === '00:00')
    ) {
        return 'Open 24h';
    }

    if (normalized.length > 0) return 'Custom hours';
    return 'Hours unknown';
};

const mapSortToApiSort = (column: string, order: 'asc' | 'desc') => {
    switch (column) {
        case 'name':
            return order === 'asc' ? 'name-asc' : 'name-desc';
        case 'created_at':
            return order === 'asc' ? 'created-asc' : 'created-desc';
        case 'verified_at':
            return order === 'asc' ? 'verified-asc' : 'verified-desc';
        case 'updated_at':
        default:
            return order === 'asc' ? 'updated-asc' : 'updated-desc';
    }
};

const fetchApiJson = async <T,>(
    c: Context,
    path: string,
    searchParams?: URLSearchParams,
): Promise<T> => {
    const url = new URL(path, c.req.url);
    if (searchParams) {
        url.search = searchParams.toString();
    }
    const response = await fetch(url);
    if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(`API request failed (${response.status}): ${message || url.pathname}`);
    }
    return response.json() as Promise<T>;
};

export const loosList = async (c: Context<{ Bindings: Env }>) => {
    const url = new URL(c.req.url);

    const searchQuery = (url.searchParams.get('search') ?? '').trim();
    const requestedPage = parseInt(url.searchParams.get('page') ?? '1', 10);
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const requestedPageSize = parseInt(url.searchParams.get('pageSize') ?? '25', 10);
    const pageSize = clampPageSize(requestedPageSize);

    const sortCandidates = ['name', 'updated_at', 'verified_at', 'created_at'] as const;
    type SortKey = typeof sortCandidates[number];
    const sortParam = url.searchParams.get('sortBy');
    const normalizedSortParam =
        sortParam && sortCandidates.includes(sortParam as SortKey) ? (sortParam as SortKey) : null;
    const sortBy: SortKey = normalizedSortParam ?? 'updated_at';
    const hasCustomSort = Boolean(normalizedSortParam);
    const sortOrder = url.searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';

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

    const filterConfig = TABLE_FILTERS.map((filter) => ({
        key: filter.key,
        label: filter.label,
        options: filter.options.map((option) => ({
            value: option.value,
            label: option.label,
        })),
    }));

    try {
        const applyFilterMapping = (
            params: URLSearchParams,
            value: string,
            key: string,
            mapping: Record<string, 'true' | 'false'>,
        ) => {
            const mapped = mapping[value];
            if (mapped) {
                params.set(key, mapped);
            }
        };

        const apiSearchParams = new URLSearchParams();
        if (searchQuery) {
            apiSearchParams.set('search', searchQuery);
        }
        apiSearchParams.set('page', String(page));
        apiSearchParams.set('limit', String(pageSize));
        apiSearchParams.set('sort', mapSortToApiSort(sortBy, sortOrder));
        applyFilterMapping(apiSearchParams, filtersState.status, 'active', { active: 'true', inactive: 'false' });
        applyFilterMapping(apiSearchParams, filtersState.access, 'accessible', {
            accessible: 'true',
            not_accessible: 'false',
        });
        applyFilterMapping(apiSearchParams, filtersState.payment, 'noPayment', { free: 'true', paid: 'false' });
        applyFilterMapping(apiSearchParams, filtersState.verification, 'verified', {
            verified: 'true',
            unverified: 'false',
        });

        const searchResponse = await fetchApiJson<LooSearchResponse>(c, '/api/loos/search', apiSearchParams);
        const totalCount = searchResponse.total;
        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        let resolvedPage = Math.min(page, totalPages);
        let pagedLoos = searchResponse.data;

        if (totalCount > 0 && pagedLoos.length === 0 && page > totalPages) {
            resolvedPage = totalPages;
            const fallbackParams = new URLSearchParams(apiSearchParams);
            fallbackParams.set('page', String(resolvedPage));
            const fallbackResponse = await fetchApiJson<LooSearchResponse>(c, '/api/loos/search', fallbackParams);
            pagedLoos = fallbackResponse.data;
        }

        const metricsParams = new URLSearchParams(apiSearchParams);
        metricsParams.delete('limit');
        metricsParams.delete('page');
        metricsParams.set('recentWindowDays', RECENT_WINDOW_DAYS.toString());
        const metrics = await fetchApiJson<LooMetricsResponse>(c, '/api/loos/metrics', metricsParams);

        const tableRows = pagedLoos.map((loo) => ({
            id: loo.id,
            name: loo.name ?? 'Unnamed location',
            areaName: loo.area[0]?.name ?? 'Unassigned area',
            geohash: loo.geohash,
            active: loo.active,
            verified_at: loo.verifiedAt,
            accessible: loo.accessible,
            baby_change: loo.babyChange,
            no_payment: loo.noPayment,
            radar: loo.radar,
            updated_at: loo.updatedAt,
            created_at: loo.createdAt,
            contributorsCount: loo.contributorsCount ?? 0,
            openingLabel: getOpeningLabel(loo.openingTimes as unknown),
        }));

        const insightCards = [
            {
                title: 'Filtered records',
                value: totalCount,
                meta: searchQuery ? `Matching “${searchQuery}”` : 'Full dataset slice',
            },
            {
                title: 'Active coverage',
                value: metrics.totals.active,
                meta: `${percentage(metrics.totals.active, totalCount)}% active`,
            },
            {
                title: 'Accessibility ready',
                value: metrics.totals.accessible,
                meta: `${percentage(metrics.totals.accessible, totalCount)}% accessible`,
            },
            {
                title: `Updated last ${metrics.recentWindowDays}d`,
                value: metrics.totals.recent,
                meta: metrics.totals.recent ? 'Recently edited' : 'Needs attention',
            },
        ];

        const featureStats = [
            { label: 'Baby changing', value: metrics.totals.babyChange },
            { label: 'RADAR key', value: metrics.totals.radar },
            { label: 'Free to use', value: metrics.totals.freeAccess },
            { label: 'Verified', value: metrics.totals.verified },
        ];

        const areaDistribution = metrics.areas.map((area, index) => ({
            name: area.name,
            count: area.count,
            color: AREA_COLORS[index % AREA_COLORS.length],
        }));

        const columns = [
            {
                key: 'name',
                label: 'Location',
                sortable: true,
                render: (_value: string, row: typeof tableRows[number]) => (
                    <div class="table-cell-primary">
                        <strong>{row.name}</strong>
                        <div class="table-cell-meta">
                            <span>{row.areaName}</span>
                            {row.geohash && <span class="table-cell-subtle">{row.geohash}</span>}
                            <span class="table-cell-subtle">#{row.id.slice(-6)}</span>
                        </div>
                        <div class="meta-pill-group">
                            <span class="meta-pill">{row.openingLabel}</span>
                        </div>
                    </div>
                ),
            },
            {
                key: 'verified_at',
                label: 'Status',
                sortable: true,
                render: (_value: Date | null, row: typeof tableRows[number]) => {
                    const statusLabel =
                        row.active === true ? 'Active' : row.active === false ? 'Inactive' : 'Status unknown';
                    const statusTone = row.active === true ? 'positive' : row.active === false ? 'negative' : 'muted';
                    const verificationLabel = row.verified_at
                        ? `Verified ${formatDate(row.verified_at)}`
                        : 'Awaiting verification';
                    return (
                        <div class="detail-stack">
                            <span class="status-line">
                                <span class={`status-dot status-dot--${statusTone}`}></span>
                                {statusLabel}
                            </span>
                            <span class="muted-text">{verificationLabel}</span>
                        </div>
                    );
                },
            },
            {
                key: 'accessible',
                label: 'Access & facilities',
                sortable: false,
                render: (_value: boolean | null, row: typeof tableRows[number]) => {
                    const accessLabel =
                        row.accessible === true
                            ? 'Accessible'
                            : row.accessible === false
                                ? 'Limited access'
                                : 'Unknown';
                    const facilities = [
                        row.baby_change === true
                            ? 'Baby change'
                            : row.baby_change === false
                                ? 'No baby change'
                                : null,
                        row.radar === true ? 'RADAR key' : row.radar === false ? 'Open access' : null,
                    ].filter(Boolean) as string[];
                    return (
                        <div class="detail-stack">
                            <div class="detail-row">
                                <span class="detail-label">Access</span>
                                <span class="detail-value">{accessLabel}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Facilities</span>
                                <span class="detail-value">
                                    {facilities.length > 0 ? facilities.join(' / ') : 'Details unavailable'}
                                </span>
                            </div>
                        </div>
                    );
                },
            },
            {
                key: 'no_payment',
                label: 'Cost & contributors',
                sortable: false,
                render: (_value: boolean | null, row: typeof tableRows[number]) => {
                    const costLabel =
                        row.no_payment === true
                            ? 'Free to use'
                            : row.no_payment === false
                                ? 'Paid access'
                                : 'Unknown';
                    return (
                        <div class="detail-stack">
                            <div class="detail-row">
                                <span class="detail-label">Cost</span>
                                <span class="detail-value">{costLabel}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Contributors</span>
                                <span class="detail-value">
                                    {row.contributorsCount.toLocaleString('en-GB')}
                                </span>
                            </div>
                        </div>
                    );
                },
            },
            {
                key: 'updated_at',
                label: 'Activity',
                sortable: true,
                render: (_value: Date | null, row: typeof tableRows[number]) => (
                    <div class="detail-stack">
                        <div class="detail-row">
                            <span class="detail-label">Updated</span>
                            <span class="detail-value">{formatDate(row.updated_at)}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Created</span>
                            <span class="detail-value">{formatDate(row.created_at)}</span>
                        </div>
                    </div>
                ),
            },
        ];

        return c.html(
            <Layout title="Loos">
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

                <section class="stats-panel">
                    <div class="metric-grid">
                        {insightCards.map((card) => (
                            <div class="metric-card">
                                <p class="metric-label">{card.title}</p>
                                <p class="metric-value">{card.value.toLocaleString('en-GB')}</p>
                                <p class="metric-meta">{card.meta}</p>
                            </div>
                        ))}
                    </div>

                    <div class="stat-sections">
                        <div class="stat-section">
                            <p class="stat-heading">Feature coverage</p>
                            <ul class="stat-progress-list">
                                {featureStats.map((stat) => (
                                    <li class="stat-progress-item">
                                        <div class="stat-progress">
                                            <span>{stat.label}</span>
                                            <span>{stat.value.toLocaleString('en-GB')}</span>
                                        </div>
                                        <div class="stat-progress-bar">
                                            <div
                                                class="stat-progress-bar__fill"
                                                style={`width: ${percentage(stat.value, totalCount)}%;`}
                                            ></div>
                                        </div>
                                        <span class="stat-progress-meta">
                                            {percentage(stat.value, totalCount)}% of filtered set
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div class="stat-section">
                            <p class="stat-heading">Top areas</p>
                            <ul class="stat-list">
                                {areaDistribution.length === 0 && (
                                    <li class="stat-list-item">
                                        <span class="stat-list-label muted-text">No areas match the current filters.</span>
                                    </li>
                                )}
                                {areaDistribution.map((area) => (
                                    <li class="stat-list-item">
                                        <span class="stat-list-label">
                                            <span class="status-dot" style={`background: ${area.color};`}></span>
                                            {area.name}
                                        </span>
                                        <strong>{area.count.toLocaleString('en-GB')}</strong>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </section>

                <TableSearch
                    data={tableRows}
                    columns={columns}
                    filters={filterConfig}
                    searchPlaceholder="Search by name, notes, geohash, or area"
                    emptyMessage="Try broadening your filters or resetting pagination."
                    pageSize={pageSize}
                    currentPage={resolvedPage}
                    searchQuery={searchQuery}
                    sortBy={hasCustomSort ? sortBy : ''}
                    sortOrder={hasCustomSort ? sortOrder : undefined}
                    activeFilters={filtersState}
                    currentPath="/admin/loos"
                    mode="server"
                    totalItems={totalCount}
                />
            </Layout>
        );
    } catch (error) {
        console.error('Failed to load admin loos list', error);
        return c.html(
            <Layout title="Loos">
                <div class="page-header">
                    <h1>Loos dataset</h1>
                </div>
                <div class="table-container">
                    <div class="empty-state">
                        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                        <h3>Something went wrong</h3>
                        <p>We couldn&apos;t load the dataset. Please try refreshing the page.</p>
                    </div>
                </div>
            </Layout>,
            500,
        );
    }
};

const renderLooForm = (c: Context, errors?: Record<string, string>) => {
    return c.html(
        <Layout title="Add New Loo">
            <div style="max-width: 800px; margin: 0 auto;">
                <h1 style="margin-bottom: var(--space-l);">Add New Loo</h1>

                {errors && Object.keys(errors).length > 0 && (
                    <div style="border: 2px solid var(--color-accent-pink); border-left-width: 4px; padding: var(--space-m); border-radius: 8px; margin-bottom: var(--space-l);">
                        <strong style="color: var(--color-accent-pink); display: block; margin-bottom: var(--space-2xs);">Please fix the following errors:</strong>
                        <ul style="margin: 0; padding-left: var(--space-m);">
                            {Object.entries(errors).map(([field, error]) => (
                                <li style="color: var(--color-accent-pink); margin-bottom: var(--space-3xs);">{error}</li>
                            ))}
                        </ul>
                    </div>
                )}

                <form method="post" action="/admin/loos" style="display: grid; gap: var(--space-l);">

                    <section style="background: var(--color-white); padding: var(--space-l); border-radius: 12px; border: 1px solid #e5e7eb; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);">
                        <h2>Basic Information</h2>
                        <div style="display: grid; gap: var(--space-s);">
                            <Input label="Loo Name" name="name" placeholder="e.g. Public Toilet" error={errors?.name} />
                            <TextArea label="Notes" name="notes" placeholder="Any additional notes..." rows={3} error={errors?.notes} />
                        </div>
                    </section>

                    <section style="background: var(--color-white); padding: var(--space-l); border-radius: 12px; border: 1px solid #e5e7eb; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);">
                        <h2>Location</h2>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-m);">
                            <Input label="Latitude" name="lat" placeholder="e.g. 51.5074" error={errors?.lat} />
                            <Input label="Longitude" name="lng" placeholder="e.g. -0.1278" error={errors?.lng} />
                        </div>
                    </section>

                    <section style="background: var(--color-white); padding: var(--space-l); border-radius: 12px; border: 1px solid #e5e7eb; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);">
                        <h2>Accessibility & Access</h2>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--space-m);">
                            <TriStateToggle label="Accessible?" name="accessible" value={errors?.accessible ? undefined : undefined} error={errors?.accessible} />
                            <TriStateToggle label="Radar Key?" name="radar" error={errors?.radar} />
                            <TriStateToggle label="Attended?" name="attended" error={errors?.attended} />
                            <TriStateToggle label="Automatic?" name="automatic" error={errors?.automatic} />
                            <TriStateToggle label="No Payment?" name="noPayment" error={errors?.noPayment} />
                        </div>
                        <div style="margin-top: var(--space-s);">
                            <Input label="Payment Details" name="paymentDetails" placeholder="e.g. 50p coin only" error={errors?.paymentDetails} />
                        </div>
                    </section>

                    <section style="background: var(--color-white); padding: var(--space-l); border-radius: 12px; border: 1px solid #e5e7eb; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);">
                        <h2>Facilities</h2>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--space-m);">
                            <TriStateToggle label="Baby Changing?" name="babyChange" error={errors?.babyChange} />
                            <TriStateToggle label="Men?" name="men" error={errors?.men} />
                            <TriStateToggle label="Women?" name="women" error={errors?.women} />
                            <TriStateToggle label="All Gender?" name="allGender" error={errors?.allGender} />
                            <TriStateToggle label="Children?" name="children" error={errors?.children} />
                            <TriStateToggle label="Urinal Only?" name="urinalOnly" error={errors?.urinalOnly} />
                        </div>
                    </section>

                    <section style="background: var(--color-white); padding: var(--space-l); border-radius: 12px; border: 1px solid #e5e7eb; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);">
                        <h2>Status</h2>
                        <TriStateToggle label="Active?" name="active" value="true" error={errors?.active} />
                        <TextArea label="Removal Reason" name="removalReason" placeholder="If inactive, why?" rows={3} error={errors?.removalReason} />
                    </section>

                    <div style="display: flex; justify-content: flex-end; gap: var(--space-m); margin-top: var(--space-m); padding-top: var(--space-m); border-top: 1px solid #e5e7eb;">
                        <Button variant="secondary" href="/admin/loos">Cancel</Button>
                        <Button type="submit">Save Loo</Button>
                    </div>
                </form>
            </div>
        </Layout>
    );
};

export const loosCreate = (c: Context) => {
    return renderLooForm(c);
};

const toBoolOrNull = (val?: string | null) => {
    if (val === 'true') return true;
    if (val === 'false') return false;
    return null;
};

const toNullableString = (val?: string | null) => {
    if (!val) return null;
    const trimmed = val.trim();
    return trimmed.length ? trimmed : null;
};

export const loosCreatePost = async (c: Context<{ Bindings: Env }>) => {
    try {
        const formData = await c.req.formData();
        const data = Object.fromEntries(formData);
        const result = looSchema.safeParse(data);

        if (!result.success) {
            const errors: Record<string, string> = {};
            result.error.issues.forEach((err) => {
                if (err.path[0]) {
                    errors[err.path[0].toString()] = err.message;
                }
            });
            return renderLooForm(c, errors);
        }

        const session = getSession(c);
        if (!session) {
            return c.redirect('/admin/login');
        }

        const payload = {
            name: result.data.name,
            notes: toNullableString(result.data.notes),
            accessible: toBoolOrNull(result.data.accessible),
            radar: toBoolOrNull(result.data.radar),
            attended: toBoolOrNull(result.data.attended),
            automatic: toBoolOrNull(result.data.automatic),
            noPayment: toBoolOrNull(result.data.noPayment),
            paymentDetails: toNullableString(result.data.paymentDetails),
            babyChange: toBoolOrNull(result.data.babyChange),
            men: toBoolOrNull(result.data.men),
            women: toBoolOrNull(result.data.women),
            allGender: toBoolOrNull(result.data.allGender),
            children: toBoolOrNull(result.data.children),
            urinalOnly: toBoolOrNull(result.data.urinalOnly),
            active: toBoolOrNull(result.data.active),
            removalReason: toNullableString(result.data.removalReason),
            location: {
                lat: result.data.lat,
                lng: result.data.lng,
            },
        };

        const response = await fetch(new URL('/api/loos', c.req.url), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${session.accessToken}`,
            },
            body: JSON.stringify(payload),
        });

        if (response.status === 201) {
            return c.redirect('/admin/loos');
        }

        if (response.status === 401) {
            return c.redirect('/admin/login');
        }

        const body = await response.json().catch(() => null);
        const fallbackMessage =
            body?.message ??
            (response.status === 400
                ? 'The API rejected this request. Please review the inputs.'
                : 'Failed to create loo. Please try again.');

        return renderLooForm(c, { _error: fallbackMessage });
    } catch (error) {
        console.error('Error creating loo via API:', error);
        return renderLooForm(c, { _error: 'Failed to create loo. Please try again.' });
    }
};
