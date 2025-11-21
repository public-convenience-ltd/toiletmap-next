import { describe, expect, it } from 'vitest';
import { callApi, jsonRequest } from './utils/test-client';
import { getTestContext } from './setup';
import { createLooFixture } from './utils/fixtures';

const buildPayload = (overrides: Record<string, unknown> = {}) => ({
  name: 'Central Station',
  accessible: true,
  active: true,
  location: { lat: 51.5, lng: -0.12 },
  ...overrides,
});

const authHeaders = (claims?: Record<string, unknown>) => {
  const { issueToken } = getTestContext();
  const token = issueToken({
    app_metadata: { nickname: 'cf-worker' },
    ...claims,
  });
  return { Authorization: `Bearer ${token}` };
};

describe('loo mutation endpoints', () => {
  it('requires authentication for create requests', async () => {
    const response = await callApi('/loos', jsonRequest('POST', buildPayload()));
    expect(response.status).toBe(401);
  });

  it('validates payloads before attempting to create a loo', async () => {
    const response = await callApi(
      '/loos',
      jsonRequest('POST', { ...buildPayload(), id: 'short' }, authHeaders()),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toBe('Invalid create request body');
  });

  it('prevents creating duplicate loos by id', async () => {
    const { prisma } = getTestContext();
    const existingId = 'c'.repeat(24);
    await createLooFixture(prisma, { id: existingId, name: 'Duplicate' });

    const response = await callApi(
      '/loos',
      jsonRequest('POST', { ...buildPayload(), id: existingId }, authHeaders()),
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.message).toContain('already exists');
  });

  it('creates loos end-to-end when payloads are valid', async () => {
    const { prisma } = getTestContext();
    const response = await callApi(
      '/loos',
      jsonRequest(
        'POST',
        buildPayload({ noPayment: true, notes: 'Created via test' }),
        authHeaders(),
      ),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toHaveLength(24);
    expect(body.name).toBe('Central Station');
    expect(body.noPayment).toBe(true);

    const record = await prisma.toilets.findUnique({ where: { id: body.id } });
    expect(record?.contributors?.at(-1)).toBe('cf-worker');
  });

  it('validates loo ids on upsert requests', async () => {
    const response = await callApi(
      '/loos/not-a-valid-id',
      jsonRequest('PUT', buildPayload(), authHeaders()),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: 'id must be exactly 24 characters',
    });
  });

  it('creates a loo via upsert when the record does not exist', async () => {
    const newId = '1'.repeat(24);
    const response = await callApi(
      `/loos/${newId}`,
      jsonRequest('PUT', buildPayload({ notes: 'Upsert create' }), authHeaders()),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe(newId);
    expect(body.notes).toBe('Upsert create');
  });

  it('updates an existing loo via upsert', async () => {
    const { prisma } = getTestContext();
    const existing = await createLooFixture(prisma, { name: 'Original Name' });

    const response = await callApi(
      `/loos/${existing.id}`,
      jsonRequest(
        'PUT',
        buildPayload({ name: 'Updated Name', notes: 'Upsert update' }),
        authHeaders({ nickname: 'update-author' }),
      ),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe('Updated Name');

    const updatedRecord = await prisma.toilets.findUnique({ where: { id: existing.id } });
    expect(updatedRecord?.contributors?.at(-1)).toBe('update-author');
  });
});
