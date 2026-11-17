/**
 * Route-level caching contract for the public loo endpoints, against a fake
 * LooService so it needs no database:
 *
 * - each route sends its pinned Cache-Control constant;
 * - `/dump` and `/updates` read their sync cursor (and the dump's dataset
 *   version) *before* the query whose results it describes.
 */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { loosRouter } from "../../src/routes/loos";
import type { DatasetVersion, LooService } from "../../src/services/loo/loo.service";
import type { CompressedLoo, LooResponse } from "../../src/services/loo/types";
import type { AppVariables, Env } from "../../src/types";
import {
  DUMP_CACHE_CONTROL,
  dumpEtag,
  LOO_DETAIL_CACHE_CONTROL,
  LOO_IDS_CACHE_CONTROL,
  looEtag,
  UPDATES_CACHE_CONTROL,
} from "../../src/utils/http-cache";

const LOO_ID = "0123456789abcdef01234567";

const sampleLoo = (id = LOO_ID): LooResponse =>
  ({
    id,
    name: "Fake loo",
    area: [{ name: "Fake area", type: "borough" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    verifiedAt: null,
    reports: [],
    contributorsCount: 0,
    geohash: "gcpvj0",
    active: true,
    location: { lat: 51.5, lng: -0.12 },
  }) as unknown as LooResponse;

/** Edge-cache keys embed the version, so each fake gets its own to force a miss. */
let fakeGeneration = 0;

/**
 * A LooService whose every call advances a logical database clock. Cursors are
 * that clock (as epoch seconds) at the moment they are read, and data queries
 * record the clock when they run, so a test can tell which came first no
 * matter which method a route takes its cursor from.
 */
const createFakeService = () => {
  fakeGeneration += 1;
  const generation = fakeGeneration;
  let clock = 0;
  const calls: Array<{ name: string; at: number }> = [];
  const record = (name: string) => {
    clock += 1;
    calls.push({ name, at: clock });
    return clock;
  };
  const cursorAt = (tick: number) => new Date(tick * 1000).toISOString();
  const compressed: CompressedLoo[] = [[LOO_ID, "gcpvj0", 0]];

  /** Records the call on the clock, then resolves to the value built from that tick. */
  const call =
    <A extends unknown[], R>(name: string, result: (tick: number, ...args: A) => R) =>
    (...args: A): Promise<R> =>
      Promise.resolve(result(record(name), ...args));

  const service = {
    getDatasetVersion: call(
      "getDatasetVersion",
      (at): DatasetVersion => ({
        maxUpdatedAt: generation,
        count: 1,
        updatedAtSum: String(at),
        cursor: cursorAt(at),
      }),
    ),
    getSyncCursor: call("getSyncCursor", cursorAt),
    getAllCompressed: call("getAllCompressed", () => compressed),
    getAll: call("getAll", () => [sampleLoo()]),
    getUpdates: call("getUpdates", () => ({ upserted: compressed, deleted: [] as string[] })),
    getById: call("getById", (_at, id: string) => sampleLoo(id)),
    getByIds: call("getByIds", (_at, ids: string[]) => ids.map((id) => sampleLoo(id))),
  };

  const atOf = (name: string) => {
    const call = calls.find((entry) => entry.name === name);
    if (!call) throw new Error(`${name} was not called`);
    return call.at;
  };

  return { service: service as unknown as LooService, calls, atOf };
};

const ctx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

const buildApp = (service: LooService) => {
  const app = new Hono<{ Variables: AppVariables; Bindings: Env }>();
  app.use("*", async (c, next) => {
    c.set("looService", service);
    await next();
  });
  app.route("/api/loos", loosRouter);
  return app;
};

const get = (service: LooService, path: string, headers: Record<string, string> = {}) =>
  buildApp(service).fetch(new Request(`https://unit.test${path}`, { headers }), {} as Env, ctx);

describe("Cache-Control constants", () => {
  it("pin the documented policies", () => {
    expect(DUMP_CACHE_CONTROL).toBe("public, max-age=60, stale-while-revalidate=300");
    expect(UPDATES_CACHE_CONTROL).toBe("no-store");
    expect(LOO_DETAIL_CACHE_CONTROL).toBe("private, max-age=0, must-revalidate");
    expect(LOO_IDS_CACHE_CONTROL).toBe("private, max-age=60");
  });
});

describe("loo routes send their Cache-Control policy", () => {
  it.each([
    ["/api/loos/dump", DUMP_CACHE_CONTROL],
    ["/api/loos/dump?rich=true", DUMP_CACHE_CONTROL],
    [
      `/api/loos/updates?since=${encodeURIComponent("2026-01-01T00:00:00.000Z")}`,
      UPDATES_CACHE_CONTROL,
    ],
    [`/api/loos/${LOO_ID}`, LOO_DETAIL_CACHE_CONTROL],
    [`/api/loos?ids=${LOO_ID}`, LOO_IDS_CACHE_CONTROL],
  ])("GET %s", async (path, expected) => {
    const { service } = createFakeService();
    const response = await get(service, path);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(expected);
  });

  it("keeps the detail policy on a 304 revalidation", async () => {
    const detail = createFakeService();
    const detailEtag = looEtag(sampleLoo());
    const notModified = await get(detail.service, `/api/loos/${LOO_ID}`, {
      "If-None-Match": detailEtag,
    });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("Cache-Control")).toBe(LOO_DETAIL_CACHE_CONTROL);
    expect(notModified.headers.get("ETag")).toBe(detailEtag);
  });
});

describe("sync cursor is read before the data query", () => {
  it.each([
    ["/api/loos/dump", "getAllCompressed"],
    ["/api/loos/dump?rich=true", "getAll"],
  ])("GET %s", async (path, dataQuery) => {
    const { service, atOf } = createFakeService();
    const response = await get(service, path);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { cursor: string };

    const cursorTick = Date.parse(body.cursor) / 1000;
    expect(cursorTick).toBeLessThan(atOf(dataQuery));
    // The ETag / edge-cache key must describe a version no newer than the body.
    expect(atOf("getDatasetVersion")).toBeLessThan(atOf(dataQuery));
  });

  it("GET /api/loos/updates", async () => {
    const { service, atOf } = createFakeService();
    const response = await get(
      service,
      `/api/loos/updates?since=${encodeURIComponent("2026-01-01T00:00:00.000Z")}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { cursor: string };
    expect(Date.parse(body.cursor) / 1000).toBeLessThan(atOf("getUpdates"));
  });

  it("a dump revalidation with a current ETag never runs the data query", async () => {
    const { service, calls } = createFakeService();
    const etag = dumpEtag({ maxUpdatedAt: fakeGeneration, count: 1, updatedAtSum: "1" });
    const response = await get(service, "/api/loos/dump", { "If-None-Match": etag });
    expect(response.status).toBe(304);
    expect(response.headers.get("Cache-Control")).toBe(DUMP_CACHE_CONTROL);
    expect(calls.map((call) => call.name)).toEqual(["getDatasetVersion"]);
  });
});
