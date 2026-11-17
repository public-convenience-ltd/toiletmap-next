import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cacheResponse, edgeCache } from "../../src/middleware/cache";
import { securityHeaders } from "../../src/middleware/security-headers";
import { toCompressedLoo } from "../../src/services/loo/mappers";
import { dumpEtag, etagMatches, fnv1a32, looEtag } from "../../src/utils/http-cache";

describe("etagMatches", () => {
  const etag = 'W/"dump-1700000000000-42"';

  it("compares weakly, ignoring the W/ prefix on either side", () => {
    expect(etagMatches(etag, etag)).toBe(true);
    expect(etagMatches('"dump-1700000000000-42"', etag)).toBe(true);
    expect(etagMatches(etag, '"dump-1700000000000-42"')).toBe(true);
  });

  it("matches any member of a list, and *", () => {
    expect(etagMatches(`W/"other", ${etag}`, etag)).toBe(true);
    expect(etagMatches(" * ", etag)).toBe(true);
  });

  it("rejects missing or different tags", () => {
    expect(etagMatches(undefined, etag)).toBe(false);
    expect(etagMatches("", etag)).toBe(false);
    expect(etagMatches('W/"dump-1700000000000-43"', etag)).toBe(false);
  });
});

describe("ETag builders", () => {
  it("dumpEtag encodes the dataset version", () => {
    const version = { maxUpdatedAt: 123, count: 4, updatedAtSum: "4560000" };
    expect(dumpEtag(version)).toBe('W/"dump-123-4-4560000"');
    expect(dumpEtag(version, true)).toBe('W/"dump-rich-123-4-4560000"');
  });

  it("dumpEtag changes when only the updated_at sum does", () => {
    // A write to a non-newest row, or an out-of-order commit, leaves max and count alone.
    const before = dumpEtag({ maxUpdatedAt: 123, count: 4, updatedAtSum: "4560000" });
    const after = dumpEtag({ maxUpdatedAt: 123, count: 4, updatedAtSum: "4559000" });
    expect(after).not.toBe(before);
  });

  it("fnv1a32 matches the reference vectors", () => {
    expect(fnv1a32("")).toBe("811c9dc5");
    expect(fnv1a32("a")).toBe("e40c292c");
    expect(fnv1a32("foobar")).toBe("bf9cf968");
  });

  const loo = {
    id: "abc",
    updatedAt: "2026-01-01T00:00:00.123Z",
    name: "Station loo",
    area: [{ name: "Camden", type: "London Borough" }],
  };

  it("looEtag encodes id, updatedAt in epoch ms and a hash of the record", () => {
    expect(looEtag(loo)).toBe(
      `W/"loo-abc-${Date.parse(loo.updatedAt)}-${fnv1a32(JSON.stringify(loo))}"`,
    );
    const never = { id: "abc", updatedAt: null };
    expect(looEtag(never)).toBe(`W/"loo-abc-0-${fnv1a32(JSON.stringify(never))}"`);
  });

  it("looEtag changes when joined area data changes without an updatedAt bump", () => {
    const renamed = { ...loo, area: [{ name: "Camden Town", type: "London Borough" }] };
    expect(looEtag(renamed)).not.toBe(looEtag(loo));
    const noArea = { ...loo, area: [] };
    expect(looEtag(noArea)).not.toBe(looEtag(loo));
    expect(looEtag({ ...loo })).toBe(looEtag(loo));
  });
});

describe("toCompressedLoo", () => {
  const base = {
    id: "id1",
    active: true,
    geohash: "gcpvj0",
    noPayment: true,
    allGender: false,
    automatic: null,
    accessible: true,
    babyChange: false,
    radar: true,
  };

  it("builds the dump tuple", () => {
    // NO_PAYMENT 1 | ACCESSIBLE 8 | RADAR 32
    expect(toCompressedLoo(base)).toEqual(["id1", "gcpvj0", 41]);
  });

  it("is null when the loo is not on the map", () => {
    expect(toCompressedLoo({ ...base, active: false })).toBeNull();
    expect(toCompressedLoo({ ...base, active: null })).toBeNull();
    expect(toCompressedLoo({ ...base, geohash: null })).toBeNull();
  });
});

describe("edge cache middleware", () => {
  const store = new Map<string, Response>();
  let pending: Promise<unknown>[] = [];
  let original: PropertyDescriptor | undefined;

  const ctx = {
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
  });

  const buildApp = () => {
    let calls = 0;
    const app = new Hono();
    app.use("*", securityHeaders({ corsOrigins: ["https://a.example", "https://b.example"] }));
    app.get("/cached", cacheResponse(300), (c) => {
      calls += 1;
      c.header("Set-Cookie", "session=secret");
      c.header("X-RateLimit-Remaining", "9");
      return c.json({ calls });
    });
    app.get("/keyed", async (c) => {
      const hit = await edgeCache.match(c, "https://edge/keyed?v=1", "public, max-age=60");
      if (hit) return hit;
      calls += 1;
      const res = c.json({ calls }, 200, { ETag: 'W/"v1"', "Cache-Control": "public, max-age=60" });
      edgeCache.put(c, "https://edge/keyed?v=1", res, 3600);
      return res;
    });
    return { app, calls: () => calls };
  };

  const get = (app: Hono, path: string, headers: Record<string, string>) =>
    app.fetch(new Request(`https://api.test${path}`, { headers }), {}, ctx);

  it("stores only representation headers and re-applies CORS for each caller", async () => {
    const { app, calls } = buildApp();

    const first = await get(app, "/cached", { Origin: "https://a.example" });
    expect(first.headers.get("Access-Control-Allow-Origin")).toBe("https://a.example");
    await Promise.all(pending);

    const stored = store.get("https://api.test/cached");
    expect(stored).toBeDefined();
    for (const name of stored?.headers.keys() ?? []) {
      expect(name).not.toMatch(/^access-control-|^vary$|^set-cookie$|^x-ratelimit-/);
    }
    expect(stored?.headers.get("cache-control")).toBe("public, max-age=300");

    const second = await get(app, "/cached", { Origin: "https://b.example" });
    expect(calls()).toBe(1);
    expect(second.headers.get("Access-Control-Allow-Origin")).toBe("https://b.example");
    expect(second.headers.get("Vary")).toBe("Origin");
    expect(second.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(second.headers.get("Set-Cookie")).toBeNull();
    expect(second.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await second.json()).toEqual({ calls: 1 });

    const noOrigin = await get(app, "/cached", {});
    expect(noOrigin.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("keyed lookups ignore the caller's If-None-Match and keep the ETag", async () => {
    const { app, calls } = buildApp();
    await get(app, "/keyed", {});
    await Promise.all(pending);

    const hit = await get(app, "/keyed", { "If-None-Match": 'W/"v1"' });
    expect(calls()).toBe(1);
    expect(hit.status).toBe(200);
    expect(hit.headers.get("ETag")).toBe('W/"v1"');
    expect(hit.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(await hit.json()).toEqual({ calls: 1 });
  });
});
