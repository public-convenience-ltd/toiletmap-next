// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { isPlausibleLooId, loadLoo, notFoundResponse } from "./looPage";

const ID = "0123456789abcdef01234567";
const PAGE_URL = new URL(`https://www.toiletmap.org.uk/loos/${ID}`);

/** An env whose service binding answers with `respond` and records each request. */
const envWith = (respond: (request: Request) => Response | Promise<Response>) => {
  const requests: Request[] = [];
  const env = {
    PUBLIC_API_URL: "https://api.example.test",
    API: {
      fetch: (request: Request) => {
        requests.push(request);
        return Promise.resolve().then(() => respond(request));
      },
    },
  };
  return { env, requests };
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadLoo", () => {
  it("fetches GET /api/loos/:id upstream, forwarding the visitor's IP", async () => {
    const { env, requests } = envWith(() => json(200, { id: ID, name: "Victoria Park" }));
    const result = await loadLoo({ env, url: PAGE_URL, id: ID, clientIp: "203.0.113.7" });
    expect(result).toEqual({ kind: "found", loo: { id: ID, name: "Victoria Park" } });
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("GET");
    expect(new URL(requests[0].url).pathname).toBe(`/api/loos/${ID}`);
    expect(requests[0].headers.get("cf-connecting-ip")).toBe("203.0.113.7");
    expect(requests[0].headers.get("x-forwarded-for")).toBe("203.0.113.7");
    // Never the browser's cookies.
    expect(requests[0].headers.get("cookie")).toBeNull();
  });

  it("is not-found for an unknown id (404) or one the API rejects (400)", async () => {
    for (const status of [404, 400]) {
      const { env } = envWith(() => json(status, { message: "nope" }));
      expect(await loadLoo({ env, url: PAGE_URL, id: ID }), String(status)).toEqual({
        kind: "not-found",
      });
    }
  });

  it("does not ask the API about ids that can't exist", async () => {
    const { env, requests } = envWith(() => json(200, {}));
    for (const id of [undefined, "", "a".repeat(65), "../admin", "abc def", "x%2Fy"]) {
      expect(await loadLoo({ env, url: PAGE_URL, id }), String(id)).toEqual({ kind: "not-found" });
    }
    expect(requests).toHaveLength(0);
  });

  it("is unavailable (not a 404) when the API fails or can't be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = envWith(() => json(503, { message: "down" }));
    expect(await loadLoo({ env: failing.env, url: PAGE_URL, id: ID })).toEqual({
      kind: "unavailable",
      status: 503,
    });

    const throwing = envWith(() => {
      throw new Error("network");
    });
    expect(await loadLoo({ env: throwing.env, url: PAGE_URL, id: ID })).toEqual({
      kind: "unavailable",
      status: null,
    });

    const garbage = envWith(() => json(200, ["not", "a", "loo"]));
    expect((await loadLoo({ env: garbage.env, url: PAGE_URL, id: ID })).kind).toBe("unavailable");
  });

  it("gives up after timeoutMs, as unavailable, when the API hangs", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const hung = envWith(() => new Promise<Response>(() => undefined));
    const started = Date.now();
    expect(await loadLoo({ env: hung.env, url: PAGE_URL, id: ID, timeoutMs: 30 })).toEqual({
      kind: "unavailable",
      status: null,
    });
    expect(Date.now() - started).toBeLessThan(2000);
    // The request carried the signal too, so a real fetch is cancelled, not left running.
    expect(hung.requests[0].signal.aborted).toBe(true);
    expect(String(error.mock.calls[0]?.[0])).toContain("timed out after 30 ms");
  });

  it("times out a body that never finishes, too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stalled = envWith(
      () =>
        new Response(new ReadableStream({ start: () => undefined }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    expect(await loadLoo({ env: stalled.env, url: PAGE_URL, id: ID, timeoutMs: 30 })).toEqual({
      kind: "unavailable",
      status: null,
    });
  });

  it("leaves a quick answer alone when there is a timeout", async () => {
    const { env } = envWith(() => json(200, { id: ID, name: "Victoria Park" }));
    expect(await loadLoo({ env, url: PAGE_URL, id: ID, timeoutMs: 1000 })).toEqual({
      kind: "found",
      loo: { id: ID, name: "Victoria Park" },
    });
  });
});

describe("isPlausibleLooId", () => {
  it("accepts API-shaped ids", () => {
    expect(isPlausibleLooId(ID)).toBe(true);
    expect(isPlausibleLooId("abc_DEF-123")).toBe(true);
  });
});

describe("notFoundResponse", () => {
  it("is a body-less 404, so Astro renders the site's 404 page", () => {
    const response = notFoundResponse();
    expect(response.status).toBe(404);
    expect(response.body).toBeNull();
  });
});
