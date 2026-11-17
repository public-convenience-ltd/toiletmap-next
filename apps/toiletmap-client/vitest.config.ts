import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "preact",
    },
  },
  resolve: {
    alias: {
      // Only the built worker (dist/, imported by render.test.ts) needs this.
      "cloudflare:workers": fileURLToPath(
        new URL("./src/test/cloudflare-workers.stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "happy-dom",
    // Unit and component tests only. Playwright specs live in e2e/ and run separately.
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
