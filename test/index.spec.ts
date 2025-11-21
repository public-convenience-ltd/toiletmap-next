import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

const {
  mockPrisma,
  createPrismaClientMock,
  LooServiceMock,
  resetLooServiceBehavior,
  overrideLooServiceBehavior,
  clearLooServiceInstances,
  getLastLooServiceInstance,
  mockGenerateLooId,
  profileKey,
  authedUser,
  validAuthHeader,
} = vi.hoisted(() => {
  const mockPrisma = {
    areas: {
      findMany: vi.fn(),
    },
  };

  type Behavior = {
    getWithinGeohash: (geohash: string, active: boolean | null) => Promise<any[]>;
    getByProximity: (lat: number, lng: number, radius: number) => Promise<any[]>;
    search: (params: Record<string, unknown>) => Promise<{ data: any[]; total: number }>;
    getReports: (id: string, options?: { hydrate: true }) => Promise<any[]>;
    getById: (id: string) => Promise<any | null>;
    getByIds: (ids: string[]) => Promise<any[]>;
    create: (id: string, payload: Record<string, unknown>, contributor: string | null) => Promise<any>;
    upsert: (id: string, payload: Record<string, unknown>, contributor: string | null) => Promise<any>;
  };

  const createDefaults = (): Behavior => ({
    getWithinGeohash: async () => [],
    getByProximity: async () => [],
    search: async () => ({ data: [], total: 0 }),
    getReports: async () => [],
    getById: async () => null,
    getByIds: async () => [],
    create: async (id, payload) => ({ id, ...payload }),
    upsert: async (id, payload) => ({ id, ...payload }),
  });

  const behavior = createDefaults();

  const resetBehavior = () => {
    Object.assign(behavior, createDefaults());
  };

  const overrideBehavior = (overrides: Partial<Behavior>) => {
    Object.assign(behavior, overrides);
  };

  type LooServiceStub = {
    getWithinGeohash: ReturnType<typeof vi.fn>;
    getByProximity: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    getReports: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
    getByIds: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };

  const createStub = (): LooServiceStub => ({
    getWithinGeohash: vi.fn((...args: Parameters<Behavior['getWithinGeohash']>) =>
      behavior.getWithinGeohash(...args),
    ),
    getByProximity: vi.fn((...args: Parameters<Behavior['getByProximity']>) =>
      behavior.getByProximity(...args),
    ),
    search: vi.fn((...args: Parameters<Behavior['search']>) =>
      behavior.search(...args),
    ),
    getReports: vi.fn((...args: Parameters<Behavior['getReports']>) =>
      behavior.getReports(...args),
    ),
    getById: vi.fn((...args: Parameters<Behavior['getById']>) =>
      behavior.getById(...args),
    ),
    getByIds: vi.fn((...args: Parameters<Behavior['getByIds']>) =>
      behavior.getByIds(...args),
    ),
    create: vi.fn((...args: Parameters<Behavior['create']>) =>
      behavior.create(...args),
    ),
    upsert: vi.fn((...args: Parameters<Behavior['upsert']>) =>
      behavior.upsert(...args),
    ),
  });

  const instances: LooServiceStub[] = [];

  const LooServiceMock = vi.fn(() => {
    const stub = createStub();
    instances.push(stub);
    return stub;
  });

  const clearInstances = () => {
    instances.length = 0;
  };

  const getLastInstance = () => {
    const instance = instances.at(-1);
    if (!instance) {
      throw new Error('LooService was not instantiated');
    }
    return instance;
  };

  const createPrismaClientMock = vi.fn(() => mockPrisma);

  const mockGenerateLooId = vi.fn(() => '123456789012345678901234');

  const profileKey = 'https://example.com/profile';

  const authedUser = {
    sub: 'auth0|unit-test',
    nickname: 'Unit Tester',
    name: 'Unit Tester',
    [profileKey]: {
      nickname: 'cf-worker',
    },
  };

  const validAuthHeader = 'Bearer valid-token';

  return {
    mockPrisma,
    createPrismaClientMock,
    LooServiceMock,
    resetLooServiceBehavior: resetBehavior,
    overrideLooServiceBehavior: overrideBehavior,
    clearLooServiceInstances: clearInstances,
    getLastLooServiceInstance: getLastInstance,
    mockGenerateLooId,
    profileKey,
    authedUser,
    validAuthHeader,
  };
});

vi.mock('../src/prisma', () => ({
  createPrismaClient: createPrismaClientMock,
}));

vi.mock('../src/services/loo', () => ({
  LooService: LooServiceMock,
  LOO_ID_LENGTH: 24,
  generateLooId: mockGenerateLooId,
}));

vi.mock('../src/middleware/require-auth', () => ({
  requireAuth: async (c: any, next: () => Promise<Response>) => {
    const header = c.req.header('authorization') ?? c.req.header('Authorization');
    if (header !== validAuthHeader) {
      return c.json({ message: 'Unauthorized' }, 401);
    }
    c.set('user', authedUser);
    return next();
  },
}));

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const baseUrl = 'https://example.com';

const callWorker = async (path: string, init?: RequestInit) => {
  const request = new IncomingRequest(`${baseUrl}${path}`, init);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
};

