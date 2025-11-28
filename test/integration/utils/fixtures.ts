import { randomBytes } from 'node:crypto';
import type {
  Coordinates,
  LooMutationAttributes,
  LooResponse,
} from '../../../src/services/loo/types';
import type { areas, toilets } from '../../../src/prisma';
import type { PrismaClientInstance } from '../../../src/prisma';
import { LooService } from '../../../src/services/loo';
import { getPrismaClient } from '../setup';
import { cleanupManager } from './cleanup';

type PrismaProvider = () => PrismaClientInstance;

const deterministicAreaId = (counter: number) =>
  counter.toString(16).padStart(24, '0').slice(-24);

const generateLooId = () => randomBytes(12).toString('hex');

class CoordinateSequence {
  #counter = 0;

  next(): Coordinates {
    this.#counter += 1;
    return {
      lat: 51.5 + this.#counter * 0.001,
      lng: -0.12 - this.#counter * 0.001,
    };
  }
}

type AreaFixtureOverrides = {
  id?: string;
  name?: string | null;
  type?: string | null;
  priority?: number | null;
  datasetId?: number | null;
  version?: number | null;
};

class AreaFixtures {
  #counter = 0;

  constructor(private readonly getPrisma: PrismaProvider) { }

  async create(overrides: AreaFixtureOverrides = {}): Promise<areas> {
    const prisma = this.getPrisma();
    this.#counter += 1;
    const area = await prisma.areas.create({
      data: {
        id: overrides.id ?? deterministicAreaId(this.#counter),
        name: overrides.name ?? `Area ${this.#counter}`,
        type: overrides.type ?? 'borough',
        priority: overrides.priority ?? this.#counter,
        dataset_id: overrides.datasetId ?? 1,
        version: overrides.version ?? 1,
      },
    });
    return area;
  }
}

type LooFixtureOverrides = LooMutationAttributes & {
  id?: string;
  contributor?: string | null;
};

class LooFixtures {
  private readonly coordinates = new CoordinateSequence();
  private service: LooService | null = null;

  constructor(private readonly getPrisma: PrismaProvider) { }

  private getService() {
    if (!this.service) {
      this.service = new LooService(this.getPrisma());
    }
    return this.service;
  }

  private withDefaults(
    overrides: LooFixtureOverrides = {},
  ): {
    id: string;
    contributor: string | null;
    mutation: LooMutationAttributes;
  } {
    const { id = generateLooId(), contributor = 'integration-fixture', ...rest } =
      overrides;

    const hasCustomLocation = Object.prototype.hasOwnProperty.call(
      overrides,
      'location',
    );
    const locationValue = hasCustomLocation
      ? rest.location ?? null
      : this.coordinates.next();

    const mutation: LooMutationAttributes = {
      ...rest,
      location: locationValue,
    };

    if (mutation.name === undefined) {
      mutation.name = `Integration Loo ${randomBytes(3).toString('hex')}`;
    }
    if (mutation.active === undefined) {
      mutation.active = true;
    }
    if (mutation.accessible === undefined) {
      mutation.accessible = true;
    }

    return { id, contributor, mutation };
  }

  async create(overrides: LooFixtureOverrides = {}): Promise<LooResponse> {
    const { id, contributor, mutation } = this.withDefaults(overrides);
    const service = this.getService();
    await service.create(id, mutation, contributor);
    const record = await service.getById(id);
    if (!record) {
      throw new Error('Failed to load loo fixture after creation');
    }
    cleanupManager.trackLoo(record.id);
    return record;
  }

  async upsert(
    id: string,
    data: LooMutationAttributes,
    contributor: string,
  ): Promise<LooResponse> {
    const service = this.getService();
    await service.upsert(id, data, contributor);
    const record = await service.getById(id);
    if (!record) {
      throw new Error('Failed to load loo fixture after upsert');
    }
    cleanupManager.trackLoo(record.id);
    return record;
  }

  async getRawById(id: string): Promise<toilets | null> {
    const prisma = this.getPrisma();
    return prisma.toilets.findUnique({ where: { id } });
  }
}

class FixtureFactory {
  readonly areas: AreaFixtures;
  readonly loos: LooFixtures;
  private prismaInstance: PrismaClientInstance | null = null;
  private readonly prismaProvider: PrismaProvider;

  constructor(
    prismaOrProvider: PrismaClientInstance | PrismaProvider = getPrismaClient,
  ) {
    if (typeof prismaOrProvider === 'function') {
      const provider = prismaOrProvider as PrismaProvider;
      this.prismaProvider = () => {
        if (!this.prismaInstance) {
          this.prismaInstance = provider();
        }
        return this.prismaInstance;
      };
    } else {
      this.prismaInstance = prismaOrProvider;
      this.prismaProvider = () => prismaOrProvider;
    }

    this.areas = new AreaFixtures(this.prismaProvider);
    this.loos = new LooFixtures(this.prismaProvider);
  }
}

export const createFixtureFactory = () => new FixtureFactory();
