import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  resolve: {
    extensions: ['.ts', '.js', '.mjs', '.jsx', '.tsx', '.json'],
  },
  assetsInclude: ['**/*.wasm', '**/*.wasm?module'],
  server: {
    fs: {
      allow: ['..'],
    },
  },
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
});