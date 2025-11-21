import type {
  LooMutationAttributes,
  LooResponse,
} from '../../../src/services/loo/types';
import type { toilets } from '../../../src/prisma';

const SIDECAR_URL = 'http://localhost:3001';

export const createAreaFixture = async (
  // prisma argument removed
  overrides: {
    id?: string;
    name?: string | null;
    type?: string | null;
    priority?: number | null;
    datasetId?: number | null;
    version?: number | null;
  } = {},
) => {
  const response = await fetch(`${SIDECAR_URL}/fixtures/area`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(overrides),
  });

  if (!response.ok) {
    throw new Error(`Failed to create area fixture: ${response.statusText}`);
  }

  return response.json();
};

export type LooFixtureOverrides = LooMutationAttributes & {
  id?: string;
  contributor?: string | null;
};

export const createLooFixture = async (
  // prisma argument removed
  overrides: LooFixtureOverrides = {},
): Promise<LooResponse> => {
  const response = await fetch(`${SIDECAR_URL}/fixtures/loo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(overrides),
  });

  if (!response.ok) {
    throw new Error(`Failed to create loo fixture: ${response.statusText}`);
  }

  return response.json() as Promise<LooResponse>;
};

export const getLooById = async (id: string): Promise<toilets | null> => {
  const response = await fetch(`${SIDECAR_URL}/loos/${id}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to get loo: ${response.statusText}`);
  }
  return response.json() as Promise<toilets>;
};

export const upsertLooFixture = async (
  id: string,
  data: LooMutationAttributes,
  contributor: string,
): Promise<LooResponse> => {
  const response = await fetch(`${SIDECAR_URL}/fixtures/upsert-loo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, data, contributor }),
  });

  if (!response.ok) {
    throw new Error(`Failed to upsert loo fixture: ${response.statusText}`);
  }

  return response.json() as Promise<LooResponse>;
};
