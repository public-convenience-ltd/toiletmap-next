import { Hono } from 'hono';
import { AppVariables } from '../../types';
import { handleRoute } from '../shared/route-helpers';
import { listAreas } from '../../services/area.service';
import { createPrismaClient } from '../../prisma';

export const areasRouter = new Hono<{ Variables: AppVariables }>();

areasRouter.get('/', (c) =>
  handleRoute(c, 'areas.list', async () => {
    const areas = await listAreas(createPrismaClient());
    return c.json({
      data: areas,
      count: areas.length,
    });
  }),
);
