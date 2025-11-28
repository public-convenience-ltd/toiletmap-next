import { Context, Hono } from 'hono';
import { Layout } from '../../components/Layout';
import { Button, Badge } from '../../components/DesignSystem';
import { OpeningHours } from '../../components/OpeningHours';
import { AppVariables, Env } from '../../../types';
import type { LooResponse, ReportResponse } from '../../../services/loo/types';
import { requireAuth as apiRequireAuth } from '../../../auth/middleware';
import { services as injectServices } from '../../../middleware/services';
import { loosRouter } from '../../../routes/loos';
import { logger } from '../../../utils/logger';

type ApiResult<T> = {
    status: number;
    data: T | null;
};

type ReportsApiResponse = {
    data: ReportResponse[];
    count: number;
};

// Minimal API app so admin pages can reuse /api/loos route handlers without network hops.
const looApiApp = new Hono<{ Bindings: Env; Variables: AppVariables }>();
looApiApp.use('*', injectServices);
looApiApp.use('/api/*', apiRequireAuth);
looApiApp.route('/api/loos', loosRouter);

const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'Unknown';
    return new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(dateString));
};

const Section = (props: { title: string; children: unknown; className?: string }) => (
    <section class={`form-card ${props.className || ''}`} style="margin-bottom: var(--space-l);">
        <h2 class="section-eyebrow" style="margin-bottom: var(--space-m);">{props.title}</h2>
        {props.children}
    </section>
);

const Property = (props: { label: string; value: unknown; fullWidth?: boolean }) => (
    <div style={props.fullWidth ? 'grid-column: 1 / -1;' : ''}>
        <dt class="form-label" style="font-size: var(--text-0); margin-bottom: var(--space-3xs);">{props.label}</dt>
        <dd style="margin: 0; font-size: var(--text-1); color: var(--color-neutral-dark-grey); word-break: break-word;">{props.value}</dd>
    </div>
);

const BooleanBadge = (props: { value: boolean | null; label?: string }) => {
    if (props.value === true) {
        return <Badge variant="yes" icon="fa-check">{props.label || 'Yes'}</Badge>;
    }
    if (props.value === false) {
        return <Badge variant="no" icon="fa-xmark">{props.label || 'No'}</Badge>;
    }
    return <Badge variant="unknown" icon="fa-question">{props.label || 'Unknown'}</Badge>;
};

const requestApiJson = async function <T>(c: Context<{ Bindings: Env }>, path: string): Promise<ApiResult<T>> {
    const url = new URL(path, c.req.url);
    const headers = new Headers();

    const cookie = c.req.header('cookie');
    if (cookie) headers.set('cookie', cookie);

    const authorization = c.req.header('authorization') ?? c.req.header('Authorization');
    if (authorization) headers.set('authorization', authorization);

    const request = new Request(url.toString(), {
        method: 'GET',
        headers,
    });

    let executionCtx: ExecutionContext | undefined;
    try {
        executionCtx = c.executionCtx as ExecutionContext;
    } catch (error) {
        executionCtx = undefined;
    }

    const fallbackExecutionCtx = {
        waitUntil: (_promise: Promise<unknown>) => {},
        passThroughOnException: () => {},
    } as ExecutionContext;

    const response = await looApiApp.fetch(
        request,
        c.env,
        executionCtx ?? fallbackExecutionCtx,
    );

    if (response.status === 404) {
        return { status: 404, data: null };
    }

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
            `API route ${url.pathname}${url.search} failed (${response.status}): ${errorText || response.statusText}`,
        );
    }

    const json = await response.json() as T;
    return { status: response.status, data: json };
};

