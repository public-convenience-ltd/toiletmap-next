// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ApiEnv,
  fetchApi,
  getUpstreamApiUrl,
  isAllowedApiPath,
  isLegacyGraphqlPath,
  LEGACY_GRAPHQL_MAX_BODY_BYTES,
  PROXY_MAX_BODY_BYTES,
  proxyApiRequest,
  proxyLegacyGraphqlRequest,
} from "./api";

const ORIGIN = "https://www.toiletmap.org.uk";

const makeBinding = (response: () => Response = () => new Response("{}", { status: 200 })) => {
  const calls: Request[] = [];
  const binding = {
    fetch: vi.fn((req: Request) => {
      calls.push(req);
      return Promise.resolve(response());
    }),
  };
  return { binding, calls };
};

const envWith = (api?: ApiEnv["API"]): ApiEnv => ({
  PUBLIC_API_URL: "https://toiletmap-server.example.dev",
  API: api,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getUpstreamApiUrl", () => {
  it("uses PUBLIC_API_URL for production and local hosts", () => {
    const env = envWith();
    expect(getUpstreamApiUrl(env, new URL(ORIGIN))).toBe("https://toiletmap-server.example.dev");
    expect(getUpstreamApiUrl(env, new URL("http://localhost:4321/"))).toBe(
      "https://toiletmap-server.example.dev",
    );
  });

  it("maps preview client hosts to the matching preview server", () => {
    expect(
      getUpstreamApiUrl(
        envWith(),
        new URL("https://feat-x-toiletmap-client.gbtoiletmap.workers.dev/"),
      ),
    ).toBe("https://feat-x-toiletmap-server.gbtoiletmap.workers.dev");
  });
});

describe("fetchApi", () => {
  it("uses the service binding when present", async () => {
    const { binding, calls } = makeBinding();
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);

    await fetchApi(envWith(binding), new URL(ORIGIN), "/api/loos/abc");

    expect(globalFetch).not.toHaveBeenCalled();
    expect(calls[0]?.url).toBe("https://toiletmap-server.example.dev/api/loos/abc");
  });

  it("falls back to fetching PUBLIC_API_URL", async () => {
    const globalFetch = vi.fn((_input: Request) => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", globalFetch);

    await fetchApi(envWith(), new URL("http://localhost:4321/x"), "api/loos/abc?x=1");

    const req = globalFetch.mock.calls[0]?.[0];
    expect(req?.url).toBe("https://toiletmap-server.example.dev/api/loos/abc?x=1");
  });
});

describe("isAllowedApiPath", () => {
  it("allows exactly the loos endpoints the browser uses", () => {
    for (const path of [
      "/api/loos",
      "/api/loos/",
      "/api/loos/dump",
      "/api/loos/updates",
      "/api/loos/abc123",
    ]) {
      expect(isAllowedApiPath(path), path).toBe(true);
    }
  });

  it("rejects other upstream paths", () => {
    for (const path of [
      "/api/docs",
      "/api/docs/",
      "/api/openapi.json",
      "/api/admin",
      "/api/areas",
      "/api/looss",
      "/api/loosX/abc",
      "/api",
      "/api/",
      "/admin",
      "/",
    ]) {
      expect(isAllowedApiPath(path), path).toBe(false);
    }
  });

  it("rejects traversal, encoded separators, backslashes and empty segments", () => {
    for (const path of [
      "/api/loos/../docs",
      "/api/loos/./dump",
      "/api/loos/%2e%2e/docs",
      "/api/loos/.%2E/docs",
      "/api/loos/%2E",
      "/api/loos/..%2fdocs",
      "/api/loos/..%2Fdocs",
      "/api/loos/abc%2fdef",
      "/api/loos/..%5cdocs",
      "/api/loos/abc%5Cdef",
      "/api/loos\\..\\docs",
      "/api/loos//dump",
      "//api/loos",
      "/api/loos/%E0%A4%A",
    ]) {
      expect(isAllowedApiPath(path), path).toBe(false);
    }
  });
});

