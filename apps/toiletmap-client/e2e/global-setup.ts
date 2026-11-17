import { chromium, type FullConfig } from "@playwright/test";
import { checkDatabase, e2eDatabaseUrl, sweepE2eRows } from "./support/db";
import { AUTH_URL, CLIENT_URL, SERVER_URL } from "./support/env";

const fail = (message: string): never => {
  throw new Error(`\n\n[e2e setup] ${message}\n`);
};

/**
 * Runs after Playwright's webServers are up and before any test:
 *  1. fails fast (with instructions) when Supabase, the mock auth server or
 *     the e2e client configuration is missing;
 *  2. removes rows left over by earlier aborted runs (only other runs' rows
 *     older than an hour, see sweepE2eRows);
 *  3. warms up the Vite dev servers so dependency optimisation reloads happen
 *     here rather than in the middle of a test.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  try {
    await checkDatabase();
  } catch (error) {
    fail(
      `Cannot use the local database at ${e2eDatabaseUrl()}: ${
        error instanceof Error ? error.message : String(error)
      }\n` +
        "Start local Supabase first (Docker must be running):\n" +
        "  cd apps/toiletmap-server && pnpm supabase:start\n" +
        "Set E2E_DATABASE_URL to use a different database.",
    );
  }

  try {
    const res = await fetch(`${AUTH_URL}/.well-known/jwks.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    fail(
      `The mock Auth0 server is not reachable at ${AUTH_URL}. Playwright starts it ` +
        "(`pnpm --filter toiletmap-server auth:server`) unless something already answers on " +
        "that URL; the full `pnpm --filter toiletmap-server dev` script starts it too.",
    );
  }

  const login = await fetch(`${CLIENT_URL}/auth/login`, { redirect: "manual" });
  const location = login.headers.get("location") ?? "";
  if (!location.startsWith(`${AUTH_URL}/authorize`)) {
    fail(
      `${CLIENT_URL}/auth/login redirects to "${location || `HTTP ${login.status}`}" instead of ` +
        `the mock auth server. A client dev server that is not using e2e/wrangler.e2e.jsonc ` +
        "is probably already running on :4321 — stop it (`pnpm exec astro dev stop`) and let " +
        "Playwright start its own.",
    );
  }

  const swept = await sweepE2eRows();
  if (swept.loos || swept.pendingChanges) {
    console.log(
      `[e2e setup] removed ${swept.loos} stale e2e toilet(s) and ${swept.pendingChanges} pending change(s)`,
    );
  }

  await warmUp();
}

async function warmUp(): Promise<void> {
  const health = await fetch(`${SERVER_URL}/api/loos/dump`);
  if (!health.ok) fail(`${SERVER_URL}/api/loos/dump returned HTTP ${health.status}`);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL: CLIENT_URL });
    for (const path of ["/", "/loos/add"]) {
      // The first visit can trigger Vite's "optimized dependencies changed. reloading".
      for (let attempt = 0; attempt < 2; attempt++) {
        await page.goto(path, { waitUntil: "load" });
        await page.locator(".leaflet-container").first().waitFor({ timeout: 60_000 });
        await page.waitForTimeout(1_500);
      }
    }
  } finally {
    await browser.close();
  }
}
