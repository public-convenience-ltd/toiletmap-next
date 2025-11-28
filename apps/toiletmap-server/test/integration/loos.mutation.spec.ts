import { describe, expect, it } from 'vitest';
import { callApi, jsonRequest } from './utils/test-client';
import { createFixtureFactory } from './utils/fixtures';
import { getTestContext } from './setup';
import { generateLooId, LOO_ID_LENGTH } from '../../src/services/loo';
import { cleanupManager } from './utils/cleanup';

const fixtures = createFixtureFactory();

const authHeaders = () => {
  const { issueToken } = getTestContext();
  return {
    Authorization: `Bearer ${issueToken()}`,
  };
};

const authedJson = (method: string, body: unknown) =>
  jsonRequest(method, body, authHeaders());

describe('Loo mutation endpoints', () => {
  describe('POST /api/loos', () => {
    it('creates a loo with a generated id when none supplied', async () => {
      const payload = {
        name: 'API Created Loo',
        location: { lat: 51.49, lng: -0.11 },
        accessible: true,
        openingTimes: null,
      };

      const response = await callApi('/api/loos', authedJson('POST', payload));
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.id).toHaveLength(LOO_ID_LENGTH);
      expect(body.name).toBe(payload.name);
      cleanupManager.trackLoo(body.id);
    });

    it('rejects duplicate ids with a 409', async () => {
      const existing = await fixtures.loos.create();
      const payload = {
        id: existing.id,
        name: 'Duplicate Loo',
        location: { lat: 51.6, lng: -0.12 },
      };

      const response = await callApi('/api/loos', authedJson('POST', payload));
      expect(response.status).toBe(409);
    });

    it('validates custom ids are the correct length', async () => {
      const payload = {
        id: 'short-id',
        name: 'Invalid Id Loo',
        location: { lat: 51.5, lng: -0.13 },
      };
      const response = await callApi('/api/loos', authedJson('POST', payload));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.message).toBe('Invalid create request body');
      const issueMessage =
        body.issues?.id?._errors?.[0] ?? body.issues?.id?._errors ?? '';
      expect(String(issueMessage)).toMatch(/24/);
    });

    it('requires authentication', async () => {
      const response = await callApi(
        '/api/loos',
        jsonRequest('POST', {
          name: 'No Auth',
          location: { lat: 51.4, lng: -0.1 },
        }),
      );
      expect(response.status).toBe(401);
    });

    it('rejects invalid bearer tokens', async () => {
      const response = await callApi(
        '/api/loos',
        jsonRequest(
          'POST',
          { name: 'Bad token', location: { lat: 51.4, lng: -0.1 } },
          { Authorization: 'Bearer invalid-token' },
        ),
      );
      expect(response.status).toBe(401);
    });
  });

  describe('PUT /api/loos/:id', () => {
    it('creates a loo when the id is new', async () => {
      const id = generateLooId();
      const payload = {
        name: 'Created via PUT',
        location: { lat: 51.7, lng: -0.14 },
        notes: 'Created through upsert endpoint',
      };

      const response = await callApi(`/api/loos/${id}`, authedJson('PUT', payload));
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.id).toBe(id);
      expect(body.notes).toBe(payload.notes);
      cleanupManager.trackLoo(id);
    });

    it('updates an existing loo and returns 200', async () => {
      const existing = await fixtures.loos.create({ notes: 'Before update' });
      const payload = {
        notes: 'After update',
        radar: true,
        openingTimes: [
          ['09:00', '17:00'],
          ['09:00', '17:00'],
          ['09:00', '17:00'],
          ['09:00', '17:00'],
          ['09:00', '17:00'],
          [],
          [],
        ],
      };

      const response = await callApi(
        `/api/loos/${existing.id}`,
        authedJson('PUT', payload),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.notes).toBe('After update');
      expect(body.radar).toBe(true);
    });

    it('requires authentication for updates', async () => {
      const existing = await fixtures.loos.create();
      const response = await callApi(
        `/api/loos/${existing.id}`,
        jsonRequest('PUT', { notes: 'No auth update' }),
      );
      expect(response.status).toBe(401);
    });

    it('validates request bodies', async () => {
      const id = generateLooId();
      const invalidPayload = {
        // opening times must contain 7 entries, so this should fail validation
        openingTimes: [['09:00', '17:00']],
      };
      const response = await callApi(
        `/api/loos/${id}`,
        authedJson('PUT', invalidPayload),
      );
      expect(response.status).toBe(400);
    });
  });
});
