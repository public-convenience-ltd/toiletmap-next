import { describe, expect, it, beforeAll } from 'vitest';
import { testClient } from '../context';
import { issueTestToken } from '../utils/auth';

describe.sequential('Admin API endpoints', () => {
  let adminToken: string;
  let regularToken: string;

  beforeAll(() => {
    // Create a token with admin permissions
    adminToken = issueTestToken({ permissions: ['access:admin'] });

    // Create a regular token without admin permissions
    regularToken = issueTestToken({ permissions: [] });
  });

  describe('GET /admin/api/stats', () => {
    it('requires authentication', async () => {
      const response = await testClient.fetch('/admin/api/stats');
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.message).toBe('Unauthorized');
    });

    it('requires admin role', async () => {
      const response = await testClient.fetch('/admin/api/stats', {
        headers: {
          authorization: `Bearer ${regularToken}`,
        },
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.message).toBe('Forbidden: Admin role required');
    });

    it('returns comprehensive statistics for admin users', async () => {
      const response = await testClient.fetch('/admin/api/stats', {
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.status).toBe(200);
      const body = await response.json();

      // Check structure of the response
      expect(body).toHaveProperty('overview');
      expect(body.overview).toHaveProperty('totalLoos');
      expect(body.overview).toHaveProperty('activeLoos');
      expect(body.overview).toHaveProperty('accessibleLoos');
      expect(body.overview).toHaveProperty('verifiedLoos');

      expect(body).toHaveProperty('contributors');
      expect(body.contributors).toHaveProperty('total');
      expect(body.contributors).toHaveProperty('topContributors');
      expect(Array.isArray(body.contributors.topContributors)).toBe(true);

      expect(body).toHaveProperty('activity');
      expect(body.activity).toHaveProperty('recentUpdates');
      expect(body.activity).toHaveProperty('updatesLast30Days');
      expect(body.activity).toHaveProperty('updatesLast7Days');

      // Validate data types
      expect(typeof body.overview.totalLoos).toBe('number');
      expect(typeof body.overview.activeLoos).toBe('number');
      expect(typeof body.overview.accessibleLoos).toBe('number');
      expect(typeof body.overview.verifiedLoos).toBe('number');

      expect(typeof body.contributors.total).toBe('number');
      expect(typeof body.activity.recentUpdates).toBe('number');
      expect(typeof body.activity.updatesLast30Days).toBe('number');
      expect(typeof body.activity.updatesLast7Days).toBe('number');

      // Check topContributors structure if present
      if (body.contributors.topContributors.length > 0) {
        const contributor = body.contributors.topContributors[0];
        expect(contributor).toHaveProperty('name');
        expect(contributor).toHaveProperty('count');
        expect(typeof contributor.name).toBe('string');
        expect(typeof contributor.count).toBe('number');
      }

      // Logical checks
      expect(body.overview.activeLoos).toBeLessThanOrEqual(
        body.overview.totalLoos,
      );
      expect(body.overview.accessibleLoos).toBeLessThanOrEqual(
        body.overview.totalLoos,
      );
      expect(body.overview.verifiedLoos).toBeLessThanOrEqual(
        body.overview.totalLoos,
      );
      expect(body.activity.updatesLast7Days).toBeLessThanOrEqual(
        body.activity.updatesLast30Days,
      );
    });
  });

  describe('GET /admin/api/loos/map', () => {
    it('requires authentication', async () => {
      const response = await testClient.fetch('/admin/api/loos/map');
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.message).toBe('Unauthorized');
    });

    it('requires admin role', async () => {
      const response = await testClient.fetch('/admin/api/loos/map', {
        headers: {
          authorization: `Bearer ${regularToken}`,
        },
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.message).toBe('Forbidden: Admin role required');
    });

    it('returns compressed map data for all loos', async () => {
      const response = await testClient.fetch('/admin/api/loos/map', {
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('count');
      expect(Array.isArray(body.data)).toBe(true);
      expect(typeof body.count).toBe('number');
      expect(body.count).toBe(body.data.length);

      // Validate structure of map data entries (if any exist)
      if (body.data.length > 0) {
        const loo = body.data[0];
        expect(loo).toHaveProperty('id');
        expect(loo).toHaveProperty('location');
        expect(loo.location).toHaveProperty('lat');
        expect(loo.location).toHaveProperty('lng');
        expect(loo).toHaveProperty('active');
        expect(loo).toHaveProperty('name');

        // Check types
        expect(typeof loo.id).toBe('string');
        expect(typeof loo.location.lat).toBe('number');
        expect(typeof loo.location.lng).toBe('number');
        expect(typeof loo.active).toBe('boolean');

        // Validate that the response is compressed (doesn't include heavy fields)
        expect(loo).not.toHaveProperty('notes');
        expect(loo).not.toHaveProperty('reports');
        expect(loo).not.toHaveProperty('removalReason');
      }
    });

    it('filters by active status when requested', async () => {
      const response = await testClient.fetch(
        '/admin/api/loos/map?active=true',
        {
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        },
      );

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);

      // All returned loos should be active
      body.data.forEach((loo: any) => {
        expect(loo.active).toBe(true);
      });
    });

    it('filters by accessible status when requested', async () => {
      const response = await testClient.fetch(
        '/admin/api/loos/map?accessible=true',
        {
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        },
      );

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);

      // All returned loos should be accessible
      body.data.forEach((loo: any) => {
        expect(loo.accessible).toBe(true);
      });
    });

    it('filters by multiple criteria simultaneously', async () => {
      const response = await testClient.fetch(
        '/admin/api/loos/map?active=true&accessible=true',
        {
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        },
      );

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);

      // All returned loos should be both active and accessible
      body.data.forEach((loo: any) => {
        expect(loo.active).toBe(true);
        expect(loo.accessible).toBe(true);
      });
    });

    it('returns empty array when filters match no loos', async () => {
      // Create a very restrictive filter combination that likely matches nothing
      const response = await testClient.fetch(
        '/admin/api/loos/map?active=false&accessible=false',
        {
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        },
      );

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('count');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.count).toBe(body.data.length);
    });
  });

  describe('Permission validation', () => {
    it('blocks access when permissions array is missing', async () => {
      const tokenWithoutPermissions = issueTestToken({});

      const response = await testClient.fetch('/admin/api/stats', {
        headers: {
          authorization: `Bearer ${tokenWithoutPermissions}`,
        },
      });

      expect(response.status).toBe(403);
    });

    it('blocks access with wrong permissions', async () => {
      const tokenWithWrongPermissions = issueTestToken({
        permissions: ['read:data', 'write:data'],
      });

      const response = await testClient.fetch('/admin/api/stats', {
        headers: {
          authorization: `Bearer ${tokenWithWrongPermissions}`,
        },
      });

      expect(response.status).toBe(403);
    });

    it('allows access with correct permission among others', async () => {
      const tokenWithMultiplePermissions = issueTestToken({
        permissions: ['read:data', 'access:admin', 'write:data'],
      });

      const response = await testClient.fetch('/admin/api/stats', {
        headers: {
          authorization: `Bearer ${tokenWithMultiplePermissions}`,
        },
      });

      expect(response.status).toBe(200);
    });
  });
});
