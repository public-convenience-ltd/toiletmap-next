import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// export default defineConfig({
//   resolve: {
//     extensions: ['.ts', '.js', '.mjs', '.jsx', '.tsx', '.json'],
//   },
//   assetsInclude: ['**/*.wasm', '**/*.wasm?module'],
//   server: {
//     fs: {
//       allow: ['..'],
//     },
//   },
//   optimizeDeps: {
//     exclude: ['@prisma/client', '@prisma/adapter-pg'],
//   },
//   test: {
//     environment: 'node',
//     include: ['tests/e2e/**/*.test.ts'],
//     globalSetup: 'tests/e2e/global-setup.ts',
//     setupFiles: ['tests/e2e/setup.ts'],
//     testTimeout: 120_000,
//     hookTimeout: 120_000,
//     globals: true,
//     reporters: 'default',
//     minThreads: 1,
//     maxThreads: 1,
//   },
// });



export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
});