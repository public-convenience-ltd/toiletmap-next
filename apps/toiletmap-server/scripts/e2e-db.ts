#!/usr/bin/env tsx
/**
 * Direct database helpers for the client's Playwright e2e suite
 * (apps/toiletmap-client/e2e). Imported by the e2e support code, and runnable
 * as a CLI for manual clean-up:
 *
 *   pnpm --filter toiletmap-server exec tsx scripts/e2e-db.ts check
 *   pnpm --filter toiletmap-server exec tsx scripts/e2e-db.ts sweep [--all]
 *
 * Only rows created by the e2e suite are ever touched: toilets / pending
 * changes are deleted by explicit id, or by the `[e2e` name prefix that every
 * e2e fixture uses. Seed rows are never modified. The prefix sweep skips the
 * current run's rows and anything less than an hour old (see `sweepE2eRows`).
 *
 * Connects as the local Supabase superuser (bypasses RLS) via
 * E2E_DATABASE_URL, defaulting to the local Supabase stack on :54322.
 */
import { fileURLToPath } from "node:url";
import pg from "pg";

export const E2E_NAME_PREFIX = "[e2e";

export const DEFAULT_E2E_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export const e2eDatabaseUrl = (): string =>
  process.env.E2E_DATABASE_URL || DEFAULT_E2E_DATABASE_URL;

export type PendingChangeRow = {
  id: string;
  type: string;
  loo_id: string | null;
  payload: Record<string, unknown>;
  status: string;
  base_updated_at: Date | null;
};

