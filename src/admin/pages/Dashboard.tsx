import { Context } from 'hono';
import { Layout } from '../components/Layout';
import { Button } from '../components/DesignSystem';

export const dashboard = (c: Context) => {
    return c.html(
        <Layout title="Dashboard">
            <h1>Recent Activity</h1>
            <p>Welcome to the Toilet Map Admin interface.</p>
            <div style="margin-top: var(--space-m);">
                <Button href="/admin/loos/create">Add New Loo</Button>
            </div>
        </Layout>
    );
};