describe("proxyApiRequest", () => {
  it("forwards GET with query string and allow-listed headers, but never cookies or auth", async () => {
    const { binding, calls } = makeBinding();
    const request = new Request(`${ORIGIN}/api/loos/updates?since=2024-01-01`, {
      headers: {
        accept: "application/json",
        "if-none-match": '"etag-1"',
        cookie: "access_token=secret; user_info=abc",
        "x-forwarded-for": "6.6.6.6",
      },
    });

    await proxyApiRequest({
      request,
      env: envWith(binding),
      accessToken: "secret",
      clientIp: "1.2.3.4",
    });

    const upstream = calls[0];
    expect(upstream?.url).toBe(
      "https://toiletmap-server.example.dev/api/loos/updates?since=2024-01-01",
    );
    expect(upstream?.method).toBe("GET");
    expect(upstream?.headers.get("accept")).toBe("application/json");
    expect(upstream?.headers.get("if-none-match")).toBe('"etag-1"');
    expect(upstream?.headers.get("cookie")).toBeNull();
    expect(upstream?.headers.get("authorization")).toBeNull();
    expect(upstream?.headers.get("cf-connecting-ip")).toBe("1.2.3.4");
    expect(upstream?.headers.get("x-forwarded-for")).toBe("1.2.3.4");
  });

  it("returns 404 JSON for non-allow-listed paths without contacting upstream", async () => {
    const { binding } = makeBinding();
    for (const path of [
      "/api/docs",
      "/api/loos/..%2fdocs",
      "/api/loos//dump",
      "/api/loos/%2e%2e/docs",
      "/api/loos/..\\docs",
    ]) {
      const res = await proxyApiRequest({
        request: new Request(`${ORIGIN}${path}`),
        env: envWith(binding),
      });
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual({ message: "Not Found" });
      expect(res.headers.get("content-security-policy")).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
    expect(binding.fetch).not.toHaveBeenCalled();
  });

  it("replaces upstream CSP with a strict policy and sets nosniff", async () => {
    const { binding } = makeBinding(
      () =>
        new Response("{}", {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-security-policy": "default-src * 'unsafe-inline' 'unsafe-eval'",
            "content-security-policy-report-only": "default-src *",
          },
        }),
    );
    const res = await proxyApiRequest({
      request: new Request(`${ORIGIN}/api/loos/dump`),
      env: envWith(binding),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(res.headers.get("content-security-policy-report-only")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("rejects state-changing requests without a matching Origin", async () => {
    const { binding } = makeBinding();
    for (const origin of [null, "https://evil.example", "http://www.toiletmap.org.uk"]) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (origin) headers.origin = origin;
      const res = await proxyApiRequest({
        request: new Request(`${ORIGIN}/api/loos/abc`, { method: "PUT", headers, body: "{}" }),
        env: envWith(binding),
        accessToken: "secret",
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ message: "Forbidden" });
    }
    expect(binding.fetch).not.toHaveBeenCalled();
  });

  it("forwards same-origin mutations with body and the bearer token from the cookie", async () => {
    const { binding, calls } = makeBinding(() => new Response('{"id":"abc"}', { status: 201 }));
    const body = JSON.stringify({ name: "Test", baseUpdatedAt: "2024-01-01T00:00:00.000Z" });

    const res = await proxyApiRequest({
      request: new Request(`${ORIGIN}/api/loos/abc`, {
        method: "PUT",
        headers: { origin: ORIGIN, "content-type": "application/json", "if-match": "W/1" },
        body,
      }),
      env: envWith(binding),
      accessToken: "secret",
    });

    expect(res.status).toBe(201);
    const upstream = calls[0];
    expect(upstream?.method).toBe("PUT");
    expect(upstream?.headers.get("authorization")).toBe("Bearer secret");
    expect(upstream?.headers.get("content-type")).toBe("application/json");
    expect(upstream?.headers.get("if-match")).toBe("W/1");
    expect(await upstream?.text()).toBe(body);
  });

  it("refuses an oversized body with 413 without contacting upstream", async () => {
    const { binding } = makeBinding();
    const res = await proxyApiRequest({
      request: new Request(`${ORIGIN}/api/loos`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: "x".repeat(PROXY_MAX_BODY_BYTES + 1),
      }),
      env: envWith(binding),
      accessToken: "secret",
    });
    expect(res.status).toBe(413);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(binding.fetch).not.toHaveBeenCalled();
  });

  it("stops reading a chunked mutation body once it passes the limit", async () => {
    const { binding } = makeBinding();
    const chunk = new Uint8Array(16 * 1024);
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 1_000) controller.close();
        else controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request(`${ORIGIN}/api/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(request.headers.get("content-length")).toBeNull();

    const res = await proxyApiRequest({ request, env: envWith(binding) });
    expect(res.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulled * chunk.byteLength).toBeLessThan(PROXY_MAX_BODY_BYTES * 2);
    expect(binding.fetch).not.toHaveBeenCalled();
  });

  it("forwards anonymous mutations without an Authorization header", async () => {
    const { binding, calls } = makeBinding();
    await proxyApiRequest({
      request: new Request(`${ORIGIN}/api/loos`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: "{}",
      }),
      env: envWith(binding),
      accessToken: null,
    });
    expect(calls[0]?.headers.get("authorization")).toBeNull();
  });

  it("passes OPTIONS and HEAD without an Origin check", async () => {
    const { binding, calls } = makeBinding(() => new Response(null, { status: 204 }));
    const opt = await proxyApiRequest({
      request: new Request(`${ORIGIN}/api/loos`, { method: "OPTIONS" }),
      env: envWith(binding),
    });
    expect(opt.status).toBe(204);
    const head = await proxyApiRequest({
      request: new Request(`${ORIGIN}/api/loos/dump`, { method: "HEAD" }),
      env: envWith(binding),
    });
    expect(head.status).toBe(204);
    expect(calls.map((c) => c.method)).toEqual(["OPTIONS", "HEAD"]);
  });

  it("returns upstream status, body and cache headers but strips cookies and CORS headers", async () => {
    const { binding } = makeBinding(
      () =>
        new Response(JSON.stringify({ error: "conflict" }), {
          status: 409,
          headers: {
            "content-type": "application/json",
            "cache-control": "public, max-age=60",
            etag: '"v2"',
            "set-cookie": "session=upstream; Path=/",
            "access-control-allow-origin": ORIGIN,
            "access-control-allow-credentials": "true",
          },
        }),
    );

    const res = await proxyApiRequest({
      request: new Request(`${ORIGIN}/api/loos/abc`, {
        method: "PUT",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: "{}",
      }),
      env: envWith(binding),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "conflict" });
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("etag")).toBe('"v2"');
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("passes a 304 through with no body", async () => {
    const { binding } = makeBinding(
      () => new Response(null, { status: 304, headers: { etag: '"v1"' } }),
    );
    const res = await proxyApiRequest({
      request: new Request(`${ORIGIN}/api/loos/dump`, { headers: { "if-none-match": '"v1"' } }),
      env: envWith(binding),
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe('"v1"');
  });

  it("returns 502 when upstream is unreachable", async () => {
    const binding = {
      fetch: vi.fn(() => Promise.reject(new Error("boom"))),
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await proxyApiRequest({
      request: new Request(`${ORIGIN}/api/loos/dump`),
      env: envWith(binding),
    });
    expect(res.status).toBe(502);
    errorSpy.mockRestore();
  });
});

describe("isLegacyGraphqlPath", () => {
  it("matches exactly /api and /api/", () => {
    expect(isLegacyGraphqlPath("/api")).toBe(true);
    expect(isLegacyGraphqlPath("/api/")).toBe(true);
    for (const path of [
      "/api/feedback",
      "/api/graphql",
      "/api//",
      "/api/loos",
      "/api%2f",
      "/apis",
      "/",
    ]) {
      expect(isLegacyGraphqlPath(path), path).toBe(false);
    }
  });
});

describe("proxyLegacyGraphqlRequest", () => {
  /** The Flutter app's request: Dart only escapes spaces and braces. */
  const FLUTTER_SEARCH =
    "?query=%7BloosByProximity(from:%20%7Blat:%2052.7077,%20lng:%20-2.754,%20maxDistance:%202000%7D)%7B%20id%20name%20active%20location%7Blat%20lng%7D%7D%7D";

  it("forwards the Flutter GET to /api/graphql with the query string untouched", async () => {
    const { binding, calls } = makeBinding();
    for (const path of ["/api/", "/api"]) {
      await proxyLegacyGraphqlRequest({
        request: new Request(`${ORIGIN}${path}${FLUTTER_SEARCH}`, {
          headers: { "user-agent": "Dart/3.5 (dart:io)" },
        }),
        env: envWith(binding),
        clientIp: "1.2.3.4",
      });
    }
    expect(calls.map((call) => call.url)).toEqual([
      `https://toiletmap-server.example.dev/api/graphql${FLUTTER_SEARCH}`,
      `https://toiletmap-server.example.dev/api/graphql${FLUTTER_SEARCH}`,
    ]);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("user-agent")).toBe("Dart/3.5 (dart:io)");
  });

  it("never forwards cookies or credentials, and preserves the client IP", async () => {
    const { binding, calls } = makeBinding();
    await proxyLegacyGraphqlRequest({
      request: new Request(`${ORIGIN}/api/?query=%7B__typename%7D`, {
        headers: {
          cookie: "access_token=secret; user_info=abc",
          authorization: "Bearer from-the-caller",
          "x-forwarded-for": "6.6.6.6",
        },
      }),
      env: envWith(binding),
      clientIp: "1.2.3.4",
    });
    const upstream = calls[0];
    expect(upstream?.headers.get("cookie")).toBeNull();
    expect(upstream?.headers.get("authorization")).toBeNull();
    expect(upstream?.headers.get("cf-connecting-ip")).toBe("1.2.3.4");
    expect(upstream?.headers.get("x-forwarded-for")).toBe("1.2.3.4");
  });

  it("forwards cross-origin POSTs without the CSRF Origin check", async () => {
    const { binding, calls } = makeBinding();
    const body = JSON.stringify({ query: "{ areas { name } }" });
    const res = await proxyLegacyGraphqlRequest({
      request: new Request(`${ORIGIN}/api`, {
        method: "POST",
        headers: {
          origin: "https://explorer.toiletmap.org.uk",
          "content-type": "application/json",
          accept: "application/graphql-response+json",
          cookie: "access_token=secret",
        },
        body,
      }),
      env: envWith(binding),
    });
    expect(res.status).toBe(200);
    const upstream = calls[0];
    expect(upstream?.url).toBe("https://toiletmap-server.example.dev/api/graphql");
    expect(upstream?.method).toBe("POST");
    expect(upstream?.headers.get("origin")).toBe("https://explorer.toiletmap.org.uk");
    expect(upstream?.headers.get("content-type")).toBe("application/json");
    expect(upstream?.headers.get("accept")).toBe("application/graphql-response+json");
    expect(upstream?.headers.get("cookie")).toBeNull();
    expect(upstream?.headers.get("authorization")).toBeNull();
    expect(await upstream?.text()).toBe(body);
  });

  it("passes preflights through and keeps upstream CORS headers, but not cookies", async () => {
    const { binding, calls } = makeBinding(
      () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "https://explorer.toiletmap.org.uk",
            "access-control-allow-methods": "GET,HEAD,POST",
            "access-control-allow-headers": "content-type",
            vary: "Origin, Access-Control-Request-Headers",
            "set-cookie": "x=y",
          },
        }),
    );
    const res = await proxyLegacyGraphqlRequest({
      request: new Request(`${ORIGIN}/api`, {
        method: "OPTIONS",
        headers: {
          origin: "https://explorer.toiletmap.org.uk",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      }),
      env: envWith(binding),
    });
    expect(calls[0]?.method).toBe("OPTIONS");
    expect(calls[0]?.headers.get("access-control-request-method")).toBe("POST");
    expect(calls[0]?.headers.get("access-control-request-headers")).toBe("content-type");
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://explorer.toiletmap.org.uk",
    );
    expect(res.headers.get("access-control-allow-methods")).toBe("GET,HEAD,POST");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("relays upstream status, cache and deprecation headers", async () => {
    const { binding } = makeBinding(
      () =>
        new Response('{"data":{"__typename":"Query"}}', {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=60",
            "access-control-allow-origin": "*",
            deprecation: "true",
          },
        }),
    );
    const res = await proxyLegacyGraphqlRequest({
      request: new Request(`${ORIGIN}/api/?query=%7B__typename%7D`),
      env: envWith(binding),
    });
    expect(await res.json()).toEqual({ data: { __typename: "Query" } });
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("deprecation")).toBe("true");
  });

  it("refuses other methods and oversized bodies without contacting upstream", async () => {
    const { binding } = makeBinding();
    const put = await proxyLegacyGraphqlRequest({
      request: new Request(`${ORIGIN}/api`, { method: "PUT", body: "{}" }),
      env: envWith(binding),
    });
    expect(put.status).toBe(405);
    expect(put.headers.get("allow")).toBe("GET, POST");

    const big = await proxyLegacyGraphqlRequest({
      request: new Request(`${ORIGIN}/api`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(LEGACY_GRAPHQL_MAX_BODY_BYTES + 1),
      }),
      env: envWith(binding),
    });
    expect(big.status).toBe(413);
    expect(big.headers.get("access-control-allow-origin")).toBe("*");
    expect(put.headers.get("access-control-allow-origin")).toBe("*");
    expect(binding.fetch).not.toHaveBeenCalled();
  });

  it("stops reading a chunked body without Content-Length once it passes the limit", async () => {
    const { binding } = makeBinding();
    const chunk = new Uint8Array(16 * 1024);
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        // Far more than the limit if read to the end.
        if (pulled > 1_000) controller.close();
        else controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request(`${ORIGIN}/api`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(request.headers.get("content-length")).toBeNull();

    const res = await proxyLegacyGraphqlRequest({ request, env: envWith(binding) });
    expect(res.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulled * chunk.byteLength).toBeLessThan(LEGACY_GRAPHQL_MAX_BODY_BYTES * 2);
    expect(binding.fetch).not.toHaveBeenCalled();
  });

  it("forwards a chunked body within the limit unchanged", async () => {
    const { binding, calls } = makeBinding();
    const text = JSON.stringify({ query: "{ __typename }" });
    const bytes = new TextEncoder().encode(text);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 5));
        controller.enqueue(bytes.slice(5));
        controller.close();
      },
    });
    const res = await proxyLegacyGraphqlRequest({
      request: new Request(`${ORIGIN}/api`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: stream,
        duplex: "half",
      } as RequestInit),
      env: envWith(binding),
    });
    expect(res.status).toBe(200);
    expect(await calls[0]?.text()).toBe(text);
  });

  it("only handles the legacy paths; /api/feedback is not routed to GraphQL", async () => {
    const { binding } = makeBinding();
    const res = await proxyLegacyGraphqlRequest({
      request: new Request(`${ORIGIN}/api/feedback`, { method: "POST", body: "{}" }),
      env: envWith(binding),
    });
    expect(res.status).toBe(404);
    expect(binding.fetch).not.toHaveBeenCalled();
  });
});

