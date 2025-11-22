import { Context } from 'hono';
import { Layout } from '../components/Layout';
import { TriStateToggle, Input, Button } from '../components/DesignSystem';

export const loosList = (c: Context) => {
    return c.html(
        <Layout title="Loos">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-m);">
                <h1>Loos</h1>
                <Button href="/admin/loos/create">Add New Loo</Button>
            </div>
            <p>List of loos will appear here.</p>
        </Layout>
    );
};

export const loosCreate = (c: Context) => {
    return c.html(
        <Layout title="Add New Loo">
            <h1>Add New Loo</h1>
            <form method="post" action="/admin/loos" style="max-width: 600px;">
                <Input label="Loo Name" name="name" placeholder="e.g. Public Toilet" />
                <TriStateToggle label="Accessible?" name="accessible" />
                <TriStateToggle label="Baby Changing?" name="babyChange" />
                <TriStateToggle label="Radar Key?" name="radar" />
                <div style="margin-top: var(--space-m);">
                    <Button type="submit">Save</Button>
                </div>
            </form>
        </Layout>
    );
};
