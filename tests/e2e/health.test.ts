import { describe, expect, it } from 'vitest';
import { testClient } from './context';

/** Quick boot smoke test so we fail fast if the app cannot start. */
type HealthResponse = {
  status: string;
  service: string;
  uptime: number;
};

describe('Healthcheck', () => {
  it('reports service status and uptime', async () => {
    const { response, data } =
      await testClient.json<HealthResponse>('/');

    expect(response.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.service).toBe('toiletmap-hono-api');
    expect(data.uptime).toBeGreaterThan(0);
  });
});
