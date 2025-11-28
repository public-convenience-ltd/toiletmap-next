import { Context } from 'hono';
import { Layout } from '../../components/Layout';
import { Button } from '../../components/DesignSystem';
import { Env } from '../../../types';
import { serializeConfig } from './helpers';

const getDefaultValue = (value: string | null) => {
    if (!value) return '';
    return value.trim();
};

export const loosCreate = (c: Context<{ Bindings: Env }>) => {
    const url = new URL(c.req.url);
    const defaults = {
        name: getDefaultValue(url.searchParams.get('name')),
        lat: getDefaultValue(url.searchParams.get('lat')),
        lng: getDefaultValue(url.searchParams.get('lng')),
        notes: getDefaultValue(url.searchParams.get('notes')),
    };

    const pageConfig = {
        api: {
            create: '/api/loos',
        },
        defaults,
    };

    const serializedConfig = serializeConfig(pageConfig);

    return c.html(
        <Layout title="Add New Loo">
            <noscript>
                <div class="empty-state" style="margin-bottom: var(--space-l);">
                    <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
                    <h3>JavaScript is required</h3>
                    <p>This page now renders fully in the browser. Please enable JavaScript to add loos.</p>
                </div>
            </noscript>

            <div class="page-header">
                <div>
                    <p class="form-label" style="margin: 0;">Operations</p>
                    <h1 style="margin: var(--space-3xs) 0;">Create a loo</h1>
                </div>
                <Button href="/admin/loos">Back to dataset</Button>
            </div>

            <section class="create-shell" data-loo-create-shell>
                <div class="form-card">
                    <div class="loading-indicator">
                        <span class="loading-spinner" aria-hidden="true"></span>
                        <p>Loading create form…</p>
                    </div>
                </div>
            </section>

            <script
                type="application/json"
                id="loo-create-config"
                dangerouslySetInnerHTML={{ __html: serializedConfig }}
            ></script>
            <div id="loo-create-root"></div>
            <script type="module" src="/admin/loos-create.js"></script>
        </Layout>,
    );
};
