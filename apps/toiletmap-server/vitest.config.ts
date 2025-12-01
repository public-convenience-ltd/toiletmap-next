import { defineConfig } from "vitest/config";

export default defineConfig({
  assetsInclude: ["**/*.wasm", "**/*.wasm?*"],
  test: {
    globals: true,
    environment: "node",
    env: {
      NODE_ENV: "test",
    },
    maxWorkers: 1,
    include: ["test/**/*.spec.ts", "test/**/*.test.ts"],
    setupFiles: ["./test/integration/setup.ts"],
    sequence: {
      concurrent: false,
    },
    exclude: ["dist/**", "node_modules/**"],
  },
});
