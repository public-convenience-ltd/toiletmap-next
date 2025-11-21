// import { describe, expect, it } from 'vitest';
// import { testClient } from './context';

// /** Quick boot smoke test so we fail fast if the app cannot start. */
// type HealthResponse = {
//   status: string;
//   service: string;
//   uptime: number;
// };

// describe('Healthcheck', () => {
//   it('reports service status and uptime', async () => {
//     const { response, data } =
//       await testClient.json<HealthResponse>('/');

//     expect(response.status).toBe(200);
//     expect(data.status).toBe('ok');
//     expect(data.service).toBe('toiletmap-hono-api');
//     expect(data.uptime).toBeGreaterThan(0);
//   });
// });
// import "dotenv/config";

import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
  SELF,
} from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../../src/index';

describe('Health check endpoint', () => {
  it('responds with service status', async () => {
    const request = new Request('http://localhost/');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);

    const data = (await response.json()) as any;
    expect(data.status).toBe('ok');
    expect(data.service).toBe('toiletmap-hono-api');
    expect(data.timestamp).toBeDefined();
  });
});