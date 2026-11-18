// @vitest-environment node
// Routing of the /api/* catch-all (src/pages/api/[...path].ts). The leading
// underscore keeps Astro from treating this file as a route.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL } from "./[...path]";

const ORIGIN = "https://www.toiletmap.org.uk";

let upstream: Request[] = [];

beforeEach(() => {
  upstream = [];
  Object.assign(env, {
    PUBLIC_API_URL: "https://toiletmap-server.example.dev",
    API: {
      fetch: vi.fn((request: Request) => {
        upstream.push(request);
        return Promise.resolve(new Response("{}", { status: 200 }));
      }),
    },
  });
});

afterEach(() => {
  Object.assign(env, { API: undefined });
});

const call = (request: Request) =>
  ALL({
    request,
    cookies: { get: (name: string) => (name === "access_token" ? { value: "secret" } : undefined) },
    clientAddress: "1.2.3.4",
    // biome-ignore lint/suspicious/noExplicitAny: a minimal stand-in for Astro's APIContext
  } as any);

describe("/api/* routing", () => {
  it("sends /api and /api/ to the legacy GraphQL endpoint without the access token", async () => {
    await call(new Request(`${ORIGIN}/api/?query=%7B__typename%7D`));
    await call(
      new Request(`${ORIGIN}/api`, {
        method: "POST",
        headers: { origin: "https://example.com", "content-type": "application/json" },
        body: '{"query":"{ __typename }"}',
      }),
    );
    expect(upstream.map((request) => [request.method, request.url])).toEqual([
      ["GET", "https://toiletmap-server.example.dev/api/graphql?query=%7B__typename%7D"],
      ["POST", "https://toiletmap-server.example.dev/api/graphql"],
    ]);
    for (const request of upstream) {
      expect(request.headers.get("authorization")).toBeNull();
      expect(request.headers.get("cf-connecting-ip")).toBe("1.2.3.4");
    }
  });

  it("keeps the normal proxy rules everywhere else", async () => {
    const res = await call(
      new Request(`${ORIGIN}/api/loos/abc`, {
        method: "PUT",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(200);
    expect(upstream[0]?.url).toBe("https://toiletmap-server.example.dev/api/loos/abc");
    expect(upstream[0]?.headers.get("authorization")).toBe("Bearer secret");

    const crossSite = await call(
      new Request(`${ORIGIN}/api/loos/abc`, {
        method: "PUT",
        headers: { origin: "https://example.com" },
        body: "{}",
      }),
    );
    expect(crossSite.status).toBe(403);

    const docs = await call(new Request(`${ORIGIN}/api/docs`, { method: "GET" }));
    expect(docs.status).toBe(404);
    expect(upstream).toHaveLength(1);

    // The public feedback route goes to /api/feedback, not GraphQL, and never gets the token.
    await call(
      new Request(`${ORIGIN}/api/feedback`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: '{"text":"Great map"}',
      }),
    );
    expect(upstream).toHaveLength(2);
    expect(upstream[1]?.url).toBe("https://toiletmap-server.example.dev/api/feedback");
    expect(upstream[1]?.headers.get("authorization")).toBeNull();
  });
});
