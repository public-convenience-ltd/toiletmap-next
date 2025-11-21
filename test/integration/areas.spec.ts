import { describe, expect, it } from 'vitest';
import { callApi } from './utils/test-client';

describe('GET /areas', () => {
  it('returns persisted areas with count metadata', async () => {
    const response = await callApi('/areas');
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({
      count: expect.any(Number),
      data: expect.any(Array),
    });
    expect(body.count).toBe(body.data.length);
    if (body.count > 0) {
      expect(body.data[0]).toMatchObject({
        name: expect.anything(),
      });
    }
  });
});
