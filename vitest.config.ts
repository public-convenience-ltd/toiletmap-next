import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    maxWorkers: 1,
    setupFiles: ['./test/integration/setup.ts'],
    sequence: {
      concurrent: false,
    },
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
});
