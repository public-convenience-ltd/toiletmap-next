import { Context } from 'hono';
import { Layout } from '../components/Layout';

export const contributorsList = (c: Context) => {
    return c.html(
        <Layout title="Contributors">
            <h1>Contributors</h1>
            <p>List of contributors will appear here.</p>
        </Layout>
    );
};
