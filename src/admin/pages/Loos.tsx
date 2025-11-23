import { Context } from 'hono';
import { Layout } from '../components/Layout';
import { TriStateToggle, Input, Button, TextArea, Badge } from '../components/DesignSystem';
import { TableSearch, BooleanBadge, formatDate } from '../components/TableSearch';
import { looSchema } from '../utils/validation';
import { createPrismaClient, Prisma } from '../../prisma';
import { Env } from '../../types';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const AREA_COLORS = ['#0a165e', '#ed3d62', '#92f9db', '#f4c430', '#7b61ff'];
const RECENT_WINDOW_DAYS = 30;

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

export const loosList = async (c: Context<{ Bindings: Env }>) => {
    const prisma = createPrismaClient(c.env.POSTGRES_URI);
    const url = new URL(c.req.url);

    const searchQuery = (url.searchParams.get('search') ?? '').trim();
    const requestedPage = parseInt(url.searchParams.get('page') ?? '1', 10);
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const requestedPageSize = parseInt(url.searchParams.get('pageSize') ?? '25', 10);
    const pageSize = clampPageSize(requestedPageSize);

    const sortCandidates = ['name', 'updated_at', 'verified_at', 'created_at', 'accessible', 'no_payment'] as const;
    type SortKey = typeof sortCandidates[number];
    const rawSortKey = (url.searchParams.get('sortBy') ?? 'updated_at') as SortKey;
    const sortBy: SortKey = sortCandidates.includes(rawSortKey) ? rawSortKey : 'updated_at';
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

    const where: Prisma.toiletsWhereInput = {};

    if (searchQuery) {
        where.OR = [
            { name: { contains: searchQuery, mode: 'insensitive' } },
            { notes: { contains: searchQuery, mode: 'insensitive' } },
            { geohash: { contains: searchQuery, mode: 'insensitive' } },
            { id: { contains: searchQuery } },
            { areas: { name: { contains: searchQuery, mode: 'insensitive' } } },
        ];
    }

    if (filtersState.status === 'active') {
        where.active = true;
    } else if (filtersState.status === 'inactive') {
        where.active = false;
    }

    if (filtersState.access === 'accessible') {
        where.accessible = true;
    } else if (filtersState.access === 'not_accessible') {
        where.accessible = false;
    }

    if (filtersState.payment === 'free') {
        where.no_payment = true;
    } else if (filtersState.payment === 'paid') {
        where.no_payment = false;
    }

    if (filtersState.verification === 'verified') {
        where.verified_at = { not: null };
    } else if (filtersState.verification === 'unverified') {
        where.verified_at = null;
    }

    const sortMap: Record<SortKey, (direction: Prisma.SortOrder) => Prisma.toiletsOrderByWithRelationInput> = {
        name: (direction) => ({ name: direction }),
        updated_at: (direction) => ({ updated_at: direction }),
        verified_at: (direction) => ({ verified_at: direction }),
        created_at: (direction) => ({ created_at: direction }),
        accessible: (direction) => ({ accessible: direction }),
        no_payment: (direction) => ({ no_payment: direction }),
    };

    const orderBy = sortMap[sortBy](sortOrder);
    const skip = (page - 1) * pageSize;
    const recentThreshold = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const withCondition = (extra: Prisma.toiletsWhereInput): Prisma.toiletsWhereInput => ({
        AND: [where, extra],
    });

    const filterConfig = TABLE_FILTERS.map((filter) => ({
        key: filter.key,
        label: filter.label,
        options: filter.options.map((option) => ({
            value: option.value,
            label: option.label,
        })),
    }));

    try {
        const [
            loos,
            totalCount,
            activeCount,
            verifiedCount,
            accessibleCount,
            babyChangeCount,
            radarCount,
            freeAccessCount,
            recentCount,
            areaGroups,
        ] = await prisma.$transaction([
            prisma.toilets.findMany({
                where,
                orderBy,
                include: {
                    areas: {
                        select: { name: true },
                    },
                },
                skip,
                take: pageSize,
            }),
            prisma.toilets.count({ where }),
            prisma.toilets.count({ where: withCondition({ active: true }) }),
            prisma.toilets.count({ where: withCondition({ verified_at: { not: null } }) }),
            prisma.toilets.count({ where: withCondition({ accessible: true }) }),
            prisma.toilets.count({ where: withCondition({ baby_change: true }) }),
            prisma.toilets.count({ where: withCondition({ radar: true }) }),
            prisma.toilets.count({ where: withCondition({ no_payment: true }) }),
            prisma.toilets.count({ where: withCondition({ updated_at: { gte: recentThreshold } }) }),
            prisma.toilets.groupBy({
                by: ['area_id'],
                where,
                _count: { _all: true },
                orderBy: {
                    _count: { id: 'desc' },
                },
                take: 5,
            }),
        ]);

        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        let resolvedPage = Math.min(page, totalPages);
        let pagedLoos = loos;

        if (totalCount > 0 && loos.length === 0 && page > totalPages) {
            resolvedPage = totalPages;
            pagedLoos = await prisma.toilets.findMany({
                where,
                orderBy,
                include: {
                    areas: { select: { name: true } },
                },
                skip: (resolvedPage - 1) * pageSize,
                take: pageSize,
            });
        }

        const areaIds = areaGroups
            .map((group) => group.area_id)
            .filter((id): id is string => Boolean(id));

        const areaRecords = areaIds.length
            ? await prisma.areas.findMany({
                where: { id: { in: areaIds } },
                select: { id: true, name: true },
            })
            : [];

        const areaNameMap = new Map(areaRecords.map((area) => [area.id, area.name ?? 'Unnamed area']));

        const areaDistribution = areaGroups.map((group, index) => {
            const count =
                typeof group._count === 'object' && group._count !== null && '_all' in group._count
                    ? (group._count as { _all?: number })._all ?? 0
                    : 0;
            return {
                name: group.area_id ? areaNameMap.get(group.area_id) ?? 'Unknown area' : 'Unassigned area',
                count,
                color: AREA_COLORS[index % AREA_COLORS.length],
            };
        });

        const tableRows = pagedLoos.map((loo) => ({
            id: loo.id,
            name: loo.name ?? 'Unnamed location',
            areaName: loo.areas?.name ?? 'Unassigned area',
            geohash: loo.geohash,
            active: loo.active,
            verified_at: loo.verified_at,
            accessible: loo.accessible,
            baby_change: loo.baby_change,
            no_payment: loo.no_payment,
            radar: loo.radar,
            updated_at: loo.updated_at,
            created_at: loo.created_at,
            contributorsCount: loo.contributors?.length ?? 0,
            openingLabel: getOpeningLabel(loo.opening_times as unknown),
        }));

        const insightCards = [
            {
                title: 'Filtered records',
                value: totalCount,
                meta: searchQuery ? `Matching “${searchQuery}”` : 'Full dataset slice',
            },
            {
                title: 'Active coverage',
                value: activeCount,
                meta: `${percentage(activeCount, totalCount)}% active`,
            },
            {
                title: 'Accessibility ready',
                value: accessibleCount,
                meta: `${percentage(accessibleCount, totalCount)}% accessible`,
            },
            {
                title: `Updated last ${RECENT_WINDOW_DAYS}d`,
                value: recentCount,
                meta: recentCount ? 'Recently edited' : 'Needs attention',
            },
        ];

        const featureStats = [
            { label: 'Baby changing', value: babyChangeCount },
            { label: 'RADAR key', value: radarCount },
            { label: 'Free to use', value: freeAccessCount },
            { label: 'Verified', value: verifiedCount },
        ];

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
                        <div class="table-chip-list">
                            <Badge variant="neutral" icon="fa-clock">
                                {row.openingLabel}
                            </Badge>
                        </div>
                    </div>
                ),
            },
            {
                key: 'verified_at',
                label: 'Status & verification',
                sortable: true,
                render: (_value: Date | null, row: typeof tableRows[number]) => (
                    <div class="table-chip-list">
                {BooleanBadge(row.active, 'Active', 'Inactive', 'Unknown')}
                {row.verified_at
                    ? <Badge variant="yes" icon="fa-shield-halved">Verified</Badge>
                    : <Badge variant="unknown" icon="fa-triangle-exclamation">Needs review</Badge>}
                    </div>
                ),
            },
            {
                key: 'accessible',
                label: 'Access & facilities',
                sortable: true,
                render: (_value: boolean | null, row: typeof tableRows[number]) => {
                    const babyVariant = row.baby_change === true ? 'yes' : row.baby_change === false ? 'no' : 'unknown';
                    const babyLabel =
                        row.baby_change === true ? 'Baby change' : row.baby_change === false ? 'No baby change' : 'Baby change unknown';
                    const radarVariant = row.radar === true ? 'yes' : row.radar === false ? 'no' : 'unknown';
                    const radarLabel =
                        row.radar === true ? 'RADAR required' : row.radar === false ? 'No RADAR key' : 'RADAR unknown';

                    return (
                        <div class="table-chip-list">
                            {BooleanBadge(row.accessible, 'Accessible', 'Limited access', 'Unknown')}
                            <Badge variant={babyVariant} icon="fa-baby">
                                {babyLabel}
                            </Badge>
                            <Badge variant={radarVariant} icon="fa-key">
                                {radarLabel}
                            </Badge>
                        </div>
                    );
                },
            },
            {
                key: 'no_payment',
                label: 'Cost & contributions',
                sortable: true,
                render: (_value: boolean | null, row: typeof tableRows[number]) => (
                    <div class="table-chip-list">
                        {BooleanBadge(row.no_payment, 'Free to use', 'Paid access', 'Unknown')}
                        <Badge variant="neutral" icon="fa-user-group">
                            {row.contributorsCount} contributors
                        </Badge>
                    </div>
                ),
            },
            {
                key: 'updated_at',
                label: 'Activity',
                sortable: true,
                render: (_value: Date | null, row: typeof tableRows[number]) => (
                    <div>
                        <div class="table-cell-meta">
                            <strong>{formatDate(row.updated_at)}</strong>
                            <span>Last update</span>
                        </div>
                        <div class="table-cell-meta">
                            <span>Created {formatDate(row.created_at)}</span>
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

                <div class="insights-grid">
                    {insightCards.map((card, index) => (
                        <div class={`insight-card ${index === 0 ? 'insight-card--accent' : ''}`}>
                            <span class="insight-title">{card.title}</span>
                            <div class="insight-value">{card.value.toLocaleString('en-GB')}</div>
                            <div class="insight-meta">
                                <i class="fa-solid fa-circle" aria-hidden="true" style="font-size: 0.4rem;"></i>
                                <span>{card.meta}</span>
                            </div>
                            <div class="sparkline"></div>
                        </div>
                    ))}
                </div>

                <div class="insights-grid">
                    <div class="insight-card">
                        <h3 style="margin-top: 0;">Feature coverage</h3>
                        <ul class="legend-list">
                            {featureStats.map((stat) => (
                                <li class="legend-item">
                                    <div class="legend-label">
                                        <span>{stat.label}</span>
                                    </div>
                                    <div style="min-width: 120px;">
                                        <div class="stat-bar">
                                            <div
                                                class="stat-bar__fill"
                                                style={`width: ${percentage(stat.value, totalCount)}%;`}
                                            ></div>
                                        </div>
                                        <small>
                                            {stat.value.toLocaleString('en-GB')} • {percentage(stat.value, totalCount)}%
                                        </small>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div class="insight-card insight-card--accent">
                        <h3 style="margin-top: 0;">Top areas (by records)</h3>
                        <ul class="legend-list">
                            {areaDistribution.length === 0 && (
                                <li class="legend-item">
                                    <span class="legend-label">No areas match the current filters.</span>
                                </li>
                            )}
                            {areaDistribution.map((area) => (
                                <li class="legend-item">
                                    <div class="legend-label">
                                        <span class="legend-dot" style={`background: ${area.color};`}></span>
                                        {area.name}
                                    </div>
                                    <strong>{area.count.toLocaleString('en-GB')}</strong>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                <TableSearch
                    data={tableRows}
                    columns={columns}
                    filters={filterConfig}
                    searchPlaceholder="Search by name, notes, geohash, or area"
                    emptyMessage="Try broadening your filters or resetting pagination."
                    pageSize={pageSize}
                    currentPage={resolvedPage}
                    searchQuery={searchQuery}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
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

export const loosCreatePost = async (c: Context<{ Bindings: Env }>) => {
    try {
        const formData = await c.req.formData();
        const data = Object.fromEntries(formData);

        // Validate the data
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

        // Convert tri-state values to booleans or null
        const toBoolOrNull = (val?: string | null) => {
            if (val === 'true') return true;
            if (val === 'false') return false;
            return null;
        };

        // Create Prisma client
        const prisma = createPrismaClient(c.env.POSTGRES_URI);

        // Generate a unique ID (24 character hex string)
        const id = Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

        // Create the loo in the database
        await prisma.toilets.create({
            data: {
                id,
                name: result.data.name,
                notes: result.data.notes || null,
                accessible: toBoolOrNull(result.data.accessible),
                radar: toBoolOrNull(result.data.radar),
                attended: toBoolOrNull(result.data.attended),
                automatic: toBoolOrNull(result.data.automatic),
                no_payment: toBoolOrNull(result.data.noPayment),
                payment_details: result.data.paymentDetails || null,
                baby_change: toBoolOrNull(result.data.babyChange),
                men: toBoolOrNull(result.data.men),
                women: toBoolOrNull(result.data.women),
                all_gender: toBoolOrNull(result.data.allGender),
                children: toBoolOrNull(result.data.children),
                urinal_only: toBoolOrNull(result.data.urinalOnly),
                active: toBoolOrNull(result.data.active),
                removal_reason: result.data.removalReason || null,
                contributors: [],
                created_at: new Date(),
                updated_at: new Date(),
            },
        });

        return c.redirect('/admin/loos');
    } catch (error) {
        console.error('Error creating loo:', error);
        return renderLooForm(c, { _error: 'Failed to create loo. Please try again.' });
    }
};
