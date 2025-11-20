import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOO_ID_LENGTH, generateLooId } from '../../../src/services/loo';
import { prisma, testClient } from '../context';
import {
  authedJsonHeaders,
  deleteTestLoos,
  issueAuthToken,
  jsonHeaders,
  loadLooSeedData,
} from './helpers';

/** Covers create/update/delete life cycles plus persistence side-effects. */
type LooResponse = {
  id: string;
  name: string | null;
  geohash: string | null;
  active: boolean | null;
  accessible: boolean | null;
  allGender: boolean | null;
  attended: boolean | null;
  automatic: boolean | null;
  babyChange: boolean | null;
  children: boolean | null;
  men: boolean | null;
  women: boolean | null;
  urinalOnly: boolean | null;
  radar: boolean | null;
  notes: string | null;
  noPayment: boolean | null;
  paymentDetails: string | null;
  removalReason: string | null;
  openingTimes: unknown;
  location: { lat: number; lng: number } | null;
  reports: unknown[];
};

describe.sequential('Loos API - mutations', () => {
  let authToken: string;
  let createdLooId: string | null = null;
  let createdIds: string[] = [];
  let previousContributorCount = 0;
  let areaId: string | null = null;

  const ensureCreated = () => {
    if (!createdLooId) throw new Error('Expected a loo to be created');
    return createdLooId;
  };

  beforeAll(async () => {
    authToken = issueAuthToken();
    const seed = await loadLooSeedData();
    areaId = seed.areaId;
  });

  afterAll(async () => {
    await deleteTestLoos(createdIds);
  });

  it('requires auth for creating loos', async () => {
    const response = await testClient.fetch('/loos', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'Unauthorized create' }),
    });

    expect(response.status).toBe(401);
  });

  it('validates incoming create payloads', async () => {
    const response = await testClient.fetch('/loos', {
      method: 'POST',
      headers: authedJsonHeaders(authToken),
      body: JSON.stringify({ areaId: 'too-short' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('issues');
  });

  it('creates a loo with the full set of properties when authenticated', async () => {
    const payload: Record<string, unknown> = {
      id: generateLooId(),
      name: 'E2E Full Options Loo',
      areaId,
      accessible: true,
      active: true,
      allGender: true,
      attended: true,
      automatic: true,
      babyChange: true,
      children: true,
      men: true,
      women: true,
      urinalOnly: false,
      radar: true,
      notes: 'Created to exercise full payload options',
      noPayment: true,
      paymentDetails: 'Contactless card only',
      removalReason: 'Scheduled refurbishment',
      openingTimes: [
        ['09:00', '17:00'], // Monday
        ['09:00', '17:00'], // Tuesday
        ['09:00', '17:00'], // Wednesday
        ['09:00', '17:00'], // Thursday
        ['10:00', '20:00'], // Friday
        [],                 // Saturday (closed)
        [],                 // Sunday (closed)
      ],
      location: { lat: 51.5007, lng: -0.1246 },
    };

    const { response, data } = await testClient.json<LooResponse>('/loos', {
      method: 'POST',
      headers: authedJsonHeaders(authToken),
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(201);
    expect(data.id).toHaveLength(LOO_ID_LENGTH);
    expect(data.name).toBe(payload.name);
    expect(data.location).toEqual(payload.location);
    expect(data.reports).toEqual([]);
    expect(data.accessible).toBe(true);
    expect(data.active).toBe(true);
    expect(data.allGender).toBe(true);
    expect(data.attended).toBe(true);
    expect(data.automatic).toBe(true);
    expect(data.babyChange).toBe(true);
    expect(data.children).toBe(true);
    expect(data.men).toBe(true);
    expect(data.women).toBe(true);
    expect(data.urinalOnly).toBe(false);
    expect(data.radar).toBe(true);
    expect(data.notes).toBe(payload.notes);
    expect(data.noPayment).toBe(true);
    expect(data.paymentDetails).toBe(payload.paymentDetails);
    expect(data.removalReason).toBe(payload.removalReason);
    expect(data.openingTimes).toEqual(payload.openingTimes);

    createdLooId = data.id;
    createdIds.push(createdLooId);

    const saved = await prisma.toilets.findUnique({
      where: { id: createdLooId },
      select: { name: true, contributors: true },
    });

    expect(saved?.name).toBe(payload.name);
    expect(saved?.contributors).toContain('E2E Tester');
    previousContributorCount = saved?.contributors.length ?? 0;
  });

  it('requires auth for updating loos', async () => {
    const id = ensureCreated();
    const response = await testClient.fetch(`/loos/${id}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'should fail' }),
    });

    expect(response.status).toBe(401);
  });

  it('updates all writable properties and toggles values', async () => {
    const id = ensureCreated();
    const updatePayload = {
      name: 'Updated Options Loo',
      accessible: false,
      active: false,
      allGender: false,
      attended: false,
      automatic: false,
      babyChange: false,
      children: false,
      men: false,
      women: false,
      urinalOnly: true,
      radar: false,
      notes: 'Updated via comprehensive mutation test',
      noPayment: false,
      paymentDetails: 'Coins accepted',
      removalReason: 'Reopened after refurb',
      openingTimes: [
        ['08:30', '22:00'], // Monday
        ['08:30', '22:00'], // Tuesday
        ['08:30', '22:00'], // Wednesday
        ['08:30', '22:00'], // Thursday
        ['08:30', '22:00'], // Friday
        ['08:30', '22:00'], // Saturday
        ['08:30', '22:00'], // Sunday
      ],
      location: { lat: 51.5012, lng: -0.1419 },
    };

    const { response, data } = await testClient.json<LooResponse>(
      `/loos/${id}`,
      {
        method: 'PUT',
        headers: authedJsonHeaders(authToken),
        body: JSON.stringify(updatePayload),
      },
    );

    expect(response.status).toBe(200);
    expect(data.id).toBe(id);
    expect(data.name).toBe(updatePayload.name);
    expect(data.accessible).toBe(updatePayload.accessible);
    expect(data.active).toBe(updatePayload.active);
    expect(data.allGender).toBe(updatePayload.allGender);
    expect(data.attended).toBe(updatePayload.attended);
    expect(data.automatic).toBe(updatePayload.automatic);
    expect(data.babyChange).toBe(updatePayload.babyChange);
    expect(data.children).toBe(updatePayload.children);
    expect(data.men).toBe(updatePayload.men);
    expect(data.women).toBe(updatePayload.women);
    expect(data.urinalOnly).toBe(updatePayload.urinalOnly);
    expect(data.radar).toBe(updatePayload.radar);
    expect(data.notes).toBe(updatePayload.notes);
    expect(data.noPayment).toBe(updatePayload.noPayment);
    expect(data.paymentDetails).toBe(updatePayload.paymentDetails);
    expect(data.removalReason).toBe(updatePayload.removalReason);
    expect(data.openingTimes).toEqual(updatePayload.openingTimes);
    expect(data.location).toEqual(updatePayload.location);

    const saved = await prisma.toilets.findUnique({
      where: { id },
      select: {
        accessible: true,
        active: true,
        contributors: true,
        opening_times: true,
        location: true,
      },
    });

    expect(saved?.accessible).toBe(false);
    expect(saved?.active).toBe(false);
    expect(saved?.opening_times).toEqual(updatePayload.openingTimes);
    expect(saved?.contributors.length ?? 0).toBeGreaterThan(
      previousContributorCount,
    );
    previousContributorCount = saved?.contributors.length ?? 0;
  });

  it('clears nullable properties and location when null or empty values are provided', async () => {
    const id = ensureCreated();
    const clearPayload = {
      notes: '',
      paymentDetails: null,
      removalReason: null,
      openingTimes: null,
      location: null,
    };

    const { response, data } = await testClient.json<LooResponse>(
      `/loos/${id}`,
      {
        method: 'PUT',
        headers: authedJsonHeaders(authToken),
        body: JSON.stringify(clearPayload),
      },
    );

    expect(response.status).toBe(200);
    expect(data.id).toBe(id);
    expect(data.notes).toBeNull();
    expect(data.paymentDetails).toBeNull();
    expect(data.removalReason).toBeNull();
    expect(data.openingTimes).toBeNull();
    expect(data.location).toBeNull();

    const saved = await prisma.toilets.findUnique({
      where: { id },
      select: { contributors: true, opening_times: true, location: true },
    });

    expect(saved?.opening_times).toBeNull();
    expect(saved?.location).toBeNull();
    const contributors = saved?.contributors ?? [];
    const latestContributor = contributors[contributors.length - 1] ?? '';
    expect(latestContributor).toBe('E2E Tester');
  });


});
