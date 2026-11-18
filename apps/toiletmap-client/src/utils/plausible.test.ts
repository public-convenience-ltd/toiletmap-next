// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { isAllowedApiPath } from "./api";
import {
  getPlausibleDomain,
  isTrackedPath,
  PLAUSIBLE_EVENT_PATH,
  PLAUSIBLE_MAX_EVENT_BYTES,
  PLAUSIBLE_SCRIPT_PATH,
  PLAUSIBLE_UPSTREAM_EVENT_URL,
  PLAUSIBLE_UPSTREAM_SCRIPT_URL,
  plausibleScriptTag,
  prefersNoTracking,
  proxyPlausibleEvent,
  proxyPlausibleScript,
  type ScriptCache,
} from "./plausible";

const ORIGIN = "https://www.toiletmap.org.uk";
const ON = { PLAUSIBLE_DOMAIN: "toiletmap.org.uk" };
const OFF = {};

const eventBody = (domain = "toiletmap.org.uk") =>
  JSON.stringify({ n: "pageview", u: `${ORIGIN}/`, d: domain, r: null });

const eventRequest = (init: { body?: string; headers?: Record<string, string> } = {}) =>
  new Request(`${ORIGIN}${PLAUSIBLE_EVENT_PATH}`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "text/plain",
      "user-agent": "Mozilla/5.0 (test)",
      ...init.headers,
    },
    body: init.body ?? eventBody(),
  });

const okFetch = () =>
  vi.fn<(request: Request) => Promise<Response>>(async () => new Response("ok", { status: 202 }));

describe("getPlausibleDomain", () => {
  it("is off when PLAUSIBLE_DOMAIN is unset, blank or not a string", () => {
    expect(getPlausibleDomain({})).toBeNull();
    expect(getPlausibleDomain({ PLAUSIBLE_DOMAIN: "" })).toBeNull();
    expect(getPlausibleDomain({ PLAUSIBLE_DOMAIN: "   " })).toBeNull();
    expect(getPlausibleDomain({ PLAUSIBLE_DOMAIN: 1 })).toBeNull();
  });

  it("is on, trimmed, when set", () => {
    expect(getPlausibleDomain({ PLAUSIBLE_DOMAIN: " toiletmap.org.uk " })).toBe("toiletmap.org.uk");
  });
});

describe("isTrackedPath", () => {
  it.each(["/", "/loos/abc123", "/about", "/posts/some-post", "/feedback", "/cmsx", "/loos/edit"])(
    "tracks %s",
    (path) => {
      expect(isTrackedPath(path)).toBe(true);
    },
  );

  it.each([
    "/cms",
    "/cms/",
    "/cms/index.html",
    "/dev/components",
    "/auth/login",
    "/auth/callback",
    "/admin",
    "/loos/add",
    "/loos/abc123/edit",
    "/loos/abc123/remove",
    "/loos/abc123/report",
  ])("does not track %s", (path) => {
    expect(isTrackedPath(path)).toBe(false);
  });
});

describe("prefersNoTracking", () => {
  it("honours Global Privacy Control and Do Not Track", () => {
    expect(prefersNoTracking(new Headers({ "sec-gpc": "1" }))).toBe(true);
    expect(prefersNoTracking(new Headers({ dnt: "1" }))).toBe(true);
    expect(prefersNoTracking(new Headers({ dnt: "0" }))).toBe(false);
    expect(prefersNoTracking(new Headers())).toBe(false);
  });
});

describe("plausibleScriptTag", () => {
  it("renders nothing when PLAUSIBLE_DOMAIN is unset", () => {
    expect(plausibleScriptTag(OFF, "/", new Headers())).toBeNull();
    expect(plausibleScriptTag({ PLAUSIBLE_DOMAIN: "" }, "/", null)).toBeNull();
  });

  it("points the script and its events at our own origin when set", () => {
    expect(plausibleScriptTag(ON, "/", new Headers())).toEqual({
      src: "/js/p.js",
      "data-domain": "toiletmap.org.uk",
      "data-api": "/api/event",
    });
  });

  it("renders nothing on untracked pages or for GPC / DNT visitors", () => {
    expect(plausibleScriptTag(ON, "/loos/abc/edit", new Headers())).toBeNull();
    expect(plausibleScriptTag(ON, "/", new Headers({ "sec-gpc": "1" }))).toBeNull();
    expect(plausibleScriptTag(ON, "/", new Headers({ dnt: "1" }))).toBeNull();
  });

  it("still renders on prerendered pages (no request headers)", () => {
    expect(plausibleScriptTag(ON, "/about", null)?.src).toBe(PLAUSIBLE_SCRIPT_PATH);
  });
});

