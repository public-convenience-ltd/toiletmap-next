import { Hono } from 'hono';
import { AppVariables, Env } from '../../types';
import { handleRoute } from '../shared/route-helpers';
import { listAreas } from '../../services/area.service';
import { createPrismaClient } from '../../prisma';

export const areasRouter = new Hono<{ Variables: AppVariables; Bindings: Env }>();

areasRouter.get('/', (c) =>
  handleRoute(c, 'areas.list', async () => {
    const areas = await listAreas(createPrismaClient(c.env.POSTGRES_URI));
    return c.json({
      data: areas,
      count: areas.length,
    });
  }),
);
