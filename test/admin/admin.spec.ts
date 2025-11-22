import { describe, it, expect } from 'vitest';
import { createApp } from '../../src/app';
import { Env } from '../../src/types';

const env: Env = {
    POSTGRES_URI: 'postgres://localhost:5432/toiletmap',
    AUTH0_ISSUER_BASE_URL: 'https://example.auth0.com/',
    AUTH0_AUDIENCE: 'https://api.toiletmap.org.uk',
    AUTH0_CLIENT_ID: 'test-client-id',
    AUTH0_SCOPE: 'openid profile email',
    AUTH0_REDIRECT_URI: 'http://localhost:8787/admin/callback',
};

describe('Admin Routes', () => {
    const app = createApp(env);

    it('should redirect to Auth0 login page when accessing /admin/login', async () => {
        const res = await app.request('/admin/login', {}, env);
        expect(res.status).toBe(302);
        const location = res.headers.get('Location');
        expect(location).toContain('https://example.auth0.com/authorize');
        expect(location).toContain('client_id=test-client-id');
        expect(location).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A8787%2Fadmin%2Fcallback');
    });

    it('should render dashboard at /admin', async () => {
        // Note: In a real scenario, we'd need to mock the session middleware.
        // For now, we just check if it returns 200 OK since we haven't implemented the middleware yet.
        const res = await app.request('/admin', {}, env);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('Dashboard');
        expect(text).toContain('Recent Activity');
    });

    it('should render loos list at /admin/loos', async () => {
        const res = await app.request('/admin/loos', {}, env);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('Loos');
        expect(text).toContain('Add New Loo');
    });

    it('should render contributors list at /admin/contributors', async () => {
        const res = await app.request('/admin/contributors', {}, env);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('Contributors');
    });
});
