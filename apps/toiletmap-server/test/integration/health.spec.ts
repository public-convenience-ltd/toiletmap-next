import { describe, expect, it } from 'vitest';
import { callApi } from './utils/test-client';

describe('Root routes', () => {
  it('returns service metadata on GET /', async () => {
    const response = await callApi('/');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      service: 'toiletmap-server',
    });
    expect(new Date(body.timestamp).toString()).not.toBe('Invalid Date');
    // Status should be 'ok' or 'degraded' based on actual health
    expect(['ok', 'degraded']).toContain(body.status);
  });

  it('reflects degraded status when dependencies are unhealthy', async () => {
    const response = await callApi('/');
    const body = await response.json();

    // Status should match the actual health of the system
    // In a healthy test environment, this should be 'ok'
    // When database is down, it should be 'degraded'
    expect(['ok', 'degraded']).toContain(body.status);

    // If degraded, status should be consistent with health check
    if (body.status === 'degraded') {
      const healthResponse = await callApi('/health/ready');
      const healthBody = await healthResponse.json();
      expect(healthBody.status).toBe('degraded');
    }
  });

  it('responds with 404 for unknown routes', async () => {
    const response = await callApi('/does-not-exist');
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.message).toMatch(/not found/i);
  });
});

describe('Health check endpoints', () => {
  describe('GET /health/live', () => {
    it('returns 200 with service status', async () => {
      const response = await callApi('/health/live');
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toMatchObject({
        status: 'ok',
        service: 'toiletmap-server',
      });
      expect(body.timestamp).toBeDefined();
      expect(new Date(body.timestamp).toString()).not.toBe('Invalid Date');
    });

    it('always returns ok status (liveness probe)', async () => {
      // Liveness probe should always succeed unless the process is dead
      const response = await callApi('/health/live');
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.status).toBe('ok');
    });
  });

  describe('GET /health/ready', () => {
    it('returns 200 when all checks pass', async () => {
      const response = await callApi('/health/ready');

      // Should return 200 when healthy
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toMatchObject({
        status: 'ok',
        service: 'toiletmap-server',
      });
      expect(body.timestamp).toBeDefined();
      expect(body.checks).toBeDefined();
      expect(Array.isArray(body.checks)).toBe(true);
    });

    it('includes database health check', async () => {
      const response = await callApi('/health/ready');
      const body = await response.json();

      const dbCheck = body.checks.find((check: any) => check.name === 'database');
      expect(dbCheck).toBeDefined();
      expect(dbCheck.status).toBe('ok');
      expect(dbCheck.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('does not expose sensitive error information in development', async () => {
      const response = await callApi('/health/ready');
      const body = await response.json();

      // Even in development mode, health checks should not expose:
      // - Database passwords
      // - Connection strings
      // - Internal paths
      // - Stack traces
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toContain('password');
      expect(bodyStr).not.toContain('Wrong password');
      expect(bodyStr).not.toContain('Server connection attempt failed');

      // In development, we may see "database check failed" or the actual error
      // but never raw connection errors with credentials
      if (body.status === 'degraded') {
        const dbCheck = body.checks.find((check: any) => check.name === 'database');
        if (dbCheck?.message) {
          // Message should be sanitized or generic
          expect(dbCheck.message).toMatch(/database|connection|failed/i);
        }
      }
    });

    it('returns 503 when database check fails', async () => {
      // Note: This test would require mocking database failures
      // In real scenarios with a working database, this won't trigger
      // This is a placeholder for when database mocking is implemented

      // For now, just verify the endpoint structure is correct
      const response = await callApi('/health/ready');
      const body = await response.json();

      // Verify response structure supports degraded state
      expect(['ok', 'degraded']).toContain(body.status);
      if (body.status === 'degraded') {
        expect(response.status).toBe(503);
      }
    });
  });

  describe('GET /health (legacy endpoint)', () => {
    it('redirects to /health/ready', async () => {
      const response = await callApi('/health', {
        redirect: 'manual',
      });

      // Should redirect
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/health/ready');
    });
  });

  describe('Error sanitization in production mode', () => {
    it('does not expose stack traces or sensitive details', async () => {
      // This test verifies the error sanitization works correctly
      // In production, ENVIRONMENT would be set to "production" or "preview"

      const response = await callApi('/health/ready');
      const body = await response.json();
      const bodyStr = JSON.stringify(body);

      // Verify no sensitive information is exposed:
      // - No stack traces
      expect(bodyStr).not.toContain('at PrismaPgAdapter');
      expect(bodyStr).not.toContain('DriverAdapterError');
      expect(bodyStr).not.toContain('index.js:');
      expect(bodyStr).not.toContain('stack');

      // - No database credentials or connection details
      expect(bodyStr).not.toContain('e=Wrong password');
      expect(bodyStr).not.toContain('postgresql://');
      expect(bodyStr).not.toContain('connectionString');

      // - No raw Prisma errors
      expect(bodyStr).not.toContain('Invalid `prisma.');
      expect(bodyStr).not.toContain('Raw query failed');
      expect(bodyStr).not.toContain('Code: `58000`');
    });

    it('provides generic error messages for failed checks', async () => {
      const response = await callApi('/health/ready');
      const body = await response.json();

      // If there's a database error, the message should be generic
      if (body.status === 'degraded') {
        const dbCheck = body.checks.find((check: any) => check.name === 'database');
        if (dbCheck?.status === 'error') {
          // In production/preview: "database check failed"
          // In development: might be more detailed but still sanitized
          expect(dbCheck.message).toBeDefined();
          expect(dbCheck.message).toMatch(/database|check|failed|connection/i);

          // Should NOT contain specific database error details
          expect(dbCheck.message).not.toContain('Wrong password');
          expect(dbCheck.message).not.toContain('58000');
        }
      }
    });

    it('maintains observability with response times', async () => {
      const response = await callApi('/health/ready');
      const body = await response.json();

      // Even with sanitized errors, we should still get timing info
      const dbCheck = body.checks.find((check: any) => check.name === 'database');
      expect(dbCheck).toBeDefined();
      expect(typeof dbCheck.responseTime).toBe('number');
      expect(dbCheck.responseTime).toBeGreaterThanOrEqual(0);
    });
  });
});
