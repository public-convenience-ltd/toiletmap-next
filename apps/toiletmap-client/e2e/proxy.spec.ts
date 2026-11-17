import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { e2eName, getLoo, stable } from "./support/api";
import { getPendingChangesForLoo } from "./support/db";
import { CLIENT_URL } from "./support/env";
import { authedTest, expect, test } from "./support/fixtures";

/**
 * API-level checks of the same-origin /api proxy (src/pages/api/[...path].ts,
 * src/utils/api.ts). No page is rendered.
 */
test.describe("same-origin /api proxy", () => {
  test("does not expose upstream API docs", async ({ request }) => {
    const res = await request.get("/api/docs");
    expect(res.status()).toBe(404);
    expect(res.headers()["content-security-policy"]).toContain("default-src 'none'");
  });

  test("forwards allow-listed reads", async ({ request, loos }) => {
    const loo = await loos.create({}, "proxy read");
    const res = await request.get(`/api/loos/${loo.id}`);
    expect(res.status()).toBe(200);
    expect((await res.json()).name).toBe(loo.name);
    expect(res.headers()["set-cookie"]).toBeUndefined();
  });
});

/**
 * CSRF: a state-changing request must carry the client's own Origin, even when
 * the browser attaches a valid session cookie. These use the signed-in
 * context's request API, so the requests carry the httpOnly `access_token`
 * cookie exactly as a cross-site form post or fetch from a signed-in browser
 * would; without the Origin check they would be applied as the signed-in user.
 */
authedTest.describe("same-origin /api proxy CSRF protection", () => {
  /** The signed-in context's request API, after checking it really carries the session cookie. */
  async function signedInRequest(context: BrowserContext): Promise<APIRequestContext> {
    const names = (await context.cookies(CLIENT_URL)).map((c) => c.name);
    expect(names, "the signed-in context should hold the session cookie").toContain("access_token");
    return context.request;
  }

  const cases: { title: string; headers: Record<string, string> }[] = [
    { title: "without an Origin header", headers: {} },
    { title: "from another origin", headers: { origin: "https://evil.example" } },
  ];

  for (const { title, headers } of cases) {
    authedTest(`rejects a signed-in state-changing request ${title}`, async ({ context, loos }) => {
      const loo = await loos.create({}, "proxy csrf");
      const before = await getLoo(loo.id);
      const request = await signedInRequest(context);

      const res = await request.put(`/api/loos/${loo.id}`, {
        headers,
        data: { name: e2eName("should not be saved"), baseUpdatedAt: before.updatedAt },
      });
      expect(res.status()).toBe(403);

      // Neither applied directly (signed in) nor queued for moderation (anonymous).
      const after = await getLoo(loo.id);
      expect(stable(after)).toEqual(stable(before));
      expect(after.updatedAt).toBe(before.updatedAt);
      expect(await getPendingChangesForLoo(loo.id)).toEqual([]);
    });
  }

  authedTest(
    "accepts the same request from the client's own origin (control)",
    async ({ context, loos }) => {
      const loo = await loos.create({}, "proxy csrf control");
      const before = await getLoo(loo.id);
      const request = await signedInRequest(context);

      const name = e2eName("proxy csrf saved");
      const res = await request.put(`/api/loos/${loo.id}`, {
        headers: { origin: new URL(CLIENT_URL).origin },
        data: { name, baseUpdatedAt: before.updatedAt },
      });
      expect(res.status(), await res.text()).toBe(200);

      // Applied directly, which proves the cookie authenticated the request.
      expect((await getLoo(loo.id)).name).toBe(name);
      expect(await getPendingChangesForLoo(loo.id)).toEqual([]);
    },
  );
});
