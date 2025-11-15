import { beforeAll, describe, expect, it } from 'vitest';
import { testClient } from '../context';
import { issueAuthToken } from './helpers';

/** Tests edge cases, error scenarios, and boundary conditions. */
describe.sequential('Loos API - edge cases', () => {
  let authToken: string;

  beforeAll(() => {
    authToken = issueAuthToken();
  });

  it('handles empty search term gracefully', async () => {
    const { response, data } = await testClient.json<{
      data: Array<unknown>;
      total: number;
    }>('/loos/search?search=');

    expect(response.status).toBe(200);
    expect(Array.isArray(data.data)).toBe(true);
  });

  it('handles whitespace-only search term', async () => {
    const { response, data } = await testClient.json<{
      data: Array<unknown>;
      total: number;
    }>('/loos/search?search=%20%20%20');

    expect(response.status).toBe(200);
    expect(Array.isArray(data.data)).toBe(true);
  });

  it('handles very long geohash prefix', async () => {
    const longGeohash = 'gcpvj7g'.repeat(5); // 35 chars
    const { response, data } = await testClient.json<{
      data: Array<unknown>;
      count: number;
    }>(`/loos/geohash/${longGeohash}`);

    expect(response.status).toBe(200);
    expect(data.count).toBe(0);
  });

  it('handles single character geohash prefix', async () => {
    const { response, data } = await testClient.json<{
      data: Array<unknown>;
      count: number;
    }>('/loos/geohash/g');

    expect(response.status).toBe(200);
    expect(Array.isArray(data.data)).toBe(true);
  });

  it('returns 404 for non-existent loo ID with correct length', async () => {
    const nonExistentId = 'ff'.repeat(12); // Valid length, unlikely to exist
    const response = await testClient.fetch(`/loos/${nonExistentId}`);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.message).toContain('not found');
  });

  it('returns empty array for non-existent IDs in batch query', async () => {
    const fakeId1 = 'ee'.repeat(12);
    const fakeId2 = 'dd'.repeat(12);
    const { response, data } = await testClient.json<{
      data: Array<unknown>;
      count: number;
    }>(`/loos?ids=${fakeId1},${fakeId2}`);

    expect(response.status).toBe(200);
    expect(data.count).toBe(0);
    expect(data.data).toEqual([]);
  });

  it('handles pagination beyond available records', async () => {
    const { response, data } = await testClient.json<{
      data: Array<unknown>;
      total: number;
      hasMore: boolean;
      page: number;
    }>('/loos/search?page=999999&limit=50');

    expect(response.status).toBe(200);
    expect(data.data.length).toBe(0);
    expect(data.hasMore).toBe(false);
    expect(data.page).toBe(999999);
  });

  it('enforces maximum limit on search', async () => {
    const response = await testClient.fetch('/loos/search?limit=500');

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('Invalid search query');
  });

  it('enforces minimum limit on search', async () => {
    const response = await testClient.fetch('/loos/search?limit=0');

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('Invalid search query');
  });

  it('rejects negative page numbers', async () => {
    const response = await testClient.fetch('/loos/search?page=-1');

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('Invalid search query');
  });

  it('rejects invalid sort option', async () => {
    const response = await testClient.fetch('/loos/search?sort=invalid-sort');

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('Invalid search query');
  });

  it('rejects radius exceeding maximum', async () => {
    const response = await testClient.fetch(
      '/loos/proximity?lat=51.5&lng=-0.1&radius=100000',
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('Invalid proximity query');
  });

  it('rejects negative radius', async () => {
    const response = await testClient.fetch(
      '/loos/proximity?lat=51.5&lng=-0.1&radius=-100',
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('Invalid proximity query');
  });

  it('handles mixed case active flag values', async () => {
    const { response } = await testClient.json<{
      data: Array<unknown>;
    }>('/loos/search?active=TRUE');

    expect(response.status).toBe(200);
  });

  it('handles mixed case boolean filter values', async () => {
    const { response } = await testClient.json<{
      data: Array<unknown>;
    }>('/loos/search?verified=FaLsE');

    expect(response.status).toBe(200);
  });

  it('returns empty reports array for non-existent loo', async () => {
    const nonExistentId = 'aa'.repeat(12);
    const { response, data } = await testClient.json<{
      data: Array<unknown>;
      count: number;
    }>(`/loos/${nonExistentId}/reports`);

    expect(response.status).toBe(200);
    expect(data.count).toBe(0);
    expect(data.data).toEqual([]);
  });

  it('handles hydrate parameter with various casings', async () => {
    const nonExistentId = 'bb'.repeat(12);

    const trueResponse = await testClient.fetch(
      `/loos/${nonExistentId}/reports?hydrate=TRUE`,
    );
    expect(trueResponse.status).toBe(200);

    const falseResponse = await testClient.fetch(
      `/loos/${nonExistentId}/reports?hydrate=FALSE`,
    );
    expect(falseResponse.status).toBe(200);
  });

  it('handles comma-separated IDs with extra whitespace', async () => {
    const id1 = 'cc'.repeat(12);
    const id2 = 'dd'.repeat(12);
    const { response, data } = await testClient.json<{
      data: Array<unknown>;
      count: number;
    }>(`/loos?ids=${id1}%20,%20${id2}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(data.data)).toBe(true);
  });

  it('handles repeated ids parameter', async () => {
    const id1 = 'ee'.repeat(12);
    const id2 = 'ff'.repeat(12);
    const { response, data } = await testClient.json<{
      data: Array<unknown>;
      count: number;
    }>(`/loos?ids=${id1}&ids=${id2}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(data.data)).toBe(true);
  });

  it('rejects proximity query with latitude out of range', async () => {
    const response = await testClient.fetch(
      '/loos/proximity?lat=100&lng=0&radius=1000',
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('Invalid proximity query');
  });

  it('rejects proximity query with longitude out of range', async () => {
    const response = await testClient.fetch(
      '/loos/proximity?lat=0&lng=200&radius=1000',
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('Invalid proximity query');
  });

  it('uses default radius when not specified', async () => {
    const { response, data } = await testClient.json<{
      data: Array<unknown>;
      count: number;
    }>('/loos/proximity?lat=51.5&lng=-0.1');

    expect(response.status).toBe(200);
    expect(Array.isArray(data.data)).toBe(true);
  });
});
