import type { Env } from "../../../src/types";

/** Connection string for the local Supabase stack started by `pnpm supabase:start`. */
export const DEFAULT_TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:54322/postgres";

/**
 * Database URL used by the integration suite.
 * `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TEST_HYPERDRIVE` matches the
 * TEST_HYPERDRIVE binding name, so the same variable works for `wrangler dev`.
 */
export const getTestDatabaseUrl = (): string =>
  process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TEST_HYPERDRIVE ||
  DEFAULT_TEST_DATABASE_URL;

/**
 * Process environment viewed as plain strings.
 *
 * The wrangler-generated `NodeJS.ProcessEnv` narrows some keys to the literal
 * values in `wrangler.jsonc` (e.g. the production Auth0 issuer). Tests need to
 * point those keys at the mock auth server, so they write through this view.
 */
export const testProcessEnv: NodeJS.Dict<string> = process.env;

/**
 * A Hyperdrive binding backed by a plain connection string.
 * The app only reads `connectionString`; `connect()` is never used in Node.
 */
export const createTestHyperdrive = (connectionString = getTestDatabaseUrl()): Hyperdrive => {
  const url = new URL(connectionString);
  return {
    connectionString,
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    connect: () => {
      throw new Error("Hyperdrive.connect() is not available in tests; use connectionString.");
    },
  };
};

const ENVIRONMENTS = ["production", "preview", "development"] as const;
type EnvironmentName = (typeof ENVIRONMENTS)[number];

const isEnvironmentName = (value: string | undefined): value is EnvironmentName =>
  ENVIRONMENTS.some((name) => name === value);

/**
 * `ENVIRONMENT` for the worker under test: the process value when it names an
 * environment, else "development" (the suite stands in for local dev; outside
 * development the worker fails closed without Auth0 Management credentials).
 */
const readEnvironment = (): EnvironmentName => {
  const value = testProcessEnv.ENVIRONMENT;
  return isEnvironmentName(value) ? value : "development";
};

/** Rate limiter binding that always allows the request, like a missing binding would. */
export const allowAllRateLimiter: Env["RATE_LIMIT_READ"] = {
  limit: async () => ({ success: true }),
};

/**
 * Worker bindings for direct `worker.fetch` calls in integration tests.
 *
 * Values are read from `process.env` on every call because `setup.ts` points
 * the Auth0 settings at the mock auth server in `beforeAll`.
 */
export const buildTestEnv = (overrides: Partial<Env> = {}): Env => ({
  TEST_HYPERDRIVE: createTestHyperdrive(),
  HYPERDRIVE: createTestHyperdrive(),
  AUTH0_ISSUER_BASE_URL: testProcessEnv.AUTH0_ISSUER_BASE_URL ?? "",
  AUTH0_AUDIENCE: testProcessEnv.AUTH0_AUDIENCE ?? "",
  AUTH0_CLIENT_ID: testProcessEnv.AUTH0_CLIENT_ID ?? "",
  AUTH0_CLIENT_SECRET: testProcessEnv.AUTH0_CLIENT_SECRET ?? "",
  AUTH0_SCOPE: testProcessEnv.AUTH0_SCOPE ?? "",
  AUTH0_REDIRECT_URI: testProcessEnv.AUTH0_REDIRECT_URI ?? "",
  AUTH0_PROFILE_KEY: testProcessEnv.AUTH0_PROFILE_KEY,
  AUTH0_PERMISSIONS_KEY: testProcessEnv.AUTH0_PERMISSIONS_KEY,
  AUTH0_MANAGEMENT_CLIENT_ID: testProcessEnv.AUTH0_MANAGEMENT_CLIENT_ID,
  AUTH0_MANAGEMENT_CLIENT_SECRET: testProcessEnv.AUTH0_MANAGEMENT_CLIENT_SECRET,
  AUTH0_MANAGEMENT_AUDIENCE: testProcessEnv.AUTH0_MANAGEMENT_AUDIENCE,
  ENVIRONMENT: readEnvironment(),
  ALLOWED_ORIGINS: testProcessEnv.ALLOWED_ORIGINS,
  RATE_LIMIT_READ: allowAllRateLimiter,
  RATE_LIMIT_WRITE: allowAllRateLimiter,
  RATE_LIMIT_ADMIN: allowAllRateLimiter,
  RATE_LIMIT_AUTH: allowAllRateLimiter,
  RATE_LIMIT_ANON_WRITE: allowAllRateLimiter,
  // The daily cap counts audit history by sub, which outlives each run's
  // cleanup, and most suites reuse a few fixed subs: keep it out of their way.
  // loos.daily-cap.spec.ts sets its own cap with fresh subs. No SETTINGS KV
  // by default, so write_mode is `open` (loos.write-mode.spec.ts passes one).
  ACCOUNT_DAILY_CAP: testProcessEnv.ACCOUNT_DAILY_CAP ?? "1000000",
  ...overrides,
});

/** A no-op ExecutionContext: background work passed to `waitUntil` is not awaited. */
export const createTestExecutionContext = (): ExecutionContext => ({
  waitUntil: () => {
    // No-op: tests do not wait on background work.
  },
  passThroughOnException: () => {
    // No-op: there is no origin to fall back to.
  },
  get exports(): Cloudflare.Exports {
    throw new Error("ctx.exports (loopback bindings) is not available in tests.");
  },
  props: undefined,
});
