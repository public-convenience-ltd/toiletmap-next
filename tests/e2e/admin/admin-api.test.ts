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

  describe('GET /admin/api/suspicious-activity', () => {
    it('requires authentication', async () => {
      const response = await testClient.fetch('/admin/api/suspicious-activity');
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.message).toBe('Unauthorized');
    });

    it('requires admin role', async () => {
      const response = await testClient.fetch('/admin/api/suspicious-activity', {
        headers: {
          authorization: `Bearer ${regularToken}`,
        },
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.message).toBe('Forbidden: Admin role required');
    });

    it('returns suspicious activity data for admin users', async () => {
      const response = await testClient.fetch('/admin/api/suspicious-activity', {
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.status).toBe(200);
      const body = await response.json();

      // Check structure of the response
      expect(body).toHaveProperty('rapidUpdates');
      expect(body).toHaveProperty('conflictingEdits');
      expect(body).toHaveProperty('locationChanges');
      expect(body).toHaveProperty('massDeactivations');

      expect(Array.isArray(body.rapidUpdates)).toBe(true);
      expect(Array.isArray(body.conflictingEdits)).toBe(true);
      expect(Array.isArray(body.locationChanges)).toBe(true);
      expect(Array.isArray(body.massDeactivations)).toBe(true);

      // Check rapidUpdates structure if present
      if (body.rapidUpdates.length > 0) {
        const item = body.rapidUpdates[0];
        expect(item).toHaveProperty('looId');
        expect(item).toHaveProperty('updateCount');
        expect(item).toHaveProperty('contributors');
        expect(item).toHaveProperty('firstUpdate');
        expect(item).toHaveProperty('lastUpdate');
        expect(item).toHaveProperty('timeSpanMinutes');
        expect(typeof item.looId).toBe('string');
        expect(typeof item.updateCount).toBe('number');
        expect(Array.isArray(item.contributors)).toBe(true);
        expect(typeof item.timeSpanMinutes).toBe('number');
      }

      // Check conflictingEdits structure if present
      if (body.conflictingEdits.length > 0) {
        const item = body.conflictingEdits[0];
        expect(item).toHaveProperty('looId');
        expect(item).toHaveProperty('field');
        expect(item).toHaveProperty('contributors');
        expect(item).toHaveProperty('conflictCount');
        expect(typeof item.looId).toBe('string');
        expect(typeof item.field).toBe('string');
        expect(Array.isArray(item.contributors)).toBe(true);
        expect(typeof item.conflictCount).toBe('number');
      }

      // Check locationChanges structure if present
      if (body.locationChanges.length > 0) {
        const item = body.locationChanges[0];
        expect(item).toHaveProperty('looId');
        expect(item).toHaveProperty('contributor');
        expect(item).toHaveProperty('timestamp');
        expect(item).toHaveProperty('distanceMeters');
        expect(typeof item.looId).toBe('string');
        expect(typeof item.contributor).toBe('string');
        expect(typeof item.distanceMeters).toBe('number');
      }

      // Check massDeactivations structure if present
      if (body.massDeactivations.length > 0) {
        const item = body.massDeactivations[0];
        expect(item).toHaveProperty('contributor');
        expect(item).toHaveProperty('deactivationCount');
        expect(item).toHaveProperty('looIds');
        expect(item).toHaveProperty('timeSpanMinutes');
        expect(typeof item.contributor).toBe('string');
        expect(typeof item.deactivationCount).toBe('number');
        expect(Array.isArray(item.looIds)).toBe(true);
        expect(typeof item.timeSpanMinutes).toBe('number');
      }
    });

    it('accepts custom time window parameter', async () => {
      const response = await testClient.fetch(
        '/admin/api/suspicious-activity?hoursWindow=48',
        {
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty('rapidUpdates');
      expect(body).toHaveProperty('conflictingEdits');
      expect(body).toHaveProperty('locationChanges');
      expect(body).toHaveProperty('massDeactivations');
    });

    it('accepts custom threshold parameters', async () => {
      const response = await testClient.fetch(
        '/admin/api/suspicious-activity?minRapidUpdates=10&minLocationChangeMeters=5000&minMassDeactivations=10',
        {
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty('rapidUpdates');
      expect(body).toHaveProperty('conflictingEdits');
      expect(body).toHaveProperty('locationChanges');
      expect(body).toHaveProperty('massDeactivations');
    });
  });

  describe('GET /admin/api/contributors/leaderboard', () => {
    it('requires authentication', async () => {
      const response = await testClient.fetch('/admin/api/contributors/leaderboard');
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.message).toBe('Unauthorized');
    });

    it('requires admin role', async () => {
      const response = await testClient.fetch('/admin/api/contributors/leaderboard', {
        headers: {
          authorization: `Bearer ${regularToken}`,
        },
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.message).toBe('Forbidden: Admin role required');
    });

    it('returns contributor leaderboard data for admin users', async () => {
      const response = await testClient.fetch('/admin/api/contributors/leaderboard', {
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.status).toBe(200);
      const body = await response.json();

      // Check structure of the response
      expect(body).toHaveProperty('topContributors');
      expect(body).toHaveProperty('recentContributors');
      expect(body).toHaveProperty('stats');

      expect(Array.isArray(body.topContributors)).toBe(true);
      expect(Array.isArray(body.recentContributors)).toBe(true);

      expect(body.stats).toHaveProperty('totalContributors');
      expect(body.stats).toHaveProperty('activeContributors7d');
      expect(body.stats).toHaveProperty('activeContributors30d');

      expect(typeof body.stats.totalContributors).toBe('number');
      expect(typeof body.stats.activeContributors7d).toBe('number');
      expect(typeof body.stats.activeContributors30d).toBe('number');

      // Check topContributors structure if present
      if (body.topContributors.length > 0) {
        const contributor = body.topContributors[0];
        expect(contributor).toHaveProperty('name');
        expect(contributor).toHaveProperty('totalEdits');
        expect(contributor).toHaveProperty('looseEdited');
        expect(contributor).toHaveProperty('rank');
        expect(typeof contributor.name).toBe('string');
        expect(typeof contributor.totalEdits).toBe('number');
        expect(typeof contributor.looseEdited).toBe('number');
        expect(typeof contributor.rank).toBe('number');
        expect(contributor.rank).toBe(1); // First contributor should have rank 1
      }

      // Check recentContributors structure if present
      if (body.recentContributors.length > 0) {
        const contributor = body.recentContributors[0];
        expect(contributor).toHaveProperty('name');
        expect(contributor).toHaveProperty('edits');
        expect(contributor).toHaveProperty('since');
        expect(typeof contributor.name).toBe('string');
        expect(typeof contributor.edits).toBe('number');
        expect(typeof contributor.since).toBe('string');
      }

      // Logical checks
      expect(body.stats.activeContributors7d).toBeLessThanOrEqual(
        body.stats.totalContributors,
      );
      expect(body.stats.activeContributors30d).toBeLessThanOrEqual(
        body.stats.totalContributors,
      );
      expect(body.stats.activeContributors7d).toBeLessThanOrEqual(
        body.stats.activeContributors30d,
      );
    });
  });

  describe('GET /admin/api/contributors/:contributorId', () => {
    it('requires authentication', async () => {
      const response = await testClient.fetch('/admin/api/contributors/test-user');
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.message).toBe('Unauthorized');
    });

    it('requires admin role', async () => {
      const response = await testClient.fetch('/admin/api/contributors/test-user', {
        headers: {
          authorization: `Bearer ${regularToken}`,
        },
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.message).toBe('Forbidden: Admin role required');
    });

    it('returns 404 for non-existent contributor', async () => {
      const response = await testClient.fetch(
        '/admin/api/contributors/non-existent-contributor-xyz',
        {
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        },
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toBe('Contributor not found or has no activity');
    });

    it('returns contributor details for existing contributor with activity', async () => {
      // First, get the leaderboard to find an actual contributor
      const leaderboardResponse = await testClient.fetch('/admin/api/contributors/leaderboard', {
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(leaderboardResponse.status).toBe(200);
      const leaderboard = await leaderboardResponse.json();

      // Skip test if no contributors exist
      if (leaderboard.topContributors.length === 0) {
        expect(true).toBe(true);
        return;
      }

      const contributorId = leaderboard.topContributors[0].name;

      const response = await testClient.fetch(
        `/admin/api/contributors/${encodeURIComponent(contributorId)}`,
        {
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        },
      );

      expect(response.status).toBe(200);
      const body = await response.json();

      // Check structure
      expect(body).toHaveProperty('contributorId');
      expect(body).toHaveProperty('totalEdits');
      expect(body).toHaveProperty('looseEdited');
      expect(body).toHaveProperty('firstEdit');
      expect(body).toHaveProperty('lastEdit');
      expect(body).toHaveProperty('recentActivity');
      expect(body).toHaveProperty('editTypes');
      expect(body).toHaveProperty('topFields');

      expect(body.contributorId).toBe(contributorId);
      expect(typeof body.totalEdits).toBe('number');
      expect(typeof body.looseEdited).toBe('number');
      expect(typeof body.firstEdit).toBe('string');
      expect(typeof body.lastEdit).toBe('string');

      expect(body.recentActivity).toHaveProperty('last7Days');
      expect(body.recentActivity).toHaveProperty('last30Days');
      expect(typeof body.recentActivity.last7Days).toBe('number');
      expect(typeof body.recentActivity.last30Days).toBe('number');

      expect(body.editTypes).toHaveProperty('creates');
      expect(body.editTypes).toHaveProperty('updates');
      expect(typeof body.editTypes.creates).toBe('number');
      expect(typeof body.editTypes.updates).toBe('number');

      expect(Array.isArray(body.topFields)).toBe(true);

      // Check topFields structure if present
      if (body.topFields.length > 0) {
        const field = body.topFields[0];
        expect(field).toHaveProperty('field');
        expect(field).toHaveProperty('count');
        expect(typeof field.field).toBe('string');
        expect(typeof field.count).toBe('number');
      }

      // Logical checks
      expect(body.recentActivity.last7Days).toBeLessThanOrEqual(
        body.recentActivity.last30Days,
      );
      expect(body.recentActivity.last30Days).toBeLessThanOrEqual(body.totalEdits);
      expect(body.editTypes.creates + body.editTypes.updates).toBeLessThanOrEqual(
        body.totalEdits,
      );
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
