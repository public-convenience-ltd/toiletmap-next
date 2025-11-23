import { describe, it, expect, vi, afterEach } from 'vitest';
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

const buildSessionCookie = () => {
    const user = {
        sub: 'auth0|test-user',
        email: 'admin@example.com',
        name: 'Test Admin',
        nickname: 'Testy',
    };

    const encodedUser = Buffer.from(JSON.stringify(user)).toString('base64');
    return `id_token=test-id-token; access_token=test-access-token; user_info=${encodedUser}`;
};

const authenticatedHeaders = () => ({
    Cookie: buildSessionCookie(),
});

const jsonResponse = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
    });

const resolveUrl = (input: Parameters<typeof fetch>[0]) => {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    if (typeof Request !== 'undefined' && input instanceof Request) {
        return input.url;
    }
    if (typeof input === 'object' && input && 'url' in input) {
        return (input as Request).url;
    }
    return String(input);
};

const mockApiResponses = () => {
    const searchResponse = {
        data: [
            {
                id: 'loo_123',
                name: 'Test Loo',
                area: [{ name: 'Test Borough' }],
                geohash: 'gcpvj0',
                active: true,
                verifiedAt: new Date().toISOString(),
                accessible: true,
                babyChange: false,
                noPayment: true,
                radar: false,
                updatedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                contributorsCount: 2,
                openingTimes: null,
            },
        ],
        count: 1,
        total: 1,
        page: 1,
        pageSize: 25,
        hasMore: false,
    };

    const metricsResponse = {
        recentWindowDays: 30,
        totals: {
            filtered: 1,
            active: 1,
            verified: 1,
            accessible: 1,
            babyChange: 0,
            radar: 0,
            freeAccess: 1,
            recent: 1,
        },
        areas: [{ areaId: 'area_1', name: 'Test Borough', count: 1 }],
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = resolveUrl(input);
        if (url.includes('/api/loos/search')) {
            return jsonResponse(searchResponse);
        }
        if (url.includes('/api/loos/metrics')) {
            return jsonResponse(metricsResponse);
        }
        return jsonResponse({ message: 'Not found' }, 404);
    });
};

afterEach(() => {
    vi.restoreAllMocks();
});

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

    it('should render dashboard at /admin when session cookies are present', async () => {
        const res = await app.request('/admin', { headers: authenticatedHeaders() }, env);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('Dashboard');
        expect(text).toContain('Recent Activity');
    });

    it('should render loos list at /admin/loos when session cookies are present', async () => {
        mockApiResponses();
        const res = await app.request('/admin/loos', { headers: authenticatedHeaders() }, env);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('Loos');
        expect(text).toContain('Add New Loo');
    });

    it('should render contributors list at /admin/contributors when session cookies are present', async () => {
        const res = await app.request('/admin/contributors', { headers: authenticatedHeaders() }, env);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('Contributors');
    });
});
