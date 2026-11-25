import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { rateLimiters } from "../../src/middleware/cloudflare-rate-limit";
import type { AppVariables, Env } from "../../src/types";

/** Sends one request through the read limiter and returns the key it used. */
const readKey = async (headers: Record<string, string>) => {
  const limit = vi.fn().mockResolvedValue({ success: true });
  const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
  app.use("*", rateLimiters.read);
  app.get("/api/loos", (c) => c.text("ok"));
  const response = await app.request("/api/loos", { headers }, {
    RATE_LIMIT_READ: { limit },
  } as unknown as Env);
  expect(response.status).toBe(200);
  return limit.mock.calls[0]?.[0]?.key;
};

describe("rate-limit keys", () => {
  it("key by cf-connecting-ip", async () => {
    expect(await readKey({ "cf-connecting-ip": "203.0.113.7" })).toBe("read:203.0.113.7");
    expect(
      await readKey({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }),
    ).toBe("read:203.0.113.7");
  });

  it("never take the key from X-Forwarded-For, which the caller controls", async () => {
    expect(await readKey({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" })).toBe("read:unknown");
  });
});
