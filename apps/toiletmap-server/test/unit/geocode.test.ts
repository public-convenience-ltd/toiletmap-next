/**
 * `GET /api/geocode`: postcodes.io first for postcodes and outcodes, then
 * Nominatim (GB only, identifying headers, one request per second per
 * isolate), the response shape, caching and upstream failures. Every upstream
 * call goes to a mocked fetch: nothing here touches the network.
 */
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { createGeocodeRouter, GEOCODE_CACHE_CONTROL } from "../../src/routes/geocode";
import {
  createGeocoder,
  GEOCODER_REFERER,
  GEOCODER_USER_AGENT,
  type GeocodeResponse,
  type GeocoderOptions,
  normaliseQuery,
  OSM_ATTRIBUTION,
  toBbox,
} from "../../src/services/geocode/geocode";
import type { AppVariables, Env } from "../../src/types";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const POSTCODE_BODY = {
  status: 200,
  result: {
    postcode: "SW1A 1AA",
    latitude: 51.501009,
    longitude: -0.141588,
    admin_district: "Westminster",
  },
};

const OUTCODE_BODY = {
  status: 200,
  result: {
    outcode: "M1",
    latitude: 53.4798,
    longitude: -2.2366,
    admin_district: ["Manchester"],
  },
};

const NOMINATIM_BODY = [
  {
    place_id: 1,
    lat: "51.5080420",
    lon: "-0.1280050",
    display_name: "Trafalgar Square, St James's, Westminster, London, WC2N 5DS, United Kingdom",
    boundingbox: ["51.5076", "51.5085", "-0.1291", "-0.1270"],
    addresstype: "square",
  },
  { place_id: 2, lat: "not a number", lon: "-0.1", display_name: "Broken" },
  { place_id: 3, lat: "51.5", lon: "-0.12", display_name: "No box, London, United Kingdom" },
];

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
type FetchMock = Mock<FetchFn>;

/** In-memory stand-in for `caches.default`, fresh for every test. */
const installEdgeCache = () => {
  const store = new Map<string, Response>();
  const key = (request: RequestInfo | URL) =>
    typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", {
    value: {
      default: {
        match: (request: RequestInfo | URL) => Promise.resolve(store.get(key(request))?.clone()),
        put: (request: RequestInfo | URL, response: Response) => {
          store.set(key(request), response.clone());
          return Promise.resolve();
        },
      },
    },
    configurable: true,
    writable: true,
  });
  return {
    store,
    restore: () => {
      if (previous) Object.defineProperty(globalThis, "caches", previous);
      else Reflect.deleteProperty(globalThis, "caches");
    },
  };
};

const createContext = () => {
  const tasks: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      tasks.push(promise);
    },
    passThroughOnException: () => undefined,
    props: undefined,
  } as unknown as ExecutionContext;
  return { ctx, settle: () => Promise.allSettled(tasks) };
};

const buildApp = (fetchImpl: FetchMock, options: Omit<GeocoderOptions, "fetchImpl"> = {}) => {
  const app = new Hono<{ Variables: AppVariables; Bindings: Env }>();
  app.route(
    "/api/geocode",
    createGeocodeRouter(
      createGeocoder({ fetchImpl, now: () => 0, sleep: () => Promise.resolve(), ...options }),
    ),
  );
  return app;
};

let edge: ReturnType<typeof installEdgeCache>;
let fetchMock: FetchMock;

beforeEach(() => {
  edge = installEdgeCache();
  fetchMock = vi.fn<FetchFn>();
});

afterEach(() => {
  edge.restore();
});

const search = async (
  app: Hono<{ Variables: AppVariables; Bindings: Env }>,
  q: string | null,
  { mode, env = {} }: { mode?: string; env?: Partial<Record<keyof Env, unknown>> } = {},
) => {
  const { ctx, settle } = createContext();
  const params = new URLSearchParams();
  if (q !== null) params.set("q", q);
  if (mode !== undefined) params.set("mode", mode);
  const query = params.toString();
  const response = await app.request(
    `/api/geocode${query ? `?${query}` : ""}`,
    { headers: { "cf-connecting-ip": "203.0.113.7" } },
    env as Env,
    ctx,
  );
  await settle();
  return response;
};

/** A rate-limit binding stand-in that allows the first `allowed` calls. */
const limiter = (allowed = Number.POSITIVE_INFINITY) => {
  let calls = 0;
  return {
    limit: vi.fn(async (_options: { key: string }) => ({ success: ++calls <= allowed })),
  };
};

const calledUrl = (index = 0) => new URL(String(fetchMock.mock.calls[index]?.[0]));
const calledHeaders = (index = 0) => new Headers(fetchMock.mock.calls[index]?.[1]?.headers);

