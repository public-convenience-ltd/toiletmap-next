import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests for the client (see e2e/README.md).
 *
 * Runs against the real local stack:
 *   - local Supabase Postgres on :54322 (must already be running; never started here),
 *   - the server's mock Auth0 on :44555 (`pnpm --filter toiletmap-server auth:server`),
 *   - toiletmap-server via wrangler dev on :8787 (`pnpm --filter toiletmap-server dev:server`,
 *     after building its admin UI into public/admin, which wrangler serves as assets),
 *   - this client via `astro dev` on :4321, configured by e2e/wrangler.e2e.jsonc.
 */

const isCI = !!process.env.CI;
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// One id for the whole run, inherited by every worker process.
process.env.E2E_RUN_ID ??= Date.now().toString(36);

/**
 * Web server output (timestamped, see e2e/support/log-web-server.ts) and
 * wrangler's own debug logs end up here; CI uploads the folder with the report.
 */
const LOG_DIR = fileURLToPath(new URL("./e2e/.logs", import.meta.url));
const LOG_WRAPPER = fileURLToPath(new URL("./e2e/support/log-web-server.ts", import.meta.url));
const logged = (name: string, command: string) =>
  `node ${JSON.stringify(LOG_WRAPPER)} ${JSON.stringify(`${LOG_DIR}/${name}.log`)} ${command}`;

const CLIENT_URL = process.env.E2E_CLIENT_URL ?? "http://localhost:4321";
const SERVER_URL = process.env.E2E_SERVER_URL ?? "http://localhost:8787";
const AUTH_URL = process.env.E2E_AUTH_URL ?? "http://127.0.0.1:44555";

/**
 * wrangler dev on its own (not `pnpm --filter toiletmap-server dev`, whose
 * `concurrently` outlives a crashed wrangler), so that when wrangler exits the
 * log wrapper sees it and restarts it. The admin UI build takes about a second.
 */
const SERVER_COMMAND = `sh -c ${JSON.stringify(
  "pnpm --filter toiletmap-server build:client && exec pnpm --filter toiletmap-server dev:server",
)}`;

/** Specs that also run on the phone-sized projects. */
const MOBILE_SPECS = [
  "map.spec.ts",
  "edit.spec.ts",
  "layout.spec.ts",
  "freshness.spec.ts",
  "picker.spec.ts",
  "report.spec.ts",
  "panel.spec.ts",
];

/** Specs that also run on a phone in landscape. */
const LANDSCAPE_SPECS = ["panel.spec.ts", "layout.spec.ts"];

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // astro dev + wrangler dev are single processes; more workers mostly add contention.
  workers: isCI ? 2 : 4,
  timeout: 45_000,
  // Ends the run (and writes the report) before the CI job's 30-minute timeout kills it.
  globalTimeout: isCI ? 20 * 60_000 : undefined,
  expect: { timeout: 10_000 },
  reporter: isCI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: CLIENT_URL,
    trace: isCI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
      testMatch: MOBILE_SPECS,
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 13"] },
      testMatch: MOBILE_SPECS,
    },
    {
      // A phone on its side: ≥768px wide but only 360px tall, so the panel is the card
      // (scrolling as a whole) and the map is a short strip.
      name: "mobile-landscape",
      use: { ...devices["Pixel 7 landscape"] },
      testMatch: LANDSCAPE_SPECS,
    },
  ],
  // Started in order: the server before the client, so wrangler gets the
  // default inspector port (9229) and the client's Cloudflare Vite plugin falls
  // back to another. Each command's stdout + stderr is written to
  // e2e/.logs/<name>.log (stderr is also shown), and a command that exits
  // mid-run is restarted (up to 5 times, see e2e/support/log-web-server.ts);
  // reused servers (local runs only) are neither logged nor restarted.
  webServer: [
    {
      // Separate from wrangler: it generates new signing keys on every start,
      // so it must not be restarted along with wrangler.
      name: "auth",
      command: logged("auth", "pnpm --filter toiletmap-server auth:server"),
      cwd: repoRoot,
      url: `${AUTH_URL}/.well-known/jwks.json`,
      reuseExistingServer: !isCI,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      name: "server",
      command: logged("server", SERVER_COMMAND),
      cwd: repoRoot,
      url: `${SERVER_URL}/`,
      reuseExistingServer: !isCI,
      timeout: 180_000,
      stdout: "ignore",
      stderr: "pipe",
      env: { WRANGLER_LOG_PATH: `${LOG_DIR}/wrangler` },
    },
    {
      name: "client",
      command: logged("client", "pnpm exec astro dev --port 4321"),
      url: `${CLIENT_URL}/`,
      reuseExistingServer: !isCI,
      timeout: 180_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        WRANGLER_LOG_PATH: `${LOG_DIR}/wrangler`,
        // Use the e2e-only wrangler config instead of wrangler.jsonc + .dev.vars.
        CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: "e2e/wrangler.e2e.jsonc",
        // Astro 7 backgrounds `astro dev` when it detects an AI agent environment;
        // this marks the process as the dev server itself so it stays in the
        // foreground where Playwright can wait on and stop it.
        ASTRO_DEV_BACKGROUND: "1",
        // Astro's dev toolbar would cover the bottom of the screen (the details sheet).
        ASTRO_DEV_TOOLBAR: "off",
      },
    },
  ],
});
