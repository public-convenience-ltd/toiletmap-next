import { Hono } from 'hono';
import { validate } from '../../common/validator';
import { Prisma } from '../../generated/prisma-client';
import { AppVariables } from '../../types';
import { requireAuth } from '../../middleware/require-auth';
import {
  handleRoute,
  badRequest,
  notFound,
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
import type { LooSearchParams } from '../../services/loo/types';

import {
  baseMutationSchema,
  createMutationSchema,
  proximitySchema,
  searchQuerySchema,
} from './schemas';

const loosRouter = new Hono<{ Variables: AppVariables }>();

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
loosRouter.get(
  '/proximity',
  validate('query', proximitySchema, 'Invalid proximity query'),
  (c) =>
    handleRoute(c, 'loos.proximity', async () => {
      const { lat, lng, radius } = c.req.valid('query');
      const loos = await looService.getByProximity(lat, lng, radius);

      return c.json({ data: loos, count: loos.length });
    }),
);

/** GET /loos/search */
loosRouter.get(
  '/search',
  validate('query', searchQuerySchema, 'Invalid search query'),
  (c) =>
    handleRoute(c, 'loos.search', async () => {
      const params = c.req.valid('query') as LooSearchParams;
      const { data, total } = await looService.search(params);

      const offset = (params.page - 1) * params.limit;
      const hasMore = offset + data.length < total;

      return c.json({
        data,
        count: data.length,
        total,
        page: params.page,
        pageSize: params.limit,
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
    const ids = parseIds(
      c.req.queries('ids') ?? (c.req.query('ids') ? [c.req.query('ids')!] : []),
    );
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
loosRouter.post(
  '/',
  requireAuth,
  validate('json', createMutationSchema, 'Invalid create request body'),
  (c) =>
    handleRoute(c, 'loos.create', async () => {
      const validation = c.req.valid('json');
      const contributor = extractContributor(c.get('user'));
      const { id: requestedId, ...rest } = validation;
      const id = requestedId ?? generateLooId();

      if (id.length !== LOO_ID_LENGTH)
        return badRequest(c, `id must be exactly ${LOO_ID_LENGTH} characters`);

      const existing = await looService.getById(id);
      if (existing)
        return c.json({ message: `Loo with id ${id} already exists` }, 409);

      const created = await looService.create(id, rest, contributor);
      if (!created) throw new Error(`Failed to reload loo ${id} after creation`);
      return c.json(created, 201);
    }),
);

/** PUT /loos/:id */
loosRouter.put(
  '/:id',
  requireAuth,
  validate('json', baseMutationSchema, 'Invalid upsert request body'),
  (c) =>
    handleRoute(c, 'loos.upsert', async () => {
      const chk = requireIdParam(c.req.param('id'));
      if (!chk.ok) return badRequest(c, chk.error);

      const validation = c.req.valid('json');
      const contributor = extractContributor(c.get('user'));
      const existing = await looService.getById(chk.id);
      const saved = await looService.upsert(chk.id, validation, contributor);
      if (!saved) throw new Error(`Failed to reload loo ${chk.id} after upsert`);

      return c.json(saved, existing ? 200 : 201);
    }),
);



export { loosRouter };
