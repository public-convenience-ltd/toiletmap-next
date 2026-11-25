/**
 * `/health/ready` and `/` share one cached database check per isolate, so
 * polling them does not run a query on every request.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __readinessTestUtils,
  getDatabaseReadiness,
  READINESS_CACHE_MS,
  READINESS_FAILURE_CACHE_MS,
} from "../../src/services/health/readiness";
import type { Env } from "../../src/types";

const envFor = (connectionString: string) =>
  ({ HYPERDRIVE: { connectionString } }) as unknown as Env;

afterEach(() => __readinessTestUtils.reset());

describe("getDatabaseReadiness", () => {
  it(`reuses one result for ${READINESS_CACHE_MS} ms, then checks again`, async () => {
    let clock = 1_000;
    const now = () => clock;
    const probe = vi.fn(async () => undefined);
    const env = envFor("postgres://a");

    expect((await getDatabaseReadiness(env, { now, probe })).ok).toBe(true);
    clock += READINESS_CACHE_MS - 1;
    expect((await getDatabaseReadiness(env, { now, probe })).ok).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);

    clock += 1;
    await getDatabaseReadiness(env, { now, probe });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("shares a check in flight across a burst of requests", async () => {
    let release: () => void = () => undefined;
    const probe = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const env = envFor("postgres://burst");
    const burst = Array.from({ length: 20 }, () => getDatabaseReadiness(env, { probe }));
    release();
    const results = await Promise.all(burst);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it(`caches failures for only ${READINESS_FAILURE_CACHE_MS} ms, and keeps databases apart`, async () => {
    let clock = 1_000;
    const now = () => clock;
    const failing = vi.fn(() => Promise.reject(new Error("connection refused")));
    const down = envFor("postgres://down");
    const first = await getDatabaseReadiness(down, { now, probe: failing });
    expect(first.ok).toBe(false);
    clock += READINESS_FAILURE_CACHE_MS - 1;
    expect((await getDatabaseReadiness(down, { now, probe: failing })).ok).toBe(false);
    expect(failing).toHaveBeenCalledTimes(1);

    // A failure (perhaps a shared check cancelled with the request that ran it)
    // is retried well before a success would be.
    clock += 1;
    const recovered = vi.fn(async () => undefined);
    expect((await getDatabaseReadiness(down, { now, probe: recovered })).ok).toBe(true);
    expect(recovered).toHaveBeenCalledTimes(1);

    const healthy = vi.fn(async () => undefined);
    expect((await getDatabaseReadiness(envFor("postgres://up"), { probe: healthy })).ok).toBe(true);
  });

  it("fails without a connection string, without probing", async () => {
    const probe = vi.fn(async () => undefined);
    const result = await getDatabaseReadiness({} as Env, { probe });
    expect(result.ok).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });
});
