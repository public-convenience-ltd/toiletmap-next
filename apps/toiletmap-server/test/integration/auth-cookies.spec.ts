import { describe, expect, it } from "vitest";
import { getTestContext } from "./setup";
import { cleanupManager } from "./utils/cleanup";
import type { QueuedBody } from "./utils/response-types";
import { sessionCookie, TEST_ORIGIN } from "./utils/session";
import { callApi, jsonRequest, readJson } from "./utils/test-client";

type RootBody = {
  user: { sub: string; name?: string; nickname?: string; email?: string } | null;
};

/** Who the server thinks the caller is, per the root endpoint (optional auth). */
const whoAmI = async (headers: Record<string, string>, env = {}) => {
  const response = await callApi("/", { headers }, { env });
  expect(response.status).toBe(200);
  return { response, user: (await readJson<RootBody>(response)).user };
};

describe("Authentication via Cookies", () => {
  it("authenticates a session by its access token", async () => {
    const { issueToken } = getTestContext();
    const { user } = await whoAmI({ Cookie: `access_token=${issueToken()}` });
    expect(user?.sub).toBe("auth0|integration-test-user");
  });

  it("does not accept an id_token as a credential (the access token failed)", async () => {
    const { issueToken } = getTestContext();
    const idToken = issueToken({ aud: process.env.AUTH0_CLIENT_ID });
    const { response, user } = await whoAmI({
      Cookie: `id_token=${idToken}; access_token=not-a-token`,
    });
    expect(user).toBeNull();
    // The broken session is cleared.
    expect(response.headers.get("set-cookie")).toContain("access_token=;");
  });

  it("does not accept an id_token sent as the access token", async () => {
    const { issueToken } = getTestContext();
    const idToken = issueToken({ aud: process.env.AUTH0_CLIENT_ID });
    const { user } = await whoAmI({ Cookie: `access_token=${idToken}` });
    expect(user).toBeNull();
  });

  it("takes the profile from the verified id_token and ignores a user_info cookie", async () => {
    const sub = "auth0|profile-user";
    const cookie = sessionCookie({
      sub,
      profile: { name: "Łukasz Ŵyn", nickname: "łukasz", email: "lukasz@example.com" },
    });
    const forged = Buffer.from(
      JSON.stringify({ sub, name: "Someone Else", nickname: "spoofed" }),
    ).toString("base64");
    const { user } = await whoAmI({ Cookie: `${cookie}; user_info=${forged}` });
    expect(user).toMatchObject({
      sub,
      name: "Łukasz Ŵyn",
      nickname: "łukasz",
      email: "lukasz@example.com",
    });
  });

  it("ignores the profile of an id_token that belongs to someone else", async () => {
    const { issueToken } = getTestContext();
    const accessToken = issueToken({ sub: "auth0|real-user", name: "Real User" });
    const idToken = issueToken({
      sub: "auth0|other-user",
      name: "Other User",
      aud: process.env.AUTH0_CLIENT_ID,
    });
    const { user } = await whoAmI({ Cookie: `access_token=${accessToken}; id_token=${idToken}` });
    expect(user?.sub).toBe("auth0|real-user");
    expect(user?.name).not.toBe("Other User");
  });

  it("refuses an access token whose audience is a delimited string", async () => {
    const { issueToken } = getTestContext();
    const apiAudience = process.env.AUTH0_AUDIENCE as string;
    for (const aud of [
      `${apiAudience},https://example.auth0.com/userinfo`,
      `${apiAudience} https://example.auth0.com/userinfo`,
    ]) {
      const { user } = await whoAmI({ Cookie: `access_token=${issueToken({ aud })}` });
      expect(user).toBeNull();
    }
  });

  it("accepts access_token cookies when the audience claim is an array", async () => {
    const { issueToken } = getTestContext();
    const apiAudience = process.env.AUTH0_AUDIENCE as string;
    const accessToken = issueToken({ aud: [apiAudience, "https://example.auth0.com/userinfo"] });
    const { user } = await whoAmI({ Cookie: `access_token=${accessToken}` });
    expect(user?.sub).toBe("auth0|integration-test-user");
  });

  it("refuses every token when no audience is configured", async () => {
    const { issueToken } = getTestContext();
    const response = await callApi(
      "/api/loos",
      jsonRequest("POST", {}, { Authorization: `Bearer ${issueToken()}` }),
      { env: { AUTH0_AUDIENCE: "" } },
    );
    expect(response.status).toBe(401);
  });

  it("redirects the admin to sign in and clears a session that does not verify", async () => {
    const { issueToken } = getTestContext();
    const idToken = issueToken({ aud: "wrong-audience" });

    const response = await callApi(
      "/admin",
      jsonRequest("GET", undefined, {
        Cookie: `id_token=${idToken}; access_token=dummy`,
      }),
    );

    expect(response.status).toBe(302);
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain("id_token=;");
    expect(setCookie).toContain("access_token=;");
  });
});