describe("GET /api/geocode: postcodes", () => {
  it("looks a full postcode up on postcodes.io and returns it as a postcode result", async () => {
    fetchMock.mockResolvedValue(json(POSTCODE_BODY));
    const response = await search(buildApp(fetchMock), " sw1a   1aa ");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(GEOCODE_CACHE_CONTROL);
    expect(await response.json()).toEqual({
      results: [
        { label: "SW1A 1AA, Westminster", lat: 51.501009, lng: -0.141588, kind: "postcode" },
      ],
      attribution: null,
    } satisfies GeocodeResponse);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calledUrl().href).toBe("https://api.postcodes.io/postcodes/SW1A1AA");
    expect(calledHeaders().get("user-agent")).toBe(GEOCODER_USER_AGENT);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("looks an outcode up on /outcodes", async () => {
    fetchMock.mockResolvedValue(json(OUTCODE_BODY));
    const response = await search(buildApp(fetchMock), "m1");

    expect(calledUrl().href).toBe("https://api.postcodes.io/outcodes/M1");
    expect(await response.json()).toEqual({
      results: [{ label: "M1, Manchester", lat: 53.4798, lng: -2.2366, kind: "postcode" }],
      attribution: null,
    });
  });

  it("falls back to Nominatim for a postcode postcodes.io doesn't know", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ status: 404, error: "Postcode not found" }, 404))
      .mockResolvedValueOnce(json(NOMINATIM_BODY));
    const response = await search(buildApp(fetchMock), "ZZ9 9ZZ");

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calledUrl(1).origin).toBe("https://nominatim.openstreetmap.org");
    expect(calledUrl(1).searchParams.get("q")).toBe("zz9 9zz");
    const body = (await response.json()) as GeocodeResponse;
    expect(body.attribution).toBe(OSM_ATTRIBUTION);
    expect(body.results[0]?.kind).toBe("place");
  });

  it("falls back to Nominatim when postcodes.io fails", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ status: 500, error: "oops" }, 500))
      .mockResolvedValueOnce(json(NOMINATIM_BODY));
    const response = await search(buildApp(fetchMock), "SW1A 1AA");

    expect(response.status).toBe(200);
    expect(((await response.json()) as GeocodeResponse).attribution).toBe(OSM_ATTRIBUTION);
  });
});

describe("GET /api/geocode: places", () => {
  it("asks Nominatim for GB results with the app's User-Agent and Referer", async () => {
    fetchMock.mockResolvedValue(json(NOMINATIM_BODY));
    await search(buildApp(fetchMock), "Trafalgar Square");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = calledUrl();
    expect(`${url.origin}${url.pathname}`).toBe("https://nominatim.openstreetmap.org/search");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "trafalgar square",
      format: "jsonv2",
      countrycodes: "gb",
      limit: "5",
      addressdetails: "1",
      "accept-language": "en-GB",
    });
    const headers = calledHeaders();
    expect(headers.get("user-agent")).toBe(GEOCODER_USER_AGENT);
    expect(headers.get("referer")).toBe(GEOCODER_REFERER);
    expect(headers.get("user-agent")).not.toMatch(/@/);
  });

  it("returns the small result shape with the OSM attribution, dropping unusable results", async () => {
    fetchMock.mockResolvedValue(json(NOMINATIM_BODY));
    const response = await search(buildApp(fetchMock), "Trafalgar Square");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(GEOCODE_CACHE_CONTROL);
    expect(await response.json()).toEqual({
      results: [
        {
          label: "Trafalgar Square, St James's, Westminster, London, WC2N 5DS",
          lat: 51.508042,
          lng: -0.128005,
          bbox: [-0.1291, 51.5076, -0.127, 51.5085],
          kind: "place",
        },
        { label: "No box, London", lat: 51.5, lng: -0.12, kind: "place" },
      ],
      attribution: OSM_ATTRIBUTION,
    } satisfies GeocodeResponse);
  });

  it("returns an empty list when nothing matches", async () => {
    fetchMock.mockResolvedValue(json([]));
    const response = await search(buildApp(fetchMock), "zzzzqx");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [], attribution: OSM_ATTRIBUTION });
  });
});

