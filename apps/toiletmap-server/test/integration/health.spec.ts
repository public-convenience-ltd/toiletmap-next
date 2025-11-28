import { describe, expect, it } from 'vitest';
import { callApi } from './utils/test-client';

describe('Root routes', () => {
  it('returns service metadata on GET /', async () => {
    const response = await callApi('/');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      status: 'ok',
      service: 'toiletmap-hono-api',
    });
    expect(new Date(body.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('responds with 404 for unknown routes', async () => {
    const response = await callApi('/does-not-exist');
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.message).toMatch(/not found/i);
  });
});
