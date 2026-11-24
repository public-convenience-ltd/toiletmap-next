/**
 * Input limits, normalised cache keys and the heavy-read limiter on the
 * public loo routes, against a fake LooService (no database):
 *
 * - geohash prefixes are base32 only, 4-12 characters;
 * - every query schema is strict (an unknown parameter is a 400);
 * - `ids` is de-duplicated and capped, `page` is capped;
 * - write bodies over LOO_WRITE_BODY_MAX_BYTES are refused before parsing;
 * - edge-cache keys come from the validated parameters, not the raw URL;
 * - heavy reads take the stricter `heavy:<ip>` limit, admins excepted.
 */
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_IDS_PER_REQUEST, MAX_SEARCH_PAGE } from "../../src/common/constants";
import { normalisedCacheKey } from "../../src/middleware/cache";
import { LOO_WRITE_BODY_MAX_BYTES, loosRouter } from "../../src/routes/loos";
import type { LooService } from "../../src/services/loo/loo.service";
import type { AppVariables, Env, RequestUser } from "../../src/types";

const LOO_ID = "0123456789abcdef01234567";

const createFakeService = () => {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const record =
    <R>(name: string, result: R) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
      return Promise.resolve(result);
    };
  const service = {
    getWithinGeohash: record("getWithinGeohash", []),
    getWithinGeohashCompressed: record("getWithinGeohashCompressed", []),
    getWithinGeohashSummary: record("getWithinGeohashSummary", []),
    getByProximity: record("getByProximity", []),
    search: record("search", { data: [], total: 0 }),
    getSearchMetrics: record("getSearchMetrics", {}),
    getByIds: record("getByIds", []),
    getDatasetVersion: record("getDatasetVersion", {
      maxUpdatedAt: 1,
      count: 0,
      updatedAtSum: "0",
      cursor: "2026-01-01T00:00:00.000Z",
    }),
    getAll: record("getAll", []),
    getAllCompressed: record("getAllCompressed", []),
    getSyncCursor: record("getSyncCursor", "2026-01-01T00:00:00.000Z"),
    getUpdates: record("getUpdates", { upserted: [], deleted: [] }),
    getById: record("getById", null),
  };
  return { service: service as unknown as LooService, calls };
};

const ctx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

const buildApp = (service: LooService, user?: RequestUser) => {
  const app = new Hono<{ Variables: AppVariables; Bindings: Env }>();
  app.use("*", async (c, next) => {
    c.set("looService", service);
    if (user) c.set("user", user);
    await next();
  });
  app.route("/api/loos", loosRouter);
  return app;
};

const request = (
  service: LooService,
  path: string,
  {
    env = {},
    init = {},
    user,
  }: { env?: Partial<Env>; init?: RequestInit; user?: RequestUser } = {},
) =>
  buildApp(service, user).fetch(
    new Request(`https://unit.test${path}`, {
      ...init,
      headers: { "cf-connecting-ip": "198.51.100.9", ...init.headers },
    }),
    env as Env,
    ctx,
  );

