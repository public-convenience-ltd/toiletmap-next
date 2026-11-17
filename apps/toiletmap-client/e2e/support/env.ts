/** URLs of the local stack the e2e suite runs against. Override via env for unusual setups. */
export const CLIENT_URL = process.env.E2E_CLIENT_URL ?? "http://localhost:4321";
export const SERVER_URL = process.env.E2E_SERVER_URL ?? "http://localhost:8787";
/** Mock Auth0 server (scripts/start-auth-server.ts): started by Playwright, or by `pnpm --filter toiletmap-server dev`. */
export const AUTH_URL = process.env.E2E_AUTH_URL ?? "http://127.0.0.1:44555";
/** Must match AUTH0_AUDIENCE of the server (wrangler.jsonc vars) and e2e/wrangler.e2e.jsonc. */
export const AUTH_AUDIENCE = "https://toiletmap.org.uk";

/** Unique per Playwright run, so leftover rows from aborted runs are easy to spot. */
export const RUN_ID = process.env.E2E_RUN_ID ?? Date.now().toString(36);
