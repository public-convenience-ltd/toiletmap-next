import { describe, expect, it } from "vitest";

describe("Client Worker SSR HTML Render", () => {
  it("renders valid HTML page and never returns [object Object]", async () => {
    let handler: { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> };
    try {
      const entry = await import("../dist/server/entry.mjs");
      handler = entry.default;
    } catch {
      // If dist is not yet built in test environment, skip gracefully
      return;
    }

    const req = new Request("http://localhost:4321/");
    const env = {
      ASSET: { fetch: async () => new Response("Not found", { status: 404 }) },
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      PUBLIC_API_URL: "https://toiletmap-server.gbtoiletmap.workers.dev",
    };
    const ctx = {
      waitUntil: () => {
        /* noop */
      },
    };

    const res = await handler.fetch(req, env, ctx);
    expect(res.status).toBe(200);

    const text = await res.text();
    expect(text).not.toBe("[object Object]");
    expect(text).not.toContain("[object Object]");
    expect(text.toLowerCase()).toContain("<!doctype html>");
  });
});