describe("GET /api/geocode: mode=suggest (typing)", () => {
  it("looks postcodes and outcodes up on postcodes.io", async () => {
    fetchMock.mockResolvedValueOnce(json(POSTCODE_BODY)).mockResolvedValueOnce(json(OUTCODE_BODY));
    const app = buildApp(fetchMock);
    const postcode = await search(app, "sw1a 1aa", { mode: "suggest" });
    expect(postcode.status).toBe(200);
    expect(((await postcode.json()) as GeocodeResponse).results[0]?.label).toBe(
      "SW1A 1AA, Westminster",
    );
    const outcode = await search(app, "M1", { mode: "suggest" });
    expect(((await outcode.json()) as GeocodeResponse).results[0]?.label).toBe("M1, Manchester");
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).origin)).toEqual([
      "https://api.postcodes.io",
      "https://api.postcodes.io",
    ]);
  });

  it("never reaches Nominatim: places get no results and no upstream call", async () => {
    const response = await search(buildApp(fetchMock), "Trafalgar Square", { mode: "suggest" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [], attribution: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("doesn't fall back to Nominatim for an unknown postcode", async () => {
    fetchMock.mockResolvedValue(json({ status: 404, error: "Postcode not found" }, 404));
    const response = await search(buildApp(fetchMock), "ZZ9 9ZZ", { mode: "suggest" });
    expect(await response.json()).toEqual({ results: [], attribution: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calledUrl().origin).toBe("https://api.postcodes.io");
  });

  it("answers 502 when postcodes.io fails", async () => {
    fetchMock.mockResolvedValue(json({ status: 500, error: "oops" }, 500));
    const response = await search(buildApp(fetchMock), "SW1A 1AA", { mode: "suggest" });
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches typing and explicit searches separately", async () => {
    fetchMock.mockImplementation(async () => json(NOMINATIM_BODY));
    const app = buildApp(fetchMock);
    await search(app, "Trafalgar Square", { mode: "suggest" });
    const explicit = await search(app, "Trafalgar Square");
    expect(((await explicit.json()) as GeocodeResponse).results).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect([...edge.store.keys()].map((key) => new URL(key).searchParams.get("mode"))).toEqual([
      "suggest",
      "search",
    ]);
  });

  it("rejects an unknown mode", async () => {
    const response = await search(buildApp(fetchMock), "Trafalgar", { mode: "autocomplete" });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/geocode: per-IP limit on explicit searches", () => {
  it("limits explicit searches per client IP under their own key, before any upstream call", async () => {
    fetchMock.mockImplementation(async () => json(NOMINATIM_BODY));
    const perIp = limiter(1);
    const app = buildApp(fetchMock);
    const env = { RATE_LIMIT_WRITE: perIp };
    expect((await search(app, "Trafalgar Square", { env })).status).toBe(200);
    const limited = await search(app, "Leicester Square", { env });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: "rate_limit_exceeded" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(perIp.limit.mock.calls.map(([options]) => options.key)).toEqual([
      "geocode:203.0.113.7",
      "geocode:203.0.113.7",
    ]);
  });

  it("leaves typing (mode=suggest) to the shared read limit", async () => {
    fetchMock.mockImplementation(async () => json(POSTCODE_BODY));
    const perIp = limiter(0);
    const response = await search(buildApp(fetchMock), "SW1A 1AA", {
      mode: "suggest",
      env: { RATE_LIMIT_WRITE: perIp },
    });
    expect(response.status).toBe(200);
    expect(perIp.limit).not.toHaveBeenCalled();
  });
});

describe("GET /api/geocode: validation", () => {
  it.each([
    ["missing", null],
    ["blank", "   "],
    ["one character", " a "],
    ["too long", "x".repeat(201)],
  ])("rejects a %s query with 400 and never calls upstream", async (_label, q) => {
    const response = await search(buildApp(fetchMock), q);
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: "invalid_query" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/geocode: caching", () => {
  it("serves repeated searches for the same normalised query from one upstream call", async () => {
    fetchMock.mockImplementation(async () => json(NOMINATIM_BODY));
    const app = buildApp(fetchMock);

    const first = await search(app, "Trafalgar Square");
    const second = await search(app, "  trafalgar   SQUARE ");

    expect(await second.json()).toEqual(await first.json());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stores results in the edge cache for a day, keyed on the normalised query", async () => {
    fetchMock.mockImplementation(async () => json(NOMINATIM_BODY));
    await search(buildApp(fetchMock), "Trafalgar Square");

    expect(edge.store.size).toBe(1);
    const [key, stored] = [...edge.store.entries()][0] ?? [];
    expect(key).toContain("q=trafalgar%20square");
    expect(stored?.headers.get("cache-control")).toBe("public, max-age=86400");

    // A fresh isolate (new geocoder, empty memory) is answered from the edge cache.
    const otherFetch = vi.fn<FetchFn>();
    const response = await search(buildApp(otherFetch), "TRAFALGAR SQUARE");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(GEOCODE_CACHE_CONTROL);
    expect(((await response.json()) as GeocodeResponse).results).toHaveLength(2);
    expect(otherFetch).not.toHaveBeenCalled();
  });

  it("shares one upstream call between identical searches in flight", async () => {
    let release: (value: Response) => void = () => undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const app = buildApp(fetchMock);
    const both = Promise.all([search(app, "Leeds"), search(app, "leeds")]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    release(json(NOMINATIM_BODY));
    const [a, b] = await both;
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/geocode: Nominatim rate", () => {
  it("spaces Nominatim requests at least a second apart and refuses a long queue", async () => {
    fetchMock.mockImplementation(async () => json([]));
    const waits: number[] = [];
    const app = buildApp(fetchMock, {
      now: () => 10_000,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });

    const responses = await Promise.all(
      ["one", "two", "three", "four", "five"].map((q) => search(app, `place ${q}`)),
    );

    // One request runs, one waits its turn, the rest are refused straight away.
    expect(waits).toEqual([1000]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 503, 503, 503]);
    const busy = responses.find((r) => r.status === 503);
    expect(busy?.status).toBe(503);
    expect(busy?.headers.get("retry-after")).toBe("2");
    expect(busy?.headers.get("cache-control")).toBe("no-store");
    expect(await busy?.json()).toMatchObject({ error: "geocoder_busy" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("takes each Nominatim request from the budget every isolate shares, and refuses when it's gone", async () => {
    fetchMock.mockImplementation(async () => json([]));
    const budget = limiter(1);
    const app = buildApp(fetchMock);
    const env = { RATE_LIMIT_ADMIN: budget };

    expect((await search(app, "place one", { env })).status).toBe(200);
    const refused = await search(app, "place two", { env });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ error: "geocoder_busy" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(budget.limit.mock.calls.map(([options]) => options.key)).toEqual([
      "nominatim",
      "nominatim",
    ]);
  });

  it("doesn't spend the Nominatim budget on postcodes postcodes.io answers, or on typing", async () => {
    fetchMock.mockImplementation(async () => json(POSTCODE_BODY));
    const budget = limiter(0);
    const app = buildApp(fetchMock);
    expect((await search(app, "SW1A 1AA", { env: { RATE_LIMIT_ADMIN: budget } })).status).toBe(200);
    expect(
      (await search(app, "Trafalgar", { mode: "suggest", env: { RATE_LIMIT_ADMIN: budget } }))
        .status,
    ).toBe(200);
    expect(budget.limit).not.toHaveBeenCalled();
  });

  it("does not throttle postcode lookups", async () => {
    fetchMock.mockImplementation(async () => json(POSTCODE_BODY));
    const sleep = vi.fn(() => Promise.resolve());
    const app = buildApp(fetchMock, { sleep });
    await Promise.all([search(app, "SW1A 1AA"), search(app, "SW1A 2AA"), search(app, "SW1A 0AA")]);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("GET /api/geocode: upstream failures", () => {
  it("answers 502 with a JSON error when Nominatim fails, and caches nothing", async () => {
    fetchMock.mockResolvedValue(new Response("Bad gateway", { status: 500 }));
    const app = buildApp(fetchMock);
    const response = await search(app, "Trafalgar Square");

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      message: "Place search is unavailable. Please try again later.",
      error: "geocoder_unavailable",
    });
    expect(edge.store.size).toBe(0);

    fetchMock.mockResolvedValue(json(NOMINATIM_BODY));
    expect((await search(app, "Trafalgar Square")).status).toBe(200);
  });

  it("answers 502 when the upstream times out", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    const response = await search(buildApp(fetchMock), "Trafalgar Square");
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "geocoder_unavailable" });
  });

  it("answers 502 when Nominatim returns something other than a list", async () => {
    fetchMock.mockResolvedValue(json({ error: "Unable to geocode" }));
    const response = await search(buildApp(fetchMock), "Trafalgar Square");
    expect(response.status).toBe(502);
  });

  it("answers 502 when both postcodes.io and Nominatim fail", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const response = await search(buildApp(fetchMock), "SW1A 1AA");
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("geocode helpers", () => {
  it("normalises queries for searching and caching", () => {
    expect(normaliseQuery("  Trafalgar\t\n  SQUARE ")).toBe("trafalgar square");
    expect(normaliseQuery("ＳＷ１Ａ")).toBe("sw1a");
  });

  it("converts Nominatim boxes to [west, south, east, north] and rejects bad ones", () => {
    expect(toBbox(["50", "51", "-1", "0.5"])).toEqual([-1, 50, 0.5, 51]);
    expect(toBbox(["52", "51", "-1", "0"])).toBeUndefined();
    expect(toBbox(["50", "95", "-1", "0"])).toBeUndefined();
    expect(toBbox(["a", "51", "-1", "0"])).toBeUndefined();
    expect(toBbox(undefined)).toBeUndefined();
  });
});
