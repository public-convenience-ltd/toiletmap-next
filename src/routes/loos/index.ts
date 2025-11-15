import { Hono } from 'hono';
import { Prisma } from '../../generated/prisma/client';
import { AppVariables } from '../../types';
import { requireAuth } from '../../middleware/require-auth';
import {
  handleRoute,
  badRequest,
  notFound,
  parseJsonBody,
  AppContext,
} from '../shared/route-helpers';
import { parseIds } from '../shared/query';
import { requireIdParam } from '../shared/params';
import {
  LOO_ID_LENGTH,
  extractContributor,
  generateLooId,
  looService,
  parseActiveFlag,
} from '../../services/loo';

import {
  baseMutationSchema,
  createMutationSchema,
  proximitySchema,
  searchQuerySchema,
} from './schemas';

const loosRouter = new Hono<{ Variables: AppVariables }>();

// Support both comma-separated and repeated `ids` query parameters (unchanged helper)
const parseIdsFromContext = (c: AppContext) =>
  parseIds(
    c.req.queries('ids') ?? (c.req.query('ids') ? [c.req.query('ids')!] : []),
  );

/** GET /loos/geohash/:geohash */
loosRouter.get('/geohash/:geohash', (c) =>
  handleRoute(c, 'loos.geohash', async () => {
    const geohash = c.req.param('geohash');
    if (!geohash) return badRequest(c, 'geohash path parameter is required');

    const activeFlag = parseActiveFlag(c.req.query('active'));
    const loos = await looService.getWithinGeohash(geohash, activeFlag);

    return c.json({ data: loos, count: loos.length });
  }),
);

/** GET /loos/proximity */
loosRouter.get('/proximity', (c) =>
  handleRoute(c, 'loos.proximity', async () => {
    const validation = proximitySchema.safeParse({
      lat: c.req.query('lat'),
      lng: c.req.query('lng'),
      radius: c.req.query('radius'),
    });
    if (!validation.success)
      return badRequest(
        c,
        'Invalid proximity query',
        validation.error.format(),
      );

    const { lat, lng, radius } = validation.data;
    const loos = await looService.getByProximity(lat, lng, radius);

    return c.json({ data: loos, count: loos.length });
  }),
);

/** GET /loos/search */
loosRouter.get('/search', (c) =>
  handleRoute(c, 'loos.search', async () => {
    const validation = searchQuerySchema.safeParse({
      search: c.req.query('search'),
      areaName: c.req.query('areaName'),
      areaType: c.req.query('areaType'),
      active: c.req.query('active'),
      accessible: c.req.query('accessible'),
      allGender: c.req.query('allGender'),
      radar: c.req.query('radar'),
      babyChange: c.req.query('babyChange'),
      noPayment: c.req.query('noPayment'),
      verified: c.req.query('verified'),
      hasLocation: c.req.query('hasLocation'),
      sort: c.req.query('sort'),
      limit: c.req.query('limit'),
      page: c.req.query('page'),
    });
    if (!validation.success)
      return badRequest(
        c,
        'Invalid search query',
        validation.error.format(),
      );

    const filters = validation.data;
    const { data, total } = await looService.search({
      search: filters.search,
      areaName: filters.areaName,
      areaType: filters.areaType,
      active: filters.active,
      accessible: filters.accessible,
      allGender: filters.allGender,
      radar: filters.radar,
      babyChange: filters.babyChange,
      noPayment: filters.noPayment,
      verified: filters.verified,
      hasLocation: filters.hasLocation,
      sort: filters.sort,
      limit: filters.limit,
      page: filters.page,
    });

    const offset = (filters.page - 1) * filters.limit;
    const hasMore = offset + data.length < total;

    return c.json({
      data,
      count: data.length,
      total,
      page: filters.page,
      pageSize: filters.limit,
      hasMore,
    });
  }),
);

/** GET /loos/:id/reports */
loosRouter.get('/:id/reports', (c) =>
  handleRoute(c, 'loos.reports', async () => {
    const chk = requireIdParam(c.req.param('id'));
    if (!chk.ok) return badRequest(c, chk.error);

    const hydrate =
      (c.req.query('hydrate') ?? '').toLowerCase() === 'true';
    const reports = await looService.getReports(
      chk.id,
      hydrate ? { hydrate: true } : undefined,
    );
    return c.json({ data: reports, count: reports.length });
  }),
);

/** GET /loos/:id */
loosRouter.get('/:id', (c) =>
  handleRoute(c, 'loos.detail', async () => {
    const chk = requireIdParam(c.req.param('id'));
    if (!chk.ok) return badRequest(c, chk.error);

    const dto = await looService.getById(chk.id);
    if (!dto) return notFound(c, 'Loo not found');

    return c.json(dto);
  }),
);

/** GET /loos?ids= */
loosRouter.get('/', (c) =>
  handleRoute(c, 'loos.byIds', async () => {
    const ids = parseIdsFromContext(c);
    if (ids.length === 0) {
      return badRequest(
        c,
        'Provide ids query parameter (comma separated or repeated) to fetch loos',
      );
    }
    const loos = await looService.getByIds(ids);
    return c.json({ data: loos, count: loos.length });
  }),
);

/** POST /loos */
loosRouter.post('/', requireAuth, (c) =>
  handleRoute(c, 'loos.create', async () => {
    const body = await parseJsonBody(c); // keep your existing tolerant body read
    const validation = createMutationSchema.safeParse(body);
    if (!validation.success)
      return badRequest(
        c,
        'Invalid create request body',
        validation.error.format(),
      );

    const contributor = extractContributor(c.get('user'));
    const { id: requestedId, ...rest } = validation.data;
    const id = requestedId ?? generateLooId();

    if (id.length !== LOO_ID_LENGTH)
      return badRequest(c, `id must be exactly ${LOO_ID_LENGTH} characters`);

    const existing = await looService.getById(id);
    if (existing)
      return c.json({ message: `Loo with id ${id} already exists` }, 409);

    const created = await looService.create(
      id,
      rest,
      contributor,
    );
    if (!created) throw new Error(`Failed to reload loo ${id} after creation`);
    return c.json(created, 201);
  }),
);

/** PUT /loos/:id */
loosRouter.put('/:id', requireAuth, (c) =>
  handleRoute(c, 'loos.upsert', async () => {
    const chk = requireIdParam(c.req.param('id'));
    if (!chk.ok) return badRequest(c, chk.error);

    const body = await parseJsonBody(c);
    const validation = baseMutationSchema.safeParse(body);
    if (!validation.success)
      return badRequest(
        c,
        'Invalid upsert request body',
        validation.error.format(),
      );

    const contributor = extractContributor(c.get('user'));
    const existing = await looService.getById(chk.id);
    const saved = await looService.upsert(
      chk.id,
      validation.data,
      contributor,
    );
    if (!saved) throw new Error(`Failed to reload loo ${chk.id} after upsert`);

    return c.json(saved, existing ? 200 : 201);
  }),
);

/** DELETE /loos/:id */
loosRouter.delete('/:id', requireAuth, (c) =>
  handleRoute(c, 'loos.delete', async () => {
    const chk = requireIdParam(c.req.param('id'));
    if (!chk.ok) return badRequest(c, chk.error);

    try {
      await looService.deleteById(chk.id);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        return notFound(c, 'Loo not found');
      }
      throw error;
    }

    return c.body(null, 204);
  }),
);

export { loosRouter };