describe("GET /api/loos/geohash/:geohash input", () => {
  it.each([
    "gcp", // too short
    "gcpvj0e4kq0j1", // longer than 12
    "gcpa", // 'a' is not in the geohash alphabet
    "gcp%25", // a LIKE wildcard
    "gcp_",
    "gc%5C%5C",
  ])("refuses %s", async (geohash) => {
    const { service, calls } = createFakeService();
    const response = await request(service, `/api/loos/geohash/${geohash}`);
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("accepts 4-12 base32 characters and lower-cases them", async () => {
    const { service, calls } = createFakeService();
    expect((await request(service, "/api/loos/geohash/GCPV?compressed=true")).status).toBe(200);
    expect((await request(service, "/api/loos/geohash/gcpvj0e4kq0j")).status).toBe(200);
    expect(calls.map((call) => call.args[0])).toEqual(["gcpv", "gcpvj0e4kq0j"]);
  });
});

describe("strict query schemas", () => {
  it.each([
    "/api/loos/dump?cachebust=1",
    "/api/loos/geohash/gcpvj?compressed=true&x=1",
    "/api/loos/proximity?lat=51.5&lng=-0.12&_=123",
    "/api/loos/search?search=abc&foo=bar",
    "/api/loos/metrics?bar=1",
    `/api/loos/updates?since=${encodeURIComponent("2026-01-01T00:00:00.000Z")}&x=1`,
    `/api/loos?ids=${LOO_ID}&x=1`,
    `/api/loos/${LOO_ID}/reports?x=1`,
  ])("refuses an unknown parameter: %s", async (path) => {
    const { service, calls } = createFakeService();
    const response = await request(service, path);
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("still accepts what the website and the admin explorer send", async () => {
    const { service } = createFakeService();
    for (const path of [
      "/api/loos/dump",
      `/api/loos/proximity?lat=51.5&lng=-0.12&radius=150&includeInactive=true&exclude=${LOO_ID}`,
      "/api/loos/proximity?lat=51.5&lng=-0.12&radius=100",
      "/api/loos/search?search=x&page=2&limit=50&sort=name-asc&active=true&accessible=false&noPayment=true&verified=true",
      "/api/loos/metrics?search=x&sort=updated-desc&active=true&recentWindowDays=30",
      `/api/loos?ids=${LOO_ID}&ids=${LOO_ID.replace("0", "f")}`,
    ]) {
      expect((await request(service, path)).status, path).toBe(200);
    }
  });
});

describe("ids and page caps", () => {
  const id = (n: number) => n.toString(16).padStart(24, "0");

  it("de-duplicates ids, keeping the first order", async () => {
    const { service, calls } = createFakeService();
    const response = await request(service, `/api/loos?ids=${id(2)},${id(1)}&ids=${id(2)}`);
    expect(response.status).toBe(200);
    expect(calls[0]?.args[0]).toEqual([id(2), id(1)]);
  });

  it(`refuses more than ${MAX_IDS_PER_REQUEST} distinct ids, and ids of the wrong length`, async () => {
    const { service, calls } = createFakeService();
    const many = Array.from({ length: MAX_IDS_PER_REQUEST + 1 }, (_, n) => id(n)).join(",");
    expect((await request(service, `/api/loos?ids=${many}`)).status).toBe(400);
    expect((await request(service, "/api/loos?ids=abc")).status).toBe(400);
    const exactly = Array.from({ length: MAX_IDS_PER_REQUEST }, (_, n) => id(n)).join(",");
    expect((await request(service, `/api/loos?ids=${exactly}`)).status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it(`refuses a search page beyond ${MAX_SEARCH_PAGE}`, async () => {
    const { service, calls } = createFakeService();
    expect((await request(service, `/api/loos/search?page=${MAX_SEARCH_PAGE + 1}`)).status).toBe(
      400,
    );
    expect((await request(service, `/api/loos/search?page=${MAX_SEARCH_PAGE}`)).status).toBe(200);
    expect(calls).toHaveLength(1);
  });
});

describe("write body limit", () => {
  const big = JSON.stringify({ notes: "x".repeat(LOO_WRITE_BODY_MAX_BYTES) });

  it.each([
    ["POST", "/api/loos"],
    ["PUT", `/api/loos/${LOO_ID}`],
    ["POST", `/api/loos/${LOO_ID}/report`],
    ["POST", `/api/loos/${LOO_ID}/restore`],
    ["POST", `/api/loos/${LOO_ID}/verify`],
  ])("%s %s refuses a body over the limit with 413", async (method, path) => {
    const { service, calls } = createFakeService();
    const response = await request(service, path, {
      init: { method, body: big, headers: { "content-type": "application/json" } },
    });
    expect(response.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it("refuses a chunked body (no Content-Length) once it passes the limit", async () => {
    const { service, calls } = createFakeService();
    const bytes = new TextEncoder().encode(big);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 8192) {
          controller.enqueue(bytes.slice(offset, offset + 8192));
        }
        controller.close();
      },
    });
    const response = await request(service, "/api/loos", {
      init: {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
        // @ts-expect-error Node's fetch needs duplex for a stream body.
        duplex: "half",
      },
    });
    expect(response.status).toBe(413);
    expect(calls).toHaveLength(0);
  });
});

describe("edge-cache keys", () => {
  const store = new Map<string, Response>();
  let pending: Promise<unknown>[] = [];
  let original: PropertyDescriptor | undefined;
  const cachingCtx = {
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p);
    },
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;

  beforeEach(() => {
    store.clear();
    pending = [];
    original = Object.getOwnPropertyDescriptor(globalThis, "caches");
    const keyOf = (req: RequestInfo | URL) =>
      typeof req === "string" ? req : req instanceof URL ? req.href : req.url;
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      writable: true,
      value: {
        default: {
          match: (req: RequestInfo | URL) => Promise.resolve(store.get(keyOf(req))?.clone()),
          put: (req: RequestInfo | URL, res: Response) => {
            store.set(keyOf(req), res.clone());
            return Promise.resolve();
          },
        },
      },
    });
  });

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, "caches", original);
    else Reflect.deleteProperty(globalThis, "caches");
  });

  const fetchCached = (service: LooService, path: string) =>
    buildApp(service).fetch(new Request(`https://unit.test${path}`), {} as Env, cachingCtx);

  it("proximity: reordered, padded or defaulted parameters share one entry", async () => {
    const { service, calls } = createFakeService();
    const first = await fetchCached(service, "/api/loos/proximity?lat=51.5&lng=-0.12");
    expect(first.status).toBe(200);
    await Promise.all(pending);
    for (const path of [
      "/api/loos/proximity?lng=-0.12&lat=51.5",
      "/api/loos/proximity?lat=51.50&lng=-0.120&radius=1000",
      "/api/loos/proximity?lat=51.5&lng=-0.12&includeInactive=false",
    ]) {
      expect((await fetchCached(service, path)).status, path).toBe(200);
    }
    expect(calls.filter((call) => call.name === "getByProximity")).toHaveLength(1);
    expect([...store.keys()]).toEqual([
      "https://unit.test/__cache/loos/proximity?includeInactive=false&lat=51.5&lng=-0.12&radius=1000",
    ]);
  });

  it("geohash: case and the default `active` do not mint new entries", async () => {
    const { service, calls } = createFakeService();
    // Empty results get max-age=0 and are never stored, so give the fake some rows.
    const rows = Array.from({ length: 101 }, (_, n) => [String(n), "gcpvj", 0]);
    (service as unknown as Record<string, unknown>).getWithinGeohashCompressed = (
      ...args: unknown[]
    ) => {
      calls.push({ name: "getWithinGeohashCompressed", args });
      return Promise.resolve(rows);
    };
    await fetchCached(service, "/api/loos/geohash/gcpvj?compressed=true");
    await Promise.all(pending);
    await fetchCached(service, "/api/loos/geohash/GCPVJ?compressed=TRUE&active=true");
    expect(calls).toHaveLength(1);
  });

  it("normalisedCacheKey sorts parameters and drops undefined ones", () => {
    const c = { req: { url: "https://api.example/api/loos/x?z=1" } } as never;
    expect(normalisedCacheKey(c, "r", { b: 2, a: "x y", skip: undefined, n: null })).toBe(
      "https://api.example/__cache/r?a=x+y&b=2&n=null",
    );
    expect(normalisedCacheKey(c, "r", {})).toBe("https://api.example/__cache/r");
  });
});