describe("Auth0 signing keys unavailable", () => {
  /** Nothing listens here, so the JWKS fetch fails. */
  const OUTAGE_ENV = { AUTH0_ISSUER_BASE_URL: "http://127.0.0.1:9/" };

  it("treats a bearer token as anonymous on optional-auth routes", async () => {
    const { issueToken } = getTestContext();
    const { user } = await whoAmI({ Authorization: `Bearer ${issueToken()}` }, OUTAGE_ENV);
    expect(user).toBeNull();
  });

  it("queues a write instead of refusing it or applying it", async () => {
    const { issueToken } = getTestContext();
    const response = await callApi(
      "/api/loos",
      jsonRequest(
        "POST",
        { name: "JWKS outage loo", location: { lat: 57.1, lng: -4.2 } },
        { Authorization: `Bearer ${issueToken()}` },
      ),
      { env: OUTAGE_ENV },
    );
    expect(response.status).toBe(202);
    const body = await readJson<QueuedBody>(response);
    cleanupManager.trackPendingChange(body.id);
    expect(body.queued).toBe(true);
  });

  it("still refuses the admin, without clearing the session", async () => {
    const response = await callApi(
      "/admin",
      { headers: { Cookie: sessionCookie({ sub: "auth0|admin", permissions: ["access:admin"] }) } },
      { env: OUTAGE_ENV },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/admin/login");
    expect(response.headers.get("set-cookie") ?? "").not.toContain("access_token=;");
  });
});

describe("CSRF: cookie-authenticated API writes must be same-origin", () => {
  const cookie = () => sessionCookie({ sub: "auth0|csrf-user" });
  /** An invalid body: a request that gets past the CSRF check is refused with 400. */
  const INVALID_BODY = { openingTimes: [["invalid"]] };

  it.each([
    ["another origin", { Origin: "https://evil.example" }],
    ["a same-site preview origin", { Origin: "https://evil-toiletmap-client.integration.test" }],
    ["a null Origin", { Origin: "null" }],
    ["Sec-Fetch-Site: cross-site", { "Sec-Fetch-Site": "cross-site" }],
    ["Sec-Fetch-Site: same-site", { "Sec-Fetch-Site": "same-site" }],
    ["neither Origin nor Sec-Fetch-Site", {}],
  ])("refuses %s with 403 JSON", async (_label, headers) => {
    for (const [method, path] of [
      ["POST", "/api/loos"],
      ["PUT", "/api/loos/aaaaaaaaaaaaaaaaaaaaaaaa"],
      ["POST", "/api/loos/aaaaaaaaaaaaaaaaaaaaaaaa/report"],
      ["POST", "/api/feedback"],
    ] as const) {
      const response = await callApi(
        path,
        jsonRequest(method, INVALID_BODY, { Cookie: cookie(), ...headers }),
      );
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(await response.json()).toMatchObject({ error: "csrf" });
    }
  });

  it.each([
    ["a same-origin Origin", { Origin: TEST_ORIGIN }],
    ["Sec-Fetch-Site: same-origin", { "Sec-Fetch-Site": "same-origin" }],
  ])("accepts %s", async (_label, headers) => {
    const response = await callApi(
      "/api/loos",
      jsonRequest("POST", INVALID_BODY, { Cookie: cookie(), ...headers }),
    );
    expect(response.status).toBe(400);
  });

  it("does not check bearer-token requests (they ignore cookies)", async () => {
    const { issueToken } = getTestContext();
    const response = await callApi(
      "/api/loos",
      jsonRequest("POST", INVALID_BODY, {
        Authorization: `Bearer ${issueToken()}`,
        Cookie: cookie(),
        Origin: "https://evil.example",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("does not check requests without session cookies (anonymous, e.g. the Flutter app)", async () => {
    const response = await callApi(
      "/api/loos",
      jsonRequest("POST", INVALID_BODY, { Origin: "https://evil.example" }),
    );
    expect(response.status).toBe(400);
  });

  it("does not check reads", async () => {
    const response = await callApi("/api/areas", {
      headers: { Cookie: cookie(), Origin: "https://evil.example" },
    });
    expect(response.status).toBe(200);
  });
});
