import { randomBytes } from 'node:crypto';
import type {
  LooMutationAttributes,
  LooResponse,
  Coordinates,
} from '../../../src/services/loo/types';
import type { toilets } from '../../../src/prisma';
import type { PrismaClientInstance } from '../../../src/prisma';
import { LooService } from '../../../src/services/loo';
import { getPrismaClient } from '../setup';

let areaCounter = 0;
let coordinateCounter = 0;

const deterministicAreaId = (counter: number) =>
  counter.toString(16).padStart(24, '0').slice(-24);

const nextCoordinates = (): Coordinates => {
  coordinateCounter += 1;
  return {
    lat: 51.5 + coordinateCounter * 0.001,
    lng: -0.12 - coordinateCounter * 0.001,
  };
};

const generateLooId = () => randomBytes(12).toString('hex');

const getPrisma = (): PrismaClientInstance => getPrismaClient();
const getLooService = () => new LooService(getPrisma());

export const createAreaFixture = async (
  overrides: {
    id?: string;
    name?: string | null;
    type?: string | null;
    priority?: number | null;
    datasetId?: number | null;
    version?: number | null;
  } = {},
) => {
  const prisma = getPrisma();

  areaCounter += 1;
  return prisma.areas.create({
    data: {
      id: overrides.id ?? deterministicAreaId(areaCounter),
      name: overrides.name ?? `Area ${areaCounter}`,
      type: overrides.type ?? 'borough',
      priority: overrides.priority ?? areaCounter,
      dataset_id: overrides.datasetId ?? 1,
      version: overrides.version ?? 1,
    },
  });
};

export type LooFixtureOverrides = LooMutationAttributes & {
  id?: string;
  contributor?: string | null;
};

export const createLooFixture = async (
  overrides: LooFixtureOverrides = {},
): Promise<LooResponse> => {
  const service = getLooService();
  const {
    id = generateLooId(),
    contributor = 'integration-fixture',
    ...mutationOverrides
  } = overrides;

  const { location: _ignoredLocation, ...withoutLocation } = mutationOverrides;
  const hasCustomLocation = Object.prototype.hasOwnProperty.call(
    overrides,
    'location',
  );
  const locationValue = hasCustomLocation
    ? (mutationOverrides.location ?? null)
    : nextCoordinates();

  const mutation: LooMutationAttributes = {
    ...withoutLocation,
    location: locationValue,
  };

  if (mutation.name === undefined) {
    mutation.name = `Integration Loo ${coordinateCounter}`;
  }
  if (mutation.active === undefined) {
    mutation.active = true;
  }
  if (mutation.accessible === undefined) {
    mutation.accessible = true;
  }

  await service.create(id, mutation, contributor);
  const record = await service.getById(id);

  if (!record) {
    throw new Error('Failed to load loo fixture after creation');
  }

  return record;
};

export const getLooById = async (id: string): Promise<toilets | null> => {
  const prisma = getPrisma();
  return prisma.toilets.findUnique({ where: { id } });
};

export const upsertLooFixture = async (
  id: string,
  data: LooMutationAttributes,
  contributor: string,
): Promise<LooResponse> => {
  const service = getLooService();
  await service.upsert(id, data, contributor);
  const record = await service.getById(id);

  if (!record) {
    throw new Error('Failed to load loo fixture after upsert');
  }

  return record;
};