const jsonInit = (
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): RequestInit => ({
  method,
  headers: {
    'Content-Type': 'application/json',
    ...headers,
  },
  body: JSON.stringify(body),
});

const makeId = (char: string) => char.repeat(24);
const sampleLoo = {
  id: makeId('a'),
  name: 'Central Station Loo',
  area: [],
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z',
  reports: [],
};
const anotherLoo = {
  id: makeId('b'),
  name: 'Riverside Loo',
  area: [],
  createdAt: '2025-02-10T00:00:00.000Z',
  updatedAt: '2025-02-12T00:00:00.000Z',
  reports: [],
};
const sampleReport = {
  id: 'report-1',
  contributor: 'cf-worker',
  createdAt: '2025-03-01T00:00:00.000Z',
  verifiedAt: null,
  isSystemReport: false,
  diff: null,
};

describe('API routes', () => {
  beforeEach(() => {
    env.POSTGRES_URI = 'postgres://unit:test@localhost:5432/postgres';
    env.AUTH0_AUDIENCE = 'https://tests.local/api';
    env.AUTH0_ISSUER_BASE_URL = 'https://issuer.example/';
    env.AUTH0_PROFILE_KEY = profileKey;
    createPrismaClientMock.mockClear();
    mockPrisma.areas.findMany.mockReset();
    LooServiceMock.mockClear();
    mockGenerateLooId.mockClear();
    clearLooServiceInstances();
    resetLooServiceBehavior();
  });

  describe('service + docs', () => {
    it('returns health information on the root route', async () => {
      const response = await callWorker('/');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      const body = await response.json();
      expect(body.status).toBe('ok');
      expect(body.service).toBe('toiletmap-hono-api');
      expect(new Date(body.timestamp).toString()).not.toBe('Invalid Date');
    });

    it('serves the OpenAPI document', async () => {
      const response = await callWorker('/docs/openapi.json');
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.openapi).toBeDefined();
      expect(body.info?.title).toBeTruthy();
    });

    it('renders Swagger UI HTML', async () => {
      const response = await callWorker('/docs');
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('SwaggerUI');
    });

    it('returns a consistent 404 payload for unknown routes', async () => {
      const response = await callWorker('/missing');
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: 'Route not found' });
    });
  });

  describe('areas', () => {
    it('returns the list of areas', async () => {
      const areas = [
        { name: 'Hackney', type: 'borough' },
        { name: 'Camden', type: 'borough' },
      ];
      mockPrisma.areas.findMany.mockResolvedValueOnce(areas);

      const response = await callWorker('/areas');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: areas, count: areas.length });
      expect(createPrismaClientMock).toHaveBeenCalledWith(env.POSTGRES_URI);
      expect(mockPrisma.areas.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('loo reads', () => {
    it('returns loos for a geohash prefix', async () => {
      overrideLooServiceBehavior({
        getWithinGeohash: async () => [sampleLoo],
      });
      const response = await callWorker('/loos/geohash/u10jz');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: [sampleLoo], count: 1 });

      const service = getLastLooServiceInstance();
      expect(service.getWithinGeohash).toHaveBeenCalledWith('u10jz', true);
    });

    it('allows overriding active filtering via query param', async () => {
      overrideLooServiceBehavior({
        getWithinGeohash: async () => [sampleLoo, anotherLoo],
      });
      const response = await callWorker('/loos/geohash/u10jz?active=any');
      expect(response.status).toBe(200);
      await response.json();
      const service = getLastLooServiceInstance();
      expect(service.getWithinGeohash).toHaveBeenCalledWith('u10jz', null);
    });

    it('fetches loos by proximity when query validates', async () => {
      overrideLooServiceBehavior({
        getByProximity: async () => [sampleLoo, anotherLoo],
      });
      const response = await callWorker('/loos/proximity?lat=51.5&lng=-0.12&radius=750');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        data: [sampleLoo, anotherLoo],
        count: 2,
      });
      const service = getLastLooServiceInstance();
      expect(service.getByProximity).toHaveBeenCalledWith(51.5, -0.12, 750);
    });

    it('rejects invalid proximity queries', async () => {
      const response = await callWorker('/loos/proximity?lat=abc&lng=-0.12');
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.message).toBe('Invalid proximity query');
      expect(LooServiceMock).not.toHaveBeenCalled();
    });

    it('searches loos with pagination metadata', async () => {
      overrideLooServiceBehavior({
        search: async () => ({ data: [sampleLoo, anotherLoo], total: 5 }),
      });
      const response = await callWorker('/loos/search?search=park&limit=2&page=2&sort=updated-desc');
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        data: [sampleLoo, anotherLoo],
        count: 2,
        total: 5,
        page: 2,
        pageSize: 2,
        hasMore: true,
      });
      const service = getLastLooServiceInstance();
      expect(service.search).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'park', limit: 2, page: 2, sort: 'updated-desc' }),
      );
    });

    it('returns reports with optional hydration', async () => {
      overrideLooServiceBehavior({
        getReports: async () => [sampleReport],
      });
      const response = await callWorker(`/loos/${sampleLoo.id}/reports?hydrate=true`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: [sampleReport], count: 1 });
      const service = getLastLooServiceInstance();
      expect(service.getReports).toHaveBeenCalledWith(sampleLoo.id, { hydrate: true });
    });

    it('defaults report hydration to undefined when not requested', async () => {
      overrideLooServiceBehavior({
        getReports: async () => [],
      });
      const response = await callWorker(`/loos/${sampleLoo.id}/reports`);
      expect(response.status).toBe(200);
      await response.json();
      const service = getLastLooServiceInstance();
      expect(service.getReports).toHaveBeenCalledWith(sampleLoo.id, undefined);
    });

    it('returns full loo details by id', async () => {
      overrideLooServiceBehavior({
        getById: async () => sampleLoo,
      });
      const response = await callWorker(`/loos/${sampleLoo.id}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(sampleLoo);
    });

    it('validates loo id length for detail route', async () => {
      const response = await callWorker('/loos/too-short');
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.message).toContain('id must be exactly 24 characters');
    });

    it('returns 404 when loo is missing', async () => {
      overrideLooServiceBehavior({
        getById: async () => null,
      });
      const response = await callWorker(`/loos/${sampleLoo.id}`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: 'Loo not found' });
    });

    it('fetches loos by a comma-separated id list', async () => {
      overrideLooServiceBehavior({
        getByIds: async () => [sampleLoo, anotherLoo],
      });
      const response = await callWorker(`/loos?ids=${sampleLoo.id},${anotherLoo.id}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        data: [sampleLoo, anotherLoo],
        count: 2,
      });
      const service = getLastLooServiceInstance();
      expect(service.getByIds).toHaveBeenCalledWith([sampleLoo.id, anotherLoo.id]);
    });

    it('rejects requests that omit ids', async () => {
      const response = await callWorker('/loos');
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.message).toContain('Provide ids query parameter');
    });
  });

  describe('loo mutations', () => {
    const mutationPayload = {
      name: 'Central Station',
      accessible: true,
      active: true,
    };

    it('requires authentication for create requests', async () => {
      const response = await callWorker('/loos', jsonInit('POST', mutationPayload));
      expect(response.status).toBe(401);
      expect(LooServiceMock).not.toHaveBeenCalled();
    });

    it('validates provided ids on create', async () => {
      const response = await callWorker(
        '/loos',
        jsonInit('POST', { ...mutationPayload, id: 'short' }, { Authorization: validAuthHeader }),
      );
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.message).toBe('Invalid create request body');
      expect(body.issues?.id?._errors?.[0]).toContain('24');
    });

    it('prevents creating a duplicate loo', async () => {
      overrideLooServiceBehavior({
        getById: async () => sampleLoo,
      });
      const response = await callWorker(
        '/loos',
        jsonInit('POST', { ...mutationPayload, id: sampleLoo.id }, { Authorization: validAuthHeader }),
      );
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.message).toContain('already exists');
    });

    it('creates a loo with a generated id when none supplied', async () => {
      overrideLooServiceBehavior({
        getById: async () => null,
        create: async (id, payload, contributor) => ({
          ...sampleLoo,
          id,
          name: payload.name,
          contributor,
        }),
      });
      const response = await callWorker(
        '/loos',
        jsonInit('POST', mutationPayload, { Authorization: validAuthHeader }),
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.id).toBe('123456789012345678901234');
      expect(mockGenerateLooId).toHaveBeenCalledTimes(1);
      const service = getLastLooServiceInstance();
      expect(service.create).toHaveBeenCalledWith(
        '123456789012345678901234',
        expect.objectContaining(mutationPayload),
        'cf-worker',
      );
    });

    it('validates loo id for upserts', async () => {
      const response = await callWorker(
        '/loos/not-a-valid-id',
        jsonInit('PUT', mutationPayload, { Authorization: validAuthHeader }),
      );
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.message).toContain('id must be exactly 24 characters');
    });

    it('returns 201 when upsert creates a new loo', async () => {
      overrideLooServiceBehavior({
        getById: async () => null,
        upsert: async (id, payload, contributor) => ({
          ...sampleLoo,
          id,
          name: payload.name,
          contributor,
        }),
      });
      const response = await callWorker(
        `/loos/${anotherLoo.id}`,
        jsonInit('PUT', mutationPayload, { Authorization: validAuthHeader }),
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.id).toBe(anotherLoo.id);
      const service = getLastLooServiceInstance();
      expect(service.upsert).toHaveBeenCalledWith(
        anotherLoo.id,
        expect.objectContaining(mutationPayload),
        'cf-worker',
      );
    });

    it('returns 200 when upsert updates an existing loo', async () => {
      overrideLooServiceBehavior({
        getById: async () => sampleLoo,
        upsert: async (id, payload) => ({
          ...sampleLoo,
          id,
          name: payload.name,
        }),
      });
      const response = await callWorker(
        `/loos/${sampleLoo.id}`,
        jsonInit('PUT', { ...mutationPayload, name: 'Updated Name' }, { Authorization: validAuthHeader }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.name).toBe('Updated Name');
    });
  });
});