const withClient = async <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> => {
  const client = new pg.Client({
    connectionString: e2eDatabaseUrl(),
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
};

/**
 * Throws a descriptive error unless the database is reachable and has the
 * schema the API needs (toilets + pending_change tables).
 */
export function checkDatabase(): Promise<{ toilets: number }> {
  return withClient(async (client) => {
    const tables = await client.query<{ name: string }>(
      `select table_name as name from information_schema.tables
        where table_schema = 'public' and table_name in ('toilets', 'pending_change')`,
    );
    const names = new Set(tables.rows.map((r) => r.name));
    for (const required of ["toilets", "pending_change"]) {
      if (!names.has(required)) {
        throw new Error(
          `Table public.${required} is missing — run migrations (pnpm --filter toiletmap-server supabase:start / supabase:reset).`,
        );
      }
    }
    const count = await client.query<{ n: string }>("select count(*)::text as n from toilets");
    return { toilets: Number(count.rows[0]?.n ?? 0) };
  });
}

/** Pending changes for a loo (update suggestions), oldest first. */
export function getPendingChangesForLoo(looId: string): Promise<PendingChangeRow[]> {
  return withClient(async (client) => {
    const res = await client.query<PendingChangeRow>(
      `select id, type, loo_id, payload, status, base_updated_at
         from pending_change where loo_id = $1 order by submitted_at asc`,
      [looId],
    );
    return res.rows;
  });
}

export type FeedbackRow = {
  id: number;
  email: string | null;
  feedback_text: string;
  route: string;
};

/**
 * Feedback rows whose text contains `marker` (each e2e message carries a unique one), oldest
 * first. Feedback has no e2e name prefix, so the specs delete their own rows by id.
 */
export function getFeedbackContaining(marker: string): Promise<FeedbackRow[]> {
  return withClient(async (client) => {
    const res = await client.query<FeedbackRow>(
      `select id, email, feedback_text, route from feedback
        where strpos(feedback_text, $1) > 0 order by id asc`,
      [marker],
    );
    return res.rows;
  });
}

export function deleteFeedback(ids: number[]): Promise<number> {
  if (ids.length === 0) return Promise.resolve(0);
  return withClient(async (client) => {
    const res = await client.query("delete from feedback where id = any($1::int[])", [ids]);
    return res.rowCount ?? 0;
  });
}

export function deletePendingChanges(ids: string[]): Promise<number> {
  if (ids.length === 0) return Promise.resolve(0);
  return withClient(async (client) => {
    const res = await client.query("delete from pending_change where id = any($1::uuid[])", [ids]);
    return res.rowCount ?? 0;
  });
}

/**
 * Deletes e2e toilets by id, together with any pending changes and audit rows
 * that reference them.
 */
export function deleteLoos(ids: string[]): Promise<number> {
  if (ids.length === 0) return Promise.resolve(0);
  return withClient(async (client) => {
    await client.query("delete from pending_change where loo_id = any($1::text[])", [ids]);
    const res = await client.query("delete from toilets where id = any($1::text[])", [ids]);
    await deleteAuditRows(client, ids);
    return res.rowCount ?? 0;
  });
}

const deleteAuditRows = async (client: pg.Client, ids: string[]) => {
  // audit.record_version is optional in some local setups; ignore if missing.
  await client
    .query(
      `delete from audit.record_version
        where table_name = 'toilets'
          and coalesce(record->>'id', old_record->>'id') = any($1::text[])`,
      [ids],
    )
    .catch(() => undefined);
};

/** Rows of other runs younger than this are left alone: that run may still be going. */
export const E2E_SWEEP_MIN_AGE_MS = 60 * 60 * 1000;

const RUN_ID_PATTERN = /^\[e2e ([0-9a-z]+)\]/;

/**
 * Start time of the run that created an e2e row, decoded from its name
 * (`[e2e <run id>] …`, where the run id is `Date.now().toString(36)`, see
 * apps/toiletmap-client/playwright.config.ts). Null when the name carries no
 * plausible run id.
 */
export function e2eRunStart(
  name: string | null | undefined,
): { runId: string; startedAt: number } | null {
  const runId = name?.match(RUN_ID_PATTERN)?.[1];
  if (!runId) return null;
  const startedAt = Number.parseInt(runId, 36);
  // Anything outside 2020..(now + 1 day) is not a Date.now() value.
  if (!Number.isSafeInteger(startedAt) || startedAt < Date.UTC(2020, 0, 1)) return null;
  if (startedAt > Date.now() + 86_400_000) return null;
  return { runId, startedAt };
}

export type SweepOptions = {
  /** Run id of the current run, whose rows are never swept. Defaults to E2E_RUN_ID. */
  currentRunId?: string;
  /** Minimum age of a row (or of the run that made it). Defaults to E2E_SWEEP_MIN_AGE_MS. */
  minAgeMs?: number;
  /** Clock, for tests. */
  now?: number;
};

/**
 * Whether an e2e row is safe to sweep: it does not belong to the current run,
 * and the run that created it started more than `minAgeMs` ago (when the name
 * has no decodable run id, the row's own timestamp is used instead).
 */
export function isStaleE2eRow(
  name: string | null,
  timestamp: Date | null,
  {
    currentRunId = process.env.E2E_RUN_ID,
    minAgeMs = E2E_SWEEP_MIN_AGE_MS,
    now = Date.now(),
  }: SweepOptions = {},
): boolean {
  const cutoff = now - minAgeMs;
  const run = e2eRunStart(name);
  if (run) return run.runId !== currentRunId && run.startedAt < cutoff;
  return timestamp !== null && timestamp.getTime() < cutoff;
}

/**
 * Removes rows left behind by earlier (e.g. aborted) e2e runs: toilets whose
 * name starts with the e2e prefix, their pending changes, and pending "create"
 * suggestions whose payload name has the prefix.
 *
 * Several runs may share one database (two terminals, or a run started while
 * another is still going), so only rows that are clearly stale are touched:
 * never the current run's (E2E_RUN_ID), and never a row whose run started
 * less than an hour ago (see `isStaleE2eRow`). Rows of a recent run that was
 * aborted are swept by the first run more than an hour later.
 */
export function sweepE2eRows(
  options: SweepOptions = {},
): Promise<{ loos: number; pendingChanges: number; skipped: number }> {
  return withClient(async (client) => {
    const like = `${E2E_NAME_PREFIX}%`;
    const loos = await client.query<{ id: string; name: string; updated_at: Date | null }>(
      "select id, name, coalesce(updated_at, created_at) as updated_at from toilets where name like $1",
      [like],
    );
    const creates = await client.query<{ id: string; name: string; submitted_at: Date }>(
      `select id, payload->>'name' as name, submitted_at from pending_change
        where payload->>'name' like $1`,
      [like],
    );
    const staleLoos = loos.rows.filter((r) => isStaleE2eRow(r.name, r.updated_at, options));
    const staleCreates = creates.rows.filter((r) => isStaleE2eRow(r.name, r.submitted_at, options));
    const ids = staleLoos.map((r) => r.id);
    const pending = await client.query(
      "delete from pending_change where loo_id = any($1::text[]) or id = any($2::uuid[])",
      [ids, staleCreates.map((r) => r.id)],
    );
    if (ids.length > 0) {
      await client.query("delete from toilets where id = any($1::text[])", [ids]);
      await deleteAuditRows(client, ids);
    }
    return {
      loos: ids.length,
      pendingChanges: pending.rowCount ?? 0,
      skipped: loos.rows.length - staleLoos.length + creates.rows.length - staleCreates.length,
    };
  });
}

const main = async () => {
  const command = process.argv[2];
  if (command === "check") {
    const { toilets } = await checkDatabase();
    console.log(`Database OK at ${e2eDatabaseUrl()} (${toilets} toilets)`);
    return;
  }
  if (command === "sweep") {
    // --all: also rows of runs that started less than an hour ago (only when
    // no e2e run is in progress).
    const all = process.argv.includes("--all");
    const result = await sweepE2eRows(all ? { minAgeMs: 0 } : {});
    console.log(
      `Removed ${result.loos} e2e toilet(s) and ${result.pendingChanges} pending change(s)` +
        (result.skipped
          ? `; kept ${result.skipped} recent row(s) (use --all to remove them too)`
          : ""),
    );
    return;
  }
  console.error("Usage: tsx scripts/e2e-db.ts <check|sweep [--all]>");
  process.exit(1);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