export const looDetail = async (c: Context<{ Bindings: Env }>) => {
    const { id } = c.req.param();
    const url = new URL(c.req.url);
    const fromCreate = url.searchParams.get('source') === 'create';
    const fromEdit = url.searchParams.get('source') === 'edit';

    let loo: LooResponse | null = null;
    let reports: ReportResponse[] = [];

    try {
        const looResult = await requestApiJson<LooResponse>(c, `/api/loos/${id}`);
        loo = looResult.data;

        if (!loo) {
            return c.html(
                <Layout title="Loo not found">
                    <div class="page-header">
                        <h1>Loo not found</h1>
                        <Button href="/admin/loos">Back to dataset</Button>
                    </div>
                </Layout>
            );
        }

        const reportsResult = await requestApiJson<ReportsApiResponse>(c, `/api/loos/${id}/reports?hydrate=true`);
        reports = reportsResult.data?.data ?? [];
    } catch (error) {
        if (error instanceof Error) {
            logger.logError(error, { looId: id });
        } else {
            logger.error('Failed to load loo detail data in admin page', {
                looId: id,
                errorMessage: String(error),
            });
        }
        const message = error instanceof Error ? error.message : 'Unknown error';
        return c.html(
            <Layout title="Error loading loo">
                <div class="page-header">
                    <div>
                        <p class="form-label" style="margin: 0;">Loo details</p>
                        <h1 style="margin: var(--space-3xs) 0;">Unable to load loo</h1>
                    </div>
                    <Button href="/admin/loos">Back to dataset</Button>
                </div>
                <div class="notification notification--error" role="status">
                    <div class="notification__icon">
                        <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
                    </div>
                    <div class="notification__content">
                        <p class="notification__title">Something went wrong</p>
                        <p class="notification__message">
                            We could not retrieve the loo details. Please try again or return to the dataset.<br />
                            <small style="color: var(--color-neutral-grey);">{message}</small>
                        </p>
                    </div>
                </div>
            </Layout>
        );
    }

    const mapUrl = loo.location
        ? `https://www.openstreetmap.org/export/embed.html?bbox=${loo.location.lng - 0.002}%2C${loo.location.lat - 0.002}%2C${loo.location.lng + 0.002}%2C${loo.location.lat + 0.002}&layer=mapnik&marker=${loo.location.lat}%2C${loo.location.lng}`
        : null;

    return c.html(
        <Layout title={`Loo ${loo.name || id}`}>
            <style>{`
                .loo-grid {
                    display: grid;
                    gap: var(--space-xl);
                    grid-template-columns: 1fr;
                }
                @media (min-width: 1024px) {
                    .loo-grid {
                        grid-template-columns: 2fr 1fr;
                    }
                }
                .property-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                    gap: var(--space-m);
                }
                .timeline-item {
                    position: relative;
                    padding-left: var(--space-l);
                    padding-bottom: var(--space-l);
                    border-left: 2px solid var(--color-neutral-light-grey);
                }
                .timeline-item:last-child {
                    border-left-color: transparent;
                }
                .timeline-marker {
                    position: absolute;
                    left: -6px;
                    top: 0;
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    background-color: var(--color-primary);
                    border: 2px solid white;
                }
            `}</style>
            <div class="page-header">
                <div>
                    <p class="form-label" style="margin: 0;">Loo details</p>
                    <h1 style="margin: var(--space-3xs) 0;">{loo.name || 'Unnamed Loo'}</h1>
                    <p style="max-width: 60ch; color: var(--color-neutral-grey);">
                        ID: <code style="user-select: all;">{loo.id}</code>
                    </p>
                </div>
                <div style="display: flex; gap: var(--space-s); flex-wrap: wrap; justify-content: flex-start;">
                    <Button href="/admin/loos" variant="secondary">Back</Button>
                    <Button href={`/admin/loos/${loo.id}/edit`}>Edit</Button>
                </div>
            </div>

            {fromCreate && (
                <div class="notification notification--success" role="status" style="margin-bottom: var(--space-l);">
                    <div class="notification__icon">
                        <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
                    </div>
                    <div class="notification__content">
                        <p class="notification__title">New loo created</p>
                        <p class="notification__message">
                            The record was saved successfully.
                        </p>
                    </div>
                </div>
            )}

            {fromEdit && (
                <div class="notification notification--success" role="status" style="margin-bottom: var(--space-l);">
                    <div class="notification__icon">
                        <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
                    </div>
                    <div class="notification__content">
                        <p class="notification__title">Loo updated successfully</p>
                        <p class="notification__message">
                            Your changes have been saved.
                        </p>
                    </div>
                </div>
            )}

            <div class="loo-grid">
                <div>
                    <Section title="Status & Access">
                        <dl class="property-grid">
                            <Property label="Active" value={<BooleanBadge value={loo.active} label={loo.active ? 'Active' : 'Inactive'} />} />
                            <Property label="Verified" value={loo.verifiedAt ? <Badge variant="yes" icon="fa-check">Verified</Badge> : <Badge variant="neutral">Unverified</Badge>} />
                            <Property label="Accessible" value={<BooleanBadge value={loo.accessible} />} />
                            <Property label="Radar Key" value={<BooleanBadge value={loo.radar} />} />
                            <Property label="Fee" value={loo.noPayment ? 'Free' : (loo.paymentDetails || 'Unknown')} />
                        </dl>
                    </Section>

                    <Section title="Facilities">
                        <dl class="property-grid">
                            <Property label="Men" value={<BooleanBadge value={loo.men} />} />
                            <Property label="Women" value={<BooleanBadge value={loo.women} />} />
                            <Property label="All Gender" value={<BooleanBadge value={loo.allGender} />} />
                            <Property label="Children" value={<BooleanBadge value={loo.children} />} />
                            <Property label="Baby Change" value={<BooleanBadge value={loo.babyChange} />} />
                            <Property label="Urinal Only" value={<BooleanBadge value={loo.urinalOnly} />} />
                            <Property label="Automatic" value={<BooleanBadge value={loo.automatic} />} />
                            <Property label="Attended" value={<BooleanBadge value={loo.attended} />} />
                        </dl>
                    </Section>

                    <Section title="Notes">
                        <dl>
                            <Property label="Public Notes" value={loo.notes || <span style="color: var(--color-neutral-grey);">No notes</span>} fullWidth />
                            <br />
                            <Property label="Removal Reason" value={loo.removalReason || <span style="color: var(--color-neutral-grey);">N/A</span>} fullWidth />
                        </dl>
                    </Section>

                    <Section title="History">
                        <div class="timeline" style="margin-top: var(--space-m);">
                            {reports.map((report) => (
                                <div class="timeline-item" key={report.id}>
                                    <div class="timeline-marker"></div>
                                    <div style="display: flex; justify-content: space-between; margin-bottom: var(--space-2xs);">
                                        <span style="font-weight: 600;">
                                            {report.contributor ? (
                                                <a
                                                    href={`/admin/users/statistics?handle=${encodeURIComponent(report.contributor)}`}
                                                    style="text-decoration: none; color: inherit;"
                                                >
                                                    {report.contributor}
                                                </a>
                                            ) : (
                                                'Hidden (admin only)'
                                            )}
                                        </span>
                                        <span style="color: var(--color-neutral-grey); font-size: var(--text-0);">{formatDate(report.createdAt)}</span>
                                    </div>
                                    <div style="font-size: var(--text-0);">
                                        {report.diff ? (
                                            <ul style="list-style: none; padding: 0; margin: 0;">
                                                {Object.entries(report.diff).map(([key, value]: [string, any]) => (
                                                    <li style="margin-bottom: var(--space-3xs);">
                                                        <span style="font-weight: 500; color: var(--color-neutral-dark-grey);">{key}:</span>{' '}
                                                        <span style="color: var(--color-accent-pink); text-decoration: line-through;">{String(value.previous ?? 'null')}</span>
                                                        {' '}&rarr;{' '}
                                                        <span style="color: var(--color-accent-green);">{String(value.current ?? 'null')}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <span style="color: var(--color-neutral-grey);">No changes recorded (Creation or legacy report)</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Section>
                </div>

                <div>
                    {mapUrl && (
                        <div class="form-card" style="margin-bottom: var(--space-l); padding: 0; overflow: hidden;">
                            <iframe
                                width="100%"
                                height="300"
                                frameborder="0"
                                scrolling="no"
                                marginheight="0"
                                marginwidth="0"
                                src={mapUrl}
                                style="border: 0; display: block;"
                            ></iframe>
                        </div>
                    )}

                    <Section title="Location">
                        <dl style="display: grid; gap: var(--space-s);">
                            <Property label="Latitude" value={loo.location?.lat ?? 'Unknown'} />
                            <Property label="Longitude" value={loo.location?.lng ?? 'Unknown'} />
                            <Property label="Geohash" value={loo.geohash ?? 'Unknown'} />
                            <Property label="Area" value={loo.area?.map(a => a.name).join(', ') || 'Unknown'} />
                        </dl>
                    </Section>

                    <Section title="Opening Hours">
                        <OpeningHours openingTimes={loo.openingTimes} />
                    </Section>

                    <Section title="Metadata">
                        <dl style="display: grid; gap: var(--space-s);">
                            <Property label="Created" value={formatDate(loo.createdAt)} />
                            <Property label="Last Updated" value={formatDate(loo.updatedAt)} />
                            <Property label="Verified" value={formatDate(loo.verifiedAt)} />
                            <Property label="Contributors" value={loo.contributorsCount} />
                        </dl>
                    </Section>

                    <div class="form-card">
                        <h3 class="section-eyebrow" style="margin-bottom: var(--space-m);">Actions</h3>
                        <div style="display: grid; gap: var(--space-s);">
                            <Button href={`/api/loos/${loo.id}`} variant="secondary">View API Response</Button>
                            <Button href={`/loos/${loo.id}`} variant="secondary">View Public Page</Button>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    );
};