describe("public feedback endpoint (/api/feedback)", () => {
  const FEEDBACK_URL = `${ORIGIN}/api/feedback`;
  const formBody = "text=Great+map&email=&route=Toilet+Map+2.0+Android";

  it("is allow-listed as an exact path only", () => {
    expect(isAllowedApiPath("/api/feedback")).toBe(true);
    for (const path of [
      "/api/feedback/",
      "/api/feedback/1",
      "/api/feedbacks",
      "/api/feedback/../docs",
      "/api/feedback%2f..",
    ]) {
      expect(isAllowedApiPath(path), path).toBe(false);
    }
  });

  it("forwards a same-origin browser POST without the access token", async () => {
    const { binding, calls } = makeBinding(() => new Response('{"ok":true}', { status: 200 }));
    const body = JSON.stringify({ text: "Great map", route: "/feedback" });
    const res = await proxyApiRequest({
      request: new Request(FEEDBACK_URL, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
        },
        body,
      }),
      env: envWith(binding),
      accessToken: "secret",
      clientIp: "1.2.3.4",
    });

    expect(res.status).toBe(200);
    const upstream = calls[0];
    expect(upstream?.url).toBe("https://toiletmap-server.example.dev/api/feedback");
    expect(upstream?.method).toBe("POST");
    expect(upstream?.headers.get("authorization")).toBeNull();
    expect(upstream?.headers.get("cf-connecting-ip")).toBe("1.2.3.4");
    expect(await upstream?.text()).toBe(body);
  });

  it("forwards the Flutter app's form POST, which has no Origin header", async () => {
    const { binding, calls } = makeBinding(() => new Response('{"ok":true}', { status: 200 }));
    const res = await proxyApiRequest({
      request: new Request(FEEDBACK_URL, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=utf-8",
          "user-agent": "Dart/3.5 (dart:io)",
        },
        body: formBody,
      }),
      env: envWith(binding),
      accessToken: "secret",
      clientIp: "5.6.7.8",
    });

    expect(res.status).toBe(200);
    const upstream = calls[0];
    expect(upstream?.headers.get("content-type")).toBe(
      "application/x-www-form-urlencoded; charset=utf-8",
    );
    expect(upstream?.headers.get("authorization")).toBeNull();
    expect(upstream?.headers.get("cf-connecting-ip")).toBe("5.6.7.8");
    expect(await upstream?.text()).toBe(formBody);
  });

  it("still rejects cross-origin browser POSTs", async () => {
    const { binding } = makeBinding();
    const cases: Record<string, string>[] = [
      { origin: "https://evil.example" },
      { origin: "null" },
      { origin: "http://www.toiletmap.org.uk" },
      // No Origin, but the browser says it is cross-site or same-site.
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
    ];
    for (const extra of cases) {
      const res = await proxyApiRequest({
        request: new Request(FEEDBACK_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", ...extra },
          body: formBody,
        }),
        env: envWith(binding),
      });
      expect(res.status, JSON.stringify(extra)).toBe(403);
    }
    expect(binding.fetch).not.toHaveBeenCalled();
  });

  it("allows a missing Origin only for POST to the public path", async () => {
    const { binding } = makeBinding();
    const noOrigin = (url: string, method: string) =>
      proxyApiRequest({
        request: new Request(url, {
          method,
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
        env: envWith(binding),
        accessToken: "secret",
      });

    expect((await noOrigin(FEEDBACK_URL, "PUT")).status).toBe(403);
    expect((await noOrigin(FEEDBACK_URL, "DELETE")).status).toBe(403);
    expect((await noOrigin(`${ORIGIN}/api/loos`, "POST")).status).toBe(403);
    expect((await noOrigin(`${ORIGIN}/api/loos/abc/report`, "POST")).status).toBe(403);
    expect(binding.fetch).not.toHaveBeenCalled();
  });

  it("allows a missing Origin when the browser reports a same-origin or user-initiated request", async () => {
    const { binding, calls } = makeBinding();
    for (const site of ["same-origin", "none"]) {
      await proxyApiRequest({
        request: new Request(FEEDBACK_URL, {
          method: "POST",
          headers: { "content-type": "application/json", "sec-fetch-site": site },
          body: "{}",
        }),
        env: envWith(binding),
      });
    }
    expect(calls).toHaveLength(2);
  });
});

