import { Hono } from 'hono';
import { swaggerUI } from '@hono/swagger-ui';
import { AppVariables } from './types';
import { loosRouter } from './routes/loos';
import { areasRouter } from './routes/areas';
import { openApiDocument } from './docs/openapi';
import { validateRequiredEnvVars } from './utils/env-utils';

export const createApp = () => {
  // Validate required environment variables at startup
  validateRequiredEnvVars();

  const app = new Hono<{ Variables: AppVariables }>();

  app.get('/', (c) =>
    c.json({
      status: 'ok',
      service: 'toiletmap-hono-api',
      uptime: process.uptime(),
    }),
  );

  app.route('/loos', loosRouter);
  app.route('/areas', areasRouter);
  app.get('/docs/openapi.json', (c) => c.json(openApiDocument));
  app.get('/docs', swaggerUI({ url: '/docs/openapi.json' }));

  app.notFound((c) =>
    c.json(
      {
        message: 'Route not found',
      },
      404,
    ),
  );

  app.onError((err, c) => {
    console.error('Unhandled error', err);
    return c.json({ message: 'Internal Server Error' }, 500);
  });

  return app;
};
