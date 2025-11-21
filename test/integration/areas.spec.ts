import { describe, expect, it } from 'vitest';
import { callApi } from './utils/test-client';
describe('GET /areas', () => {
  it('returns persisted areas with count metadata', async () => {
    const response = await callApi('/areas');
    expect(response.status).toBe(200);
    const body = await response.json();
    if (body.count === 0) {
      throw new Error(
        'The areas table is empty. Run `pnpm supabase:reset` to load seed data before executing the integration suite.',
      );
    }
    expect(body.count).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty('name');
    expect(body.data[0]).toHaveProperty('type');
  });
});
