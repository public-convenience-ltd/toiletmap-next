import { randomBytes } from 'node:crypto';
import type { PrismaClientInstance } from '../../../src/prisma';
import { LooService } from '../../../src/services/loo';
import type {
  Coordinates,
  LooMutationAttributes,
  LooResponse,
} from '../../../src/services/loo/types';

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

export const createAreaFixture = async (
  prisma: PrismaClientInstance,
  overrides: {
    id?: string;
    name?: string | null;
    type?: string | null;
    priority?: number | null;
    datasetId?: number | null;
    version?: number | null;
  } = {},
) => {
  areaCounter += 1;
  const area = await prisma.areas.create({
    data: {
      id: overrides.id ?? deterministicAreaId(areaCounter),
      name: overrides.name ?? `Area ${areaCounter}`,
      type: overrides.type ?? 'borough',
      priority: overrides.priority ?? areaCounter,
      dataset_id: overrides.datasetId ?? 1,
      version: overrides.version ?? 1,
    },
  });
  return area;
};

export type LooFixtureOverrides = LooMutationAttributes & {
  id?: string;
  contributor?: string | null;
};

const generateLooId = () => randomBytes(12).toString('hex');

export const createLooFixture = async (
  prisma: PrismaClientInstance,
  overrides: LooFixtureOverrides = {},
): Promise<LooResponse> => {
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

  const service = new LooService(prisma);
  await service.create(id, mutation, contributor);
  const record = await service.getById(id);
  if (!record) {
    throw new Error('Failed to load loo fixture');
  }
  return record;
};
