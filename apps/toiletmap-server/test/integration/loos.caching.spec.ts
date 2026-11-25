/**
 * HTTP caching and freshness contract for the map client:
 *
 * - `/dump` carries a database-clock sync cursor and a dataset-version ETag.
 * - `/updates?since=<cursor>` delivers everything changed since, with overlap.
 * - `/:id` revalidates with a per-record ETag.
 * - Authenticated saves return the compressed map tuple for cache patching.
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { __adminRoleTestUtils } from "../../src/middleware/require-admin-role";
import { looEtag } from "../../src/utils/http-cache";
import { getPrismaClient, getTestContext } from "./setup";
import { cleanupManager } from "./utils/cleanup";
import { buildTestEnv, createTestExecutionContext, getTestDatabaseUrl } from "./utils/env";
import { createFixtureFactory } from "./utils/fixtures";
import type {
  DumpBody,
  LooResponse,
  QueuedBody,
  SavedLooBody as SavedBody,
  UpdatesBody,
} from "./utils/response-types";
import { sessionHeaders } from "./utils/session";
import { callApi, jsonRequest, readJson } from "./utils/test-client";

const fixtures = createFixtureFactory();

/**
 * An admin: these tests deactivate loos and create them with PUT, which only
 * admins may do (see write-guards.ts).
 */
const authHeaders = () => ({
  Authorization: `Bearer ${getTestContext().issueToken({ permissions: ["access:admin"] })}`,
});

const authPut = (id: string, body: Record<string, unknown>) =>
  callApi(`/api/loos/${id}`, jsonRequest("PUT", body, authHeaders()));

const dbNow = async (): Promise<number> => {
  const [row] = await getPrismaClient().$queryRaw<Array<{ now: Date }>>`SELECT now() AS now`;
  return new Date(row?.now ?? 0).getTime();
};

const getDump = async (init?: RequestInit) => {
  const response = await callApi("/api/loos/dump", init);
  return { response, etag: response.headers.get("ETag") ?? "" };
};

/** Calls the worker with explicit CORS configuration. */
const callWithOrigins = (path: string, origin: string, allowed: string) =>
  worker.fetch(
    new Request(`https://integration.test${path}`, { headers: { Origin: origin } }),
    buildTestEnv({ ALLOWED_ORIGINS: allowed }),
    createTestExecutionContext(),
  );

const OVERLAP_MS = 120_000;

