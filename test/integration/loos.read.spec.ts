import { describe, expect, it } from 'vitest';
import { callApi } from './utils/test-client';
import { getTestContext } from './setup';
import { createLooFixture } from './utils/fixtures';
import { LooService } from '../../src/services/loo';

const validButMissingId = '0'.repeat(24);

describe('loo read endpoints', () => {
  it('filters geohash queries by the active flag', async () => {
    const { prisma } = getTestContext();
    const active = await createLooFixture(prisma, {
      name: 'Active Loo',
      location: { lat: 51.501, lng: -0.141 },
      active: true,
    });
    const inactive = await createLooFixture(prisma, {
      name: 'Inactive Loo',
      location: { lat: 51.5015, lng: -0.1415 },
      active: false,
    });

    const prefix = (active.geohash ?? '').slice(0, 5);
    expect(prefix).not.toHaveLength(0);

    const defaultResponse = await callApi(`/loos/geohash/${prefix}`);
    const defaultBody = await defaultResponse.json();
    expect(defaultBody.count).toBe(1);
    expect(defaultBody.data[0].id).toBe(active.id);

    const anyResponse = await callApi(`/loos/geohash/${prefix}?active=any`);
    const anyBody = await anyResponse.json();
    expect(anyBody.count).toBe(2);
    expect(anyBody.data.map((loo: { id: string }) => loo.id)).toEqual(
      expect.arrayContaining([active.id, inactive.id]),
    );

    const inactiveResponse = await callApi(`/loos/geohash/${prefix}?active=false`);
    const inactiveBody = await inactiveResponse.json();
    expect(inactiveBody.count).toBe(1);
    expect(inactiveBody.data[0].id).toBe(inactive.id);
  });

  it('validates proximity queries before hitting the database', async () => {
    const response = await callApi('/loos/proximity?lat=abc&lng=-0.12');
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toBe('Invalid proximity query');
    expect(body.issues?.lat?._errors?.[0]).toContain('number');
  });

  it('returns nearby loos ordered by distance with the proximity endpoint', async () => {
    const { prisma } = getTestContext();
    const nearer = await createLooFixture(prisma, {
      name: 'Closer Loo',
      location: { lat: -10, lng: -10 },
    });
    const farther = await createLooFixture(prisma, {
      name: 'Farther Loo',
      location: { lat: -10, lng: -10.2 },
    });

    const response = await callApi('/loos/proximity?lat=-10&lng=-10&radius=50000');
    expect(response.status).toBe(200);
    const body = await response.json();
    const ids = body.data.map((loo: { id: string }) => loo.id);
    expect(ids).toEqual(expect.arrayContaining([nearer.id, farther.id]));
    expect(body.data[0].id).toBe(nearer.id);
    expect(body.data[0].distance).toBeLessThan(body.data.find((entry: { id: string }) => entry.id === farther.id)!.distance);
    expect(body.data[0]).toHaveProperty('distance');
  });

  it('includes pagination metadata when searching loos', async () => {
    const { prisma } = getTestContext();
    await createLooFixture(prisma, { name: 'Central Library' });
    await createLooFixture(prisma, { name: 'Central Park' });
    await createLooFixture(prisma, { name: 'Riverside Walk' });

    const response = await callApi(
      '/loos/search?search=Central&limit=1&page=2&sort=created-desc',
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.count).toBe(1);
    expect(body.total).toBe(2);
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(1);
    expect(body.hasMore).toBe(false);
    expect(body.data[0].name).toMatch(/Central/);
  });

  it('returns audit history summaries and hydrated reports', async () => {
    const { prisma } = getTestContext();
    const target = await createLooFixture(prisma, { name: 'Audited Loo' });
    const service = new LooService(prisma);
    await service.upsert(
      target.id,
      { notes: 'Updated notes', radar: true },
      'report-author',
    );

    const summaryResponse = await callApi(`/loos/${target.id}/reports`);
    const summary = await summaryResponse.json();
    expect(summary.count).toBeGreaterThanOrEqual(1);
    expect(summary.data[0]).not.toHaveProperty('location');
    expect(summary.data[0]).toHaveProperty('diff');

    const hydratedResponse = await callApi(`/loos/${target.id}/reports?hydrate=true`);
    const hydrated = await hydratedResponse.json();
    expect(hydrated.count).toBe(summary.count);
    expect(hydrated.data[0]).toHaveProperty('location');
    expect(hydrated.data[0]).toHaveProperty('accessible');
  });

  it('enforces id validation and handles missing loos on the detail route', async () => {
    const shortIdResponse = await callApi('/loos/too-short');
    expect(shortIdResponse.status).toBe(400);
    expect(await shortIdResponse.json()).toEqual({
      message: 'id must be exactly 24 characters',
    });

    const missingResponse = await callApi(`/loos/${validButMissingId}`);
    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toEqual({ message: 'Loo not found' });

    const { prisma } = getTestContext();
    const existing = await createLooFixture(prisma, { name: 'Detail Loo' });
    const detailResponse = await callApi(`/loos/${existing.id}`);
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json();
    expect(detail.id).toBe(existing.id);
    expect(detail.name).toBe('Detail Loo');
  });

  it('requires ids query parameters when fetching loos in bulk', async () => {
    const missingIdsResponse = await callApi('/loos');
    expect(missingIdsResponse.status).toBe(400);
    expect(await missingIdsResponse.json()).toEqual({
      message:
        'Provide ids query parameter (comma separated or repeated) to fetch loos',
    });

    const { prisma } = getTestContext();
    const first = await createLooFixture(prisma, { name: 'One' });
    const second = await createLooFixture(prisma, { name: 'Two' });

    const response = await callApi(`/loos?ids=${first.id},${second.id}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.count).toBe(2);
    expect(body.data.map((loo: { id: string }) => loo.id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
  });
});