describe("public place search (/api/geocode)", () => {
  const GEOCODE_URL = `${ORIGIN}/api/geocode?q=Leeds`;

  it("is allow-listed as an exact path only", () => {
    expect(isAllowedApiPath("/api/geocode")).toBe(true);
    for (const path of [
      "/api/geocode/",
      "/api/geocode/x",
      "/api/geocoder",
      "/api/geocode/../docs",
    ]) {
      expect(isAllowedApiPath(path), path).toBe(false);
    }
  });

  it("forwards a GET with its query string, client IP and cache headers, never the token", async () => {
    const { binding, calls } = makeBinding(
      () =>
        new Response('{"results":[],"attribution":null}', {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "public, max-age=86400",
          },
        }),
    );
    const res = await proxyApiRequest({
      request: new Request(GEOCODE_URL, { headers: { accept: "application/json" } }),
      env: envWith(binding),
      accessToken: "secret",
      clientIp: "1.2.3.4",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    const upstream = calls[0];
    expect(upstream?.url).toBe("https://toiletmap-server.example.dev/api/geocode?q=Leeds");
    expect(upstream?.method).toBe("GET");
    expect(upstream?.headers.get("authorization")).toBeNull();
    expect(upstream?.headers.get("cf-connecting-ip")).toBe("1.2.3.4");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "refuses %s with 405 without contacting upstream",
    async (method) => {
      const { binding, calls } = makeBinding();
      const res = await proxyApiRequest({
        request: new Request(GEOCODE_URL, { method, headers: { origin: ORIGIN }, body: "{}" }),
        env: envWith(binding),
        accessToken: "secret",
      });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, HEAD");
      expect(calls).toHaveLength(0);
    },
  );
});