describe("heavy-read limiter", () => {
  const denying = () => {
    const limit = vi.fn(async (_options: { key: string }) => ({ success: false }));
    return { limit, env: { RATE_LIMIT_WRITE: { limit } } as Partial<Env> };
  };

  it.each([
    "/api/loos/dump?rich=true",
    "/api/loos/search",
    "/api/loos/metrics",
    "/api/loos/proximity?lat=51.5&lng=-0.12&radius=5001",
    "/api/loos/geohash/gcpv",
  ])("limits %s per IP under heavy:", async (path) => {
    const { service, calls } = createFakeService();
    const { limit, env } = denying();
    const response = await request(service, path, { env });
    expect(response.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: "heavy:198.51.100.9" });
    expect(calls).toHaveLength(0);
  });

  it.each([
    "/api/loos/dump",
    "/api/loos/proximity?lat=51.5&lng=-0.12&radius=5000",
    "/api/loos/geohash/gcpvj",
    `/api/loos?ids=${LOO_ID}`,
  ])("leaves the light read %s alone", async (path) => {
    const { service } = createFakeService();
    const { limit, env } = denying();
    expect((await request(service, path, { env })).status).toBe(200);
    expect(limit).not.toHaveBeenCalled();
  });

  it("exempts admins (the dataset explorer pages through /search and /metrics)", async () => {
    const { service } = createFakeService();
    const { limit, env } = denying();
    const admin = { sub: "auth0|admin", permissions: ["access:admin"] } as RequestUser;
    expect((await request(service, "/api/loos/search", { env, user: admin })).status).toBe(200);
    expect((await request(service, "/api/loos/metrics", { env, user: admin })).status).toBe(200);
    expect(limit).not.toHaveBeenCalled();

    const signedIn = { sub: "auth0|someone", permissions: [] } as unknown as RequestUser;
    expect((await request(service, "/api/loos/search", { env, user: signedIn })).status).toBe(429);
  });
});