describe("proxyPlausibleEvent", () => {
  it("is a 404 and contacts nobody when PLAUSIBLE_DOMAIN is unset", async () => {
    const fetchImpl = okFetch();
    const response = await proxyPlausibleEvent({
      env: OFF,
      request: eventRequest(),
      clientIp: "203.0.113.7",
      fetchImpl,
    });
    expect(response.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("forwards the event to plausible.io with the visitor's IP and User-Agent", async () => {
    const fetchImpl = okFetch();
    const response = await proxyPlausibleEvent({
      env: ON,
      request: eventRequest({
        headers: {
          cookie: "access_token=secret; user_info=x",
          referer: `${ORIGIN}/loos/abc`,
          "x-forwarded-for": "198.51.100.1",
          authorization: "Bearer nope",
        },
      }),
      clientIp: "203.0.113.7",
      fetchImpl,
    });

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const forwarded = fetchImpl.mock.calls[0][0];
    expect(forwarded.url).toBe(PLAUSIBLE_UPSTREAM_EVENT_URL);
    expect(forwarded.method).toBe("POST");
    // The visitor's IP from cf-connecting-ip, never the browser's own X-Forwarded-For.
    expect(forwarded.headers.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(forwarded.headers.get("user-agent")).toBe("Mozilla/5.0 (test)");
    expect(forwarded.headers.get("content-type")).toBe("text/plain");
    expect(forwarded.headers.get("cookie")).toBeNull();
    expect(forwarded.headers.get("referer")).toBeNull();
    expect(forwarded.headers.get("authorization")).toBeNull();
    expect(await forwarded.text()).toBe(eventBody());
  });

  it("drops events from GPC / DNT visitors without forwarding them", async () => {
    const optOuts: Record<string, string>[] = [{ "sec-gpc": "1" }, { dnt: "1" }];
    for (const headers of optOuts) {
      const fetchImpl = okFetch();
      const response = await proxyPlausibleEvent({
        env: ON,
        request: eventRequest({ headers }),
        clientIp: "203.0.113.7",
        fetchImpl,
      });
      expect(response.status).toBe(202);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("refuses events for another site's domain (not an open relay)", async () => {
    const fetchImpl = okFetch();
    const response = await proxyPlausibleEvent({
      env: ON,
      request: eventRequest({ body: eventBody("example.com") }),
      clientIp: "203.0.113.7",
      fetchImpl,
    });
    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();

    const notJson = await proxyPlausibleEvent({
      env: ON,
      request: eventRequest({ body: "hello" }),
      clientIp: null,
      fetchImpl,
    });
    expect(notJson.status).toBe(400);
  });

  it("refuses other origins, other methods and oversized bodies", async () => {
    const fetchImpl = okFetch();
    const crossSite = await proxyPlausibleEvent({
      env: ON,
      request: eventRequest({ headers: { origin: "https://evil.example" } }),
      clientIp: null,
      fetchImpl,
    });
    expect(crossSite.status).toBe(403);

    const get = await proxyPlausibleEvent({
      env: ON,
      request: new Request(`${ORIGIN}${PLAUSIBLE_EVENT_PATH}`),
      clientIp: null,
      fetchImpl,
    });
    expect(get.status).toBe(405);

    const huge = await proxyPlausibleEvent({
      env: ON,
      request: eventRequest({ body: "x".repeat(PLAUSIBLE_MAX_EVENT_BYTES + 1) }),
      clientIp: null,
      fetchImpl,
    });
    expect(huge.status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts a same-origin event with no Origin header", async () => {
    const fetchImpl = okFetch();
    const request = new Request(`${ORIGIN}${PLAUSIBLE_EVENT_PATH}`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: eventBody(),
    });
    const response = await proxyPlausibleEvent({ env: ON, request, clientIp: null, fetchImpl });
    expect(response.status).toBe(202);
    expect(fetchImpl.mock.calls[0][0].headers.get("x-forwarded-for")).toBeNull();
  });

  it("answers 502 when plausible.io is unreachable", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await proxyPlausibleEvent({
      env: ON,
      request: eventRequest(),
      clientIp: null,
      fetchImpl: () => Promise.reject(new Error("network")),
    });
    expect(response.status).toBe(502);
    error.mockRestore();
  });
});

describe("proxyPlausibleScript", () => {
  const scriptRequest = (method = "GET") =>
    new Request(`${ORIGIN}${PLAUSIBLE_SCRIPT_PATH}?v=1`, { method });

  const memoryCache = () => {
    const store = new Map<string, Response>();
    const cache: ScriptCache = {
      match: async (request) => store.get(request.url)?.clone(),
      put: (request, response) => {
        store.set(request.url, response);
        return Promise.resolve();
      },
    };
    return { cache, store };
  };

  it("is a 404 and contacts nobody when PLAUSIBLE_DOMAIN is unset", async () => {
    const fetchImpl = vi.fn(async () => new Response("script"));
    const response = await proxyPlausibleScript({ env: OFF, request: scriptRequest(), fetchImpl });
    expect(response.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("serves Plausible's script from our origin and caches it", async () => {
    const fetchImpl = vi.fn(async (_request: Request) => new Response("/* plausible */"));
    const { cache, store } = memoryCache();

    const first = await proxyPlausibleScript({
      env: ON,
      request: scriptRequest(),
      fetchImpl,
      cache,
    });
    expect(first.status).toBe(200);
    expect(await first.text()).toBe("/* plausible */");
    expect(first.headers.get("content-type")).toContain("javascript");
    expect(first.headers.get("cache-control")).toMatch(/^public, max-age=\d+$/);
    expect(fetchImpl.mock.calls[0][0].url).toBe(PLAUSIBLE_UPSTREAM_SCRIPT_URL);
    // Keyed on the path, so a query string can't fill the cache.
    expect([...store.keys()]).toEqual([`${ORIGIN}${PLAUSIBLE_SCRIPT_PATH}`]);

    const second = await proxyPlausibleScript({
      env: ON,
      request: scriptRequest(),
      fetchImpl,
      cache,
    });
    expect(await second.text()).toBe("/* plausible */");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("answers 502 when plausible.io fails, and refuses non-GET methods", async () => {
    const failing = await proxyPlausibleScript({
      env: ON,
      request: scriptRequest(),
      fetchImpl: async () => new Response("down", { status: 500 }),
    });
    expect(failing.status).toBe(502);

    const post = await proxyPlausibleScript({ env: ON, request: scriptRequest("POST") });
    expect(post.status).toBe(405);
  });
});

describe("routing and wiring", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

  it("/api/event has its own static route, so the generic /api proxy never sees it", () => {
    // Astro ranks a static route above a rest parameter, so /api/event.ts wins over
    // /api/[...path].ts. And even if it didn't, the generic proxy would 404 it.
    expect(existsSync(new URL("../pages/api/event.ts", import.meta.url))).toBe(true);
    expect(isAllowedApiPath(PLAUSIBLE_EVENT_PATH)).toBe(false);
  });

  it("/js/p.js has its own route", () => {
    expect(existsSync(new URL("../pages/js/p.js.ts", import.meta.url))).toBe(true);
  });

  it("every page gets the (conditional) analytics tag from the shared document layout", () => {
    expect(read("../layouts/BaseLayout.astro")).toContain("<Analytics />");
    // Rendered only when plausibleScriptTag returns a tag; inline so Astro doesn't bundle it.
    expect(read("../components/Analytics.astro")).toMatch(/\{tag && <script is:inline defer/);
  });
});
