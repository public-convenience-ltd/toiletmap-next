import { E2E_SWEEP_MIN_AGE_MS, e2eRunStart, isStaleE2eRow, sweepE2eRows } from "./support/db";
import { RUN_ID, SERVER_URL } from "./support/env";
import { expect, test } from "./support/fixtures";

/**
 * The stale-row sweep (apps/toiletmap-server/scripts/e2e-db.ts) that the
 * global setup runs: it must never delete rows of the current run or of
 * another run that may still be in progress. No browser needed.
 */

const runIdAt = (msAgo: number) => (Date.now() - msAgo).toString(36);
const HOUR = 60 * 60 * 1000;

test.describe("e2e stale-row sweep", () => {
  test("decides staleness from the run id in the name", () => {
    const now = Date.now();
    const opts = { currentRunId: "current", now };
    const old = runIdAt(2 * HOUR);
    const recent = runIdAt(5 * 60 * 1000);

    expect(E2E_SWEEP_MIN_AGE_MS).toBe(HOUR);
    expect(e2eRunStart(`[e2e ${old}] x`)?.startedAt).toBe(Number.parseInt(old, 36));
    expect(isStaleE2eRow(`[e2e ${old}] x`, null, opts)).toBe(true);
    expect(isStaleE2eRow(`[e2e ${recent}] x`, null, opts)).toBe(false);
    // The current run is never swept, however old its id.
    expect(isStaleE2eRow(`[e2e ${old}] x`, null, { ...opts, currentRunId: old })).toBe(false);
    // No decodable run id: fall back to the row's own timestamp.
    expect(isStaleE2eRow("[e2e manual] x", new Date(now - 2 * HOUR), opts)).toBe(true);
    expect(isStaleE2eRow("[e2e manual] x", new Date(now - 60_000), opts)).toBe(false);
    expect(isStaleE2eRow("[e2e manual] x", null, opts)).toBe(false);
  });

  test("deletes only old rows of other runs", async ({ loos }) => {
    const suffix = Math.random().toString(36).slice(2, 7);
    const stale = await loos.create({ name: `[e2e ${runIdAt(2 * HOUR)}] sweep stale ${suffix}` });
    const otherRecent = await loos.create({
      name: `[e2e ${runIdAt(5 * 60 * 1000)}] sweep other run ${suffix}`,
    });
    const current = await loos.create({ name: `[e2e ${RUN_ID}] sweep current ${suffix}` });

    const result = await sweepE2eRows({ currentRunId: RUN_ID });
    expect(result.loos).toBeGreaterThanOrEqual(1);

    const status = async (id: string) =>
      (await fetch(`${SERVER_URL}/api/loos/${id}`, { headers: { "cache-control": "no-cache" } }))
        .status;
    expect(await status(stale.id)).toBe(404);
    expect(await status(otherRecent.id)).toBe(200);
    expect(await status(current.id)).toBe(200);
  });
});
