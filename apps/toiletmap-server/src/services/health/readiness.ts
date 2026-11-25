/**
 * Database readiness for `GET /health/ready` and `GET /`, cached per isolate
 * so neither runs a query on every request: both are public and unthrottled,
 * and the deploy smoke test and uptime checks poll them.
 */
import { createPrismaClient } from "../../prisma";
import type { Env } from "../../types";

/** How long one successful database check answers for. */
export const READINESS_CACHE_MS = 10_000;

/**
 * How long a failed check answers for. Shorter, because sharing a check is
 * best effort: on Workers its I/O belongs to the request that started it, so
 * a client disconnecting can fail it for everyone waiting, and one such
 * failure should not report "degraded" for the full window.
 */
export const READINESS_FAILURE_CACHE_MS = 2_000;

export type DatabaseReadiness =
  | { ok: true; responseTime: number; checkedAt: number }
  | { ok: false; error: unknown; responseTime: number; checkedAt: number };

type Probe = (connectionString: string) => Promise<void>;

const selectOne: Probe = async (connectionString) => {
  await createPrismaClient(connectionString).$queryRaw`SELECT 1 as health_check`;
};

/** Settled results and checks in flight, by connection string (one or two per isolate). */
const settled = new Map<string, DatabaseReadiness>();
const inFlight = new Map<string, Promise<DatabaseReadiness>>();

const connectionStringOf = (env: Env): string | undefined =>
  env.HYPERDRIVE?.connectionString ?? env.TEST_HYPERDRIVE?.connectionString;

/**
 * The database check result, reusing one from the last
 * {@link READINESS_CACHE_MS} (a failure: {@link READINESS_FAILURE_CACHE_MS}) and sharing a check already in flight, so a burst
 * of requests costs at most one `SELECT 1` per isolate per window.
 */
export const getDatabaseReadiness = async (
  env: Env,
  { now = Date.now, probe = selectOne }: { now?: () => number; probe?: Probe } = {},
): Promise<DatabaseReadiness> => {
  const connectionString = connectionStringOf(env);
  if (!connectionString) {
    return {
      ok: false,
      error: new Error("No database connection string available"),
      responseTime: 0,
      checkedAt: now(),
    };
  }

  const cached = settled.get(connectionString);
  const ttl = cached?.ok ? READINESS_CACHE_MS : READINESS_FAILURE_CACHE_MS;
  if (cached && now() - cached.checkedAt < ttl) return cached;

  const pending = inFlight.get(connectionString);
  if (pending) return pending;

  const check = (async (): Promise<DatabaseReadiness> => {
    const started = now();
    try {
      await probe(connectionString);
      return { ok: true, responseTime: now() - started, checkedAt: now() };
    } catch (error) {
      return { ok: false, error, responseTime: now() - started, checkedAt: now() };
    }
  })();
  inFlight.set(connectionString, check);
  try {
    const result = await check;
    settled.set(connectionString, result);
    return result;
  } finally {
    inFlight.delete(connectionString);
  }
};

export const __readinessTestUtils = {
  reset: () => {
    settled.clear();
    inFlight.clear();
  },
};