describe("GET /api/loos/dump caching", () => {
  it("returns a database-clock cursor 120s behind now, a dataset ETag and short caching", async () => {
    await fixtures.loos.create();
    const before = await dbNow();
    const { response, etag } = await getDump();
    const after = await dbNow();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=60, stale-while-revalidate=300",
    );
    expect(etag).toMatch(/^W\/"dump-\d+-\d+-\d+"$/);

    const body = await readJson<DumpBody>(response);
    expect(body.count).toBe(body.data.length);
    const cursor = Date.parse(body.cursor);
    // Truncation to milliseconds can put the cursor up to 1ms below the window.
    expect(cursor).toBeGreaterThanOrEqual(before - OVERLAP_MS - 1);
    expect(cursor).toBeLessThanOrEqual(after - OVERLAP_MS);
  });

  it("derives the ETag from max(updated_at), the row count and the updated_at sum", async () => {
    await fixtures.loos.create();
    const [row] = await getPrismaClient().$queryRaw<
      Array<{ max: Date; count: bigint; sum: string }>
    >`
      SELECT
        max(updated_at) AS max,
        count(*)::bigint AS count,
        sum((extract(epoch FROM updated_at) * 1000000)::bigint)::text AS sum
      FROM toilets
    `;
    const { etag } = await getDump();
    expect(etag).toBe(
      `W/"dump-${new Date(row?.max ?? 0).getTime()}-${Number(row?.count)}-${row?.sum}"`,
    );
  });

  it("changes the ETag when a row other than the newest changes", async () => {
    const older = await fixtures.loos.create();
    await fixtures.loos.create();
    const first = await getDump();

    // Max updated_at and the row count both stay the same.
    await getPrismaClient().$executeRaw`
      UPDATE toilets SET updated_at = updated_at - interval '1 second' WHERE id = ${older.id}
    `;

    const second = await getDump();
    expect(second.etag).not.toBe(first.etag);
    const revalidated = await callApi("/api/loos/dump", {
      headers: { "If-None-Match": first.etag },
    });
    expect(revalidated.status).toBe(200);
  });

  it("changes the ETag when a transaction commits after a later-started one", async () => {
    const early = await fixtures.loos.create({ notes: "early" });
    const late = await fixtures.loos.create({ notes: "late" });
    const url = getTestDatabaseUrl();
    const first = new pg.Client({ connectionString: url });
    const second = new pg.Client({ connectionString: url });
    await Promise.all([first.connect(), second.connect()]);
    try {
      // `first` starts earlier, so its now() (and updated_at) is the older one.
      await first.query("BEGIN");
      await first.query("UPDATE toilets SET notes = 'first', updated_at = now() WHERE id = $1", [
        early.id,
      ]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      await second.query("BEGIN");
      await second.query("UPDATE toilets SET notes = 'second', updated_at = now() WHERE id = $1", [
        late.id,
      ]);
      await second.query("COMMIT");

      const beforeLateCommit = await getDump();
      await first.query("COMMIT");

      // The max is still the second transaction's timestamp, and the count is unchanged.
      const afterLateCommit = await getDump();
      expect(afterLateCommit.etag).not.toBe(beforeLateCommit.etag);
      const body = await readJson<DumpBody>(afterLateCommit.response);
      expect(body.data.some((row) => row[0] === early.id)).toBe(true);
    } finally {
      await first.query("ROLLBACK").catch(() => undefined);
      await second.query("ROLLBACK").catch(() => undefined);
      await Promise.all([first.end(), second.end()]);
    }
  });

  it("answers If-None-Match with 304 and no body", async () => {
    await fixtures.loos.create();
    const { etag } = await getDump();

    for (const ifNoneMatch of [etag, etag.replace(/^W\//, ""), `W/"stale", ${etag}`, "*"]) {
      const response = await callApi("/api/loos/dump", {
        headers: { "If-None-Match": ifNoneMatch },
      });
      expect(response.status).toBe(304);
      expect(await response.text()).toBe("");
      expect(response.headers.get("ETag")).toBe(etag);
      expect(response.headers.get("Cache-Control")).toBe(
        "public, max-age=60, stale-while-revalidate=300",
      );
    }

    const mismatch = await callApi("/api/loos/dump", { headers: { "If-None-Match": 'W/"nope"' } });
    expect(mismatch.status).toBe(200);
  });

  it("changes the ETag after a PUT and never serves the pre-edit dump", async () => {
    const loo = await fixtures.loos.create({ radar: false });
    const first = await getDump();
    const firstBody = await readJson<DumpBody>(first.response);
    const before = firstBody.data.find((row) => row[0] === loo.id);
    expect(before).toBeDefined();

    // Same version again comes from the edge cache with an identical body.
    const repeat = await getDump();
    expect(repeat.etag).toBe(first.etag);
    expect(await readJson<DumpBody>(repeat.response)).toEqual(firstBody);

    const put = await authPut(loo.id, { radar: true });
    expect(put.status).toBe(200);

    const second = await getDump();
    expect(second.etag).not.toBe(first.etag);
    const after = (await readJson<DumpBody>(second.response)).data.find((row) => row[0] === loo.id);
    // RADAR is bit 0b100000.
    expect(after?.[2]).toBe((before?.[2] ?? 0) | 0b100000);

    const stale = await callApi("/api/loos/dump", { headers: { "If-None-Match": first.etag } });
    expect(stale.status).toBe(200);
  });

  it("drops a deactivated loo from the next dump", async () => {
    const loo = await fixtures.loos.create();
    const first = await getDump();
    expect((await readJson<DumpBody>(first.response)).data.some((r) => r[0] === loo.id)).toBe(true);

    expect((await authPut(loo.id, { active: false })).status).toBe(200);

    const second = await getDump();
    expect(second.etag).not.toBe(first.etag);
    expect((await readJson<DumpBody>(second.response)).data.some((r) => r[0] === loo.id)).toBe(
      false,
    );
  });

  it("keeps ?rich=true working with its own ETag and a cursor", async () => {
    const loo = await fixtures.loos.create({ name: "Rich caching loo" });
    const response = await callApi("/api/loos/dump?rich=true");
    expect(response.status).toBe(200);
    const etag = response.headers.get("ETag") ?? "";
    expect(etag).toMatch(/^W\/"dump-rich-\d+-\d+-\d+"$/);
    const body = await readJson<{ data: LooResponse[]; count: number; cursor: string }>(response);
    expect(body.data.find((row) => row.id === loo.id)?.name).toBe("Rich caching loo");
    expect(Number.isNaN(Date.parse(body.cursor))).toBe(false);

    const revalidated = await callApi("/api/loos/dump?rich=true", {
      headers: { "If-None-Match": etag },
    });
    expect(revalidated.status).toBe(304);
  });

  it("does not replay the first caller's CORS headers from the edge cache", async () => {
    await fixtures.loos.create();
    const allowed = "https://a.example,https://b.example";

    const first = await callWithOrigins("/api/loos/dump", "https://a.example", allowed);
    expect(first.status).toBe(200);
    expect(first.headers.get("Access-Control-Allow-Origin")).toBe("https://a.example");
    const firstBody = await first.text();

    const second = await callWithOrigins("/api/loos/dump", "https://b.example", allowed);
    expect(second.status).toBe(200);
    expect(second.headers.get("Access-Control-Allow-Origin")).toBe("https://b.example");
    expect(second.headers.get("Vary")).toContain("Origin");
    expect(second.headers.get("Cache-Control")).toBe(
      "public, max-age=60, stale-while-revalidate=300",
    );
    expect(await second.text()).toBe(firstBody);

    const disallowed = await callWithOrigins("/api/loos/dump", "https://evil.example", allowed);
    expect(disallowed.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("GET /api/loos/updates freshness", () => {
  it("returns a server cursor and is never cached", async () => {
    const before = await dbNow();
    const response = await callApi(`/api/loos/updates?since=${new Date().toISOString()}`);
    const after = await dbNow();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await readJson<UpdatesBody>(response);
    const cursor = Date.parse(body.cursor);
    expect(cursor).toBeGreaterThanOrEqual(before - OVERLAP_MS - 1);
    expect(cursor).toBeLessThanOrEqual(after - OVERLAP_MS);
  });

  it("delivers an edit made after the dump, and re-delivers it within the overlap", async () => {
    const loo = await fixtures.loos.create({ babyChange: false });
    const dump = await readJson<DumpBody>((await getDump()).response);

    expect((await authPut(loo.id, { babyChange: true })).status).toBe(200);

    const first = await readJson<UpdatesBody>(
      await callApi(`/api/loos/updates?since=${encodeURIComponent(dump.cursor)}`),
    );
    const delivered = first.upserted.find((row) => row[0] === loo.id);
    expect(delivered).toBeDefined();
    // BABY_CHNG is bit 0b10000.
    expect((delivered?.[2] ?? 0) & 0b10000).toBe(0b10000);
    expect(Date.parse(first.cursor)).toBeGreaterThanOrEqual(Date.parse(dump.cursor));

    // The next cursor still trails the edit by 120s, so the row comes again.
    const second = await readJson<UpdatesBody>(
      await callApi(`/api/loos/updates?since=${encodeURIComponent(first.cursor)}`),
    );
    expect(second.upserted.find((row) => row[0] === loo.id)).toEqual(delivered);
  });

  it("lists a loo deactivated after the dump under deleted", async () => {
    const loo = await fixtures.loos.create();
    const dump = await readJson<DumpBody>((await getDump()).response);

    expect((await authPut(loo.id, { active: false })).status).toBe(200);

    const updates = await readJson<UpdatesBody>(
      await callApi(`/api/loos/updates?since=${encodeURIComponent(dump.cursor)}`),
    );
    expect(updates.deleted).toContain(loo.id);
    expect(updates.upserted.some((row) => row[0] === loo.id)).toBe(false);
  });

  it("delivers a change applied by approving a pending edit", async () => {
    __adminRoleTestUtils.clearPermissionCache();
    const loo = await fixtures.loos.create({ radar: false });
    const dump = await getDump();
    const dumpBody = await readJson<DumpBody>(dump.response);

    const prisma = getPrismaClient();
    const change = await prisma.pending_change.create({
      data: { type: "update", loo_id: loo.id, payload: { radar: true }, ip: "127.0.0.1" },
    });
    cleanupManager.trackPendingChange(change.id);

    const approve = await callApi(`/admin/pending/${change.id}/approve`, {
      method: "POST",
      headers: sessionHeaders({
        sub: "auth0|test-admin",
        permissions: ["access:admin"],
        profile: { name: "Test Admin" },
      }),
    });
    expect(approve.headers.get("location")).toBe("/admin/pending?notice=approved");

    expect((await getDump()).etag).not.toBe(dump.etag);
    const updates = await readJson<UpdatesBody>(
      await callApi(`/api/loos/updates?since=${encodeURIComponent(dumpBody.cursor)}`),
    );
    const row = updates.upserted.find((r) => r[0] === loo.id);
    expect((row?.[2] ?? 0) & 0b100000).toBe(0b100000);
  });

  it("stamps updated_at from the database clock", async () => {
    const loo = await fixtures.loos.create();
    const before = await dbNow();
    expect((await authPut(loo.id, { notes: "clock check" })).status).toBe(200);
    const after = await dbNow();

    const raw = await fixtures.loos.getRawById(loo.id);
    const stamped = raw?.updated_at?.getTime() ?? 0;
    // Microsecond database values truncate to the millisecond in JS.
    expect(stamped).toBeGreaterThanOrEqual(before - 1);
    expect(stamped).toBeLessThanOrEqual(after);
  });
});

describe("GET /api/loos/:id revalidation", () => {
  it("sends a private must-revalidate policy with a per-record ETag", async () => {
    const loo = await fixtures.loos.create();
    const response = await callApi(`/api/loos/${loo.id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=0, must-revalidate");
    expect(response.headers.get("ETag")).toBe(looEtag(loo));
    expect(response.headers.get("ETag")).toMatch(
      new RegExp(`^W/"loo-${loo.id}-${Date.parse(loo.updatedAt ?? "")}-[0-9a-f]{8}"$`),
    );
  });

  it("changes the ETag when the loo's area is renamed", async () => {
    const prisma = getPrismaClient();
    // A one-off area around a point no real area covers, so the area trigger
    // assigns it to the loo deterministically.
    const areaId = randomBytes(12).toString("hex");
    const name = `ETag area ${areaId}`;
    await prisma.$executeRaw`
      INSERT INTO areas (id, name, type, priority, dataset_id, version, geometry)
      VALUES (${areaId}, ${name}, 'borough', 1, 1, 1,
        ST_GeogFromText('POLYGON((-30.6 0.4, -30.4 0.4, -30.4 0.6, -30.6 0.6, -30.6 0.4))'))
    `;
    let looId: string | null = null;
    try {
      const loo = await fixtures.loos.create({ location: { lat: 0.5, lng: -30.5 } });
      looId = loo.id;
      expect(loo.area).toEqual([{ name, type: "borough" }]);

      const first = await callApi(`/api/loos/${loo.id}`);
      const etag = first.headers.get("ETag") ?? "";

      await prisma.$executeRaw`UPDATE areas SET name = ${`${name} renamed`} WHERE id = ${areaId}`;

      const second = await callApi(`/api/loos/${loo.id}`, { headers: { "If-None-Match": etag } });
      expect(second.status).toBe(200);
      expect(second.headers.get("ETag")).not.toBe(etag);
      const body = await readJson<LooResponse>(second);
      expect(body.area[0]?.name).toBe(`${name} renamed`);
      expect(body.updatedAt).toBe(loo.updatedAt);
    } finally {
      if (looId) await prisma.toilets.deleteMany({ where: { id: looId } });
      await prisma.areas.deleteMany({ where: { id: areaId } });
    }
  });

  it("answers a matching If-None-Match with 304, and 200 once the loo changes", async () => {
    const loo = await fixtures.loos.create({ notes: "Before" });
    const etag = (await callApi(`/api/loos/${loo.id}`)).headers.get("ETag") ?? "";

    const notModified = await callApi(`/api/loos/${loo.id}`, {
      headers: { "If-None-Match": etag },
    });
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");
    expect(notModified.headers.get("ETag")).toBe(etag);

    expect((await authPut(loo.id, { notes: "After" })).status).toBe(200);

    const changed = await callApi(`/api/loos/${loo.id}`, { headers: { "If-None-Match": etag } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("ETag")).not.toBe(etag);
    expect((await readJson<LooResponse>(changed)).notes).toBe("After");
  });

  it("exposes ETag to cross-origin callers", async () => {
    const loo = await fixtures.loos.create();
    const response = await callWithOrigins(
      `/api/loos/${loo.id}`,
      "https://a.example",
      "https://a.example",
    );
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("ETag");
  });

  it("caches ?ids= lookups privately for a minute", async () => {
    const loo = await fixtures.loos.create();
    const response = await callApi(`/api/loos?ids=${loo.id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=60");
  });
});

describe("compressed tuple on saved responses", () => {
  const dumpRow = async (id: string) =>
    (await readJson<DumpBody>((await getDump()).response)).data.find((row) => row[0] === id);

  it("POST returns the same tuple the dump will serve", async () => {
    const response = await callApi(
      "/api/loos",
      jsonRequest(
        "POST",
        {
          name: "Compressed create",
          active: true,
          noPayment: true,
          location: { lat: 51.5, lng: -0.12 },
        },
        authHeaders(),
      ),
    );
    expect(response.status).toBe(201);
    const body = await readJson<SavedBody>(response);
    cleanupManager.trackLoo(body.id);

    expect(body.compressed).toEqual([body.id, body.geohash, 1]);
    expect(await dumpRow(body.id)).toEqual(body.compressed);
  });

  it("PUT returns the updated tuple, also when nothing changed", async () => {
    const loo = await fixtures.loos.create({ radar: false });

    const updated = await readJson<SavedBody>(await authPut(loo.id, { radar: true }));
    expect(updated.compressed?.[0]).toBe(loo.id);
    expect(updated.compressed?.[1]).toBe(loo.geohash);
    expect((updated.compressed?.[2] ?? 0) & 0b100000).toBe(0b100000);
    expect(await dumpRow(loo.id)).toEqual(updated.compressed);

    const unchanged = await authPut(loo.id, { radar: true });
    expect(unchanged.status).toBe(200);
    expect((await readJson<SavedBody>(unchanged)).compressed).toEqual(updated.compressed);
  });

  it("PUT returns compressed: null for a deactivated loo", async () => {
    const loo = await fixtures.loos.create();
    const response = await authPut(loo.id, { active: false });
    expect(response.status).toBe(200);
    const body = await readJson<SavedBody>(response);
    expect(body.active).toBe(false);
    expect(body.compressed).toBeNull();
  });

  it("PUT that creates an unknown id returns the tuple with 201", async () => {
    const id = "c0ffee00c0ffee00c0ffee00";
    cleanupManager.trackLoo(id);
    const response = await authPut(id, {
      name: "Upserted",
      active: true,
      location: { lat: 51.51, lng: -0.11 },
    });
    expect(response.status).toBe(201);
    const body = await readJson<SavedBody>(response);
    expect(body.compressed).toEqual([id, body.geohash, 0]);
  });

  it("leaves anonymous 202 responses unchanged", async () => {
    const response = await callApi(
      "/api/loos",
      jsonRequest("POST", { name: "Anon", location: { lat: 51.5, lng: -0.1 } }),
    );
    expect(response.status).toBe(202);
    const body = await readJson<QueuedBody & { compressed?: unknown }>(response);
    cleanupManager.trackPendingChange(body.id);
    expect(body).toEqual({ queued: true, id: body.id });
  });
});
