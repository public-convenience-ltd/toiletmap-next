import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateLooId } from '../../../src/services/loo';
import { prisma, testClient } from '../context';
import {
  authedJsonHeaders,
  deleteTestLoos,
  issueAuthToken,
  loadLooSeedData,
} from './helpers';

type SearchResponse = {
  data: Array<{
    id: string;
    name: string | null;
    active: boolean | null;
    noPayment: boolean | null;
  }>;
  total: number;
};

describe.sequential('Loos Service - persistence & search', () => {
  const createdIds: string[] = [];
  let authToken: string;
  let areaId: string | null = null;

  beforeAll(async () => {
    authToken = issueAuthToken();
    const seeds = await loadLooSeedData();
    areaId = seeds.areaId;
  });

  afterAll(async () => {
    await deleteTestLoos(createdIds);
  });

  it('upserts a missing loo via PUT and persists geography plus contributors', async () => {
    const id = generateLooId();
    const payload = {
      name: 'Persistence Upsert Candidate',
      areaId,
      active: true,
      accessible: true,
      noPayment: true,
      location: { lat: 51.509865, lng: -0.118092 },
    };

    const { response, data } = await testClient.json<{ id: string }>(`/loos/${id}`, {
      method: 'PUT',
      headers: authedJsonHeaders(authToken),
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(201);
    expect(data.id).toBe(id);
    createdIds.push(id);

    const stored = await prisma.toilets.findUnique({
      where: { id },
      select: { contributors: true, active: true, accessible: true },
    });

    expect(stored).toBeTruthy();
    expect(stored?.active).toBe(true);
    expect(stored?.accessible).toBe(true);

    const contributors = stored?.contributors ?? [];
    expect(contributors.length).toBeGreaterThan(0);
    expect(contributors[contributors.length - 1]).toBe('E2E Tester');

    const [geo] =
      await prisma.$queryRaw<Array<{ hasGeography: boolean }>>`
        SELECT geography IS NOT NULL AS "hasGeography"
        FROM toilets
        WHERE id = ${id}
      `;
    expect(geo?.hasGeography).toBe(true);
  });

  it('search endpoint sorts and filters records created via persistence helpers', async () => {
    const slug = `E2E Search ${Date.now().toString(36)}`;
    const fixtures = [
      {
        id: generateLooId(),
        name: `${slug} Alpha`,
        active: true,
        noPayment: true,
        location: { lat: 51.504, lng: -0.09 },
      },
      {
        id: generateLooId(),
        name: `${slug} Beta`,
        active: false,
        noPayment: false,
        location: { lat: 51.505, lng: -0.1 },
      },
    ] as const;

    for (const fixture of fixtures) {
      const { response, data } = await testClient.json<{ id: string }>(`/loos`, {
        method: 'POST',
        headers: authedJsonHeaders(authToken),
        body: JSON.stringify({ ...fixture, areaId }),
      });
      expect(response.status).toBe(201);
      expect(data.id).toBe(fixture.id);
      createdIds.push(fixture.id);
    }

    const baseParams = {
      search: slug,
      sort: 'name-asc',
      limit: '10',
      page: '1',
      hasLocation: 'true',
    };

    const searchAll = await testClient.json<SearchResponse>(
      `/loos/search?${new URLSearchParams(baseParams).toString()}`,
    );
    expect(searchAll.response.status).toBe(200);
    const orderedIds = searchAll.data.data.map((row) => row.id);
    expect(orderedIds).toEqual([fixtures[0].id, fixtures[1].id]);

    const inactiveOnly = await testClient.json<SearchResponse>(
      `/loos/search?${new URLSearchParams({
        ...baseParams,
        active: 'false',
      }).toString()}`,
    );
    expect(inactiveOnly.response.status).toBe(200);
    expect(inactiveOnly.data.data.map((row) => row.id)).toEqual([
      fixtures[1].id,
    ]);

    const cashlessOnly = await testClient.json<SearchResponse>(
      `/loos/search?${new URLSearchParams({
        ...baseParams,
        noPayment: 'true',
      }).toString()}`,
    );
    expect(cashlessOnly.response.status).toBe(200);
    expect(cashlessOnly.data.data.map((row) => row.id)).toEqual([
      fixtures[0].id,
    ]);
  });
});
