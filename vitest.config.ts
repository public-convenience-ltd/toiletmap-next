import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  assetsInclude: ['**/*.wasm'],
  test: {
    maxWorkers: 1,
    setupFiles: ['./test/integration/setup.ts'],
    sequence: {
      concurrent: false,
    },
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ['@prisma/client/runtime/wasm-compiler-edge'],
        },
      },
    },
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
});
