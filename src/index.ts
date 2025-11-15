import { serve } from '@hono/node-server';
import { env } from './env';
import { createApp } from './app';

const app = createApp();

serve(
  {
    fetch: app.fetch,
    port: env.port,
  },
  (info) => {
    console.log(
      `🚽 hono-api listening on http://localhost:${info.port} (pid: ${process.pid})`,
    );
  },
);
