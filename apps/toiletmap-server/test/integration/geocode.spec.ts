/**
 * `GET /api/geocode` through the whole Worker: routing, the shared read rate
 * limiter, CORS and the response contract. Upstream geocoders are mocked (no
 * network calls); the behaviour in detail is covered in
 * test/unit/geocode.test.ts.
 */
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GEOCODE_CACHE_CONTROL } from "../../src/routes/geocode";
import { OSM_ATTRIBUTION } from "../../src/services/geocode/geocode";
import { callApi, createCapturingExecutionContext } from "./utils/test-client";

const IP = "203.0.113.91";
const realFetch = globalThis.fetch;

/** Answers Nominatim and postcodes.io requests; anything else is passed through. */
const mockGeocoders = (nominatimBody: unknown) => {
  const calls: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://nominatim.openstreetmap.org/")) {
      calls.push(url);
      return Promise.resolve(Response.json(nominatimBody));
    }
    if (url.startsWith("https://api.postcodes.io/")) {
      calls.push(url);
      return Promise.resolve(Response.json({ status: 404, error: "Not found" }, { status: 404 }));
    }
    return realFetch(input, init);
  }) as typeof fetch;
  return calls;
};

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A query no other test (or earlier run in this isolate) has cached. */
const uniquePlace = () => `Test place ${randomBytes(4).toString("hex")}`;

const geocode = (q: string, options: Parameters<typeof callApi>[2] = {}, mode?: string) =>
  callApi(
    `/api/geocode?q=${encodeURIComponent(q)}${mode ? `&mode=${mode}` : ""}`,
    {
      headers: { "cf-connecting-ip": IP, origin: "http://localhost:4321" },
    },
    options,
  );

describe("GET /api/geocode", () => {
  it("is public and returns the small result shape with OSM attribution", async () => {
    const calls = mockGeocoders([
      {
        lat: "51.5",
        lon: "-0.12",
        display_name: "Somewhere, London, United Kingdom",
        boundingbox: ["51.4", "51.6", "-0.2", "0"],
      },
    ]);
    const { ctx, settle } = createCapturingExecutionContext();
    const response = await geocode(uniquePlace(), { ctx });
    await settle();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(GEOCODE_CACHE_CONTROL);
    expect(await response.json()).toEqual({
      results: [
        {
          label: "Somewhere, London",
          lat: 51.5,
          lng: -0.12,
          bbox: [-0.2, 51.4, 0, 51.6],
          kind: "place",
        },
      ],
      attribution: OSM_ATTRIBUTION,
    });
    expect(calls).toHaveLength(1);
  });

  it("validates the query before calling anything upstream", async () => {
    const calls = mockGeocoders([]);
    const response = await geocode("x");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_query" });
    expect(calls).toHaveLength(0);
  });

  it("gives explicit searches their own per-IP limit, but not typing", async () => {
    const calls = mockGeocoders([]);
    const perIp = { limit: vi.fn(async () => ({ success: false })) };
    const limited = await geocode(uniquePlace(), { env: { RATE_LIMIT_WRITE: perIp } });
    expect(limited.status).toBe(429);
    expect(perIp.limit).toHaveBeenCalledWith({ key: `geocode:${IP}` });
    expect(calls).toHaveLength(0);

    perIp.limit.mockClear();
    const typing = await geocode(uniquePlace(), { env: { RATE_LIMIT_WRITE: perIp } }, "suggest");
    expect(typing.status).toBe(200);
    expect(await typing.json()).toEqual({ results: [], attribution: null });
    expect(perIp.limit).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("refuses with 503 when the shared Nominatim budget is used up", async () => {
    const calls = mockGeocoders([]);
    const budget = { limit: vi.fn(async () => ({ success: false })) };
    const response = await geocode(uniquePlace(), { env: { RATE_LIMIT_ADMIN: budget } });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "geocoder_busy" });
    expect(budget.limit).toHaveBeenCalledWith({ key: "nominatim" });
    expect(calls).toHaveLength(0);
  });

  it("is limited by the shared read rate limiter", async () => {
    const calls = mockGeocoders([]);
    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    const response = await geocode(uniquePlace(), { env: { RATE_LIMIT_READ: limiter } });
    expect(response.status).toBe(429);
    expect(limiter.limit).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });
});
