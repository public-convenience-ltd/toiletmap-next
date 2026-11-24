// Tests for the /auth/login and /auth/callback endpoints. The leading underscore keeps
// Astro from treating this file as a route.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RETURN_TO_COOKIE } from "../../utils/returnTo";
import { GET as callback } from "./callback";
import { GET as login } from "./login";

// A name outside Latin-1: btoa() of it would throw.
vi.mock("@toiletmap/auth", () => ({
  authenticateToken: vi.fn(async () => ({
    sub: "auth0|user",
    email: "lukasz@example.com",
    name: "Łukasz Ŵyn",
    nickname: "łukasz",
    nonce: "nonce-123",
  })),
}));

type CookieOpts = Record<string, unknown>;

const makeCookies = (initial: Record<string, string> = {}) => {
  const jar = new Map(Object.entries(initial));
  const set = vi.fn((name: string, value: string, _opts?: CookieOpts) => {
    jar.set(name, value);
  });
  const del = vi.fn((name: string, _opts?: CookieOpts) => {
    jar.delete(name);
  });
  return {
    jar,
    set,
    delete: del,
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) as string } : undefined),
  };
};

const redirect = (location: string) =>
  new Response(null, { status: 302, headers: { Location: location } });

// biome-ignore lint/suspicious/noExplicitAny: a minimal stand-in for Astro's APIContext
const call = (handler: typeof login, ctx: Record<string, unknown>) => handler(ctx as any);

const base64Url = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const jwt = (payload: unknown) =>
  `${base64Url(JSON.stringify({ alg: "RS256" }))}.${base64Url(JSON.stringify(payload))}.sig`;

beforeEach(() => {
  Object.assign(env, {
    AUTH0_ISSUER_BASE_URL: "https://tenant.example/",
    AUTH0_CLIENT_ID: "client",
    AUTH0_CLIENT_SECRET: "secret",
    AUTH0_SCOPE: "openid",
    AUTH0_AUDIENCE: "https://api.example",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("GET /auth/login", () => {
  it("remembers a same-origin returnTo in a short-lived httpOnly cookie", async () => {
    const cookies = makeCookies();
    const res = (await call(login, {
      cookies,
      redirect,
      url: new URL("https://site.example/auth/login?returnTo=%2Floos%2Fabc%2Fedit"),
    })) as Response;

    expect(res.headers.get("Location")).toMatch(/^https:\/\/tenant\.example\/authorize\?/);
    expect(cookies.jar.get(RETURN_TO_COOKIE)).toBe("/loos/abc/edit");
    const opts = cookies.set.mock.calls.find(([name]) => name === RETURN_TO_COOKIE)?.[2];
    expect(opts).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", maxAge: 300 });
    expect(cookies.jar.has("auth_state")).toBe(true);
  });

  it.each([
    "https://evil.example/",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/%2F%2Fevil.example",
    "/%5Cevil.example",
    "%2F%2Fevil.example",
    "/%09/evil.example",
    "javascript:alert(1)",
    "/auth/logout",
  ])("ignores an unsafe returnTo (%s)", async (returnTo) => {
    const cookies = makeCookies({ [RETURN_TO_COOKIE]: "/stale" });
    const url = new URL("https://site.example/auth/login");
    url.searchParams.set("returnTo", returnTo);
    await call(login, { cookies, redirect, url });
    expect(cookies.jar.has(RETURN_TO_COOKIE)).toBe(false);
  });
});

describe("GET /auth/callback", () => {
  const NOW = 1_800_000_000_000;

  const callbackWith = async (jarInit: Record<string, string>) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const accessToken = jwt({ exp: NOW / 1000 + 5400 });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ access_token: accessToken, id_token: "id.token.x" }), {
            status: 200,
          }),
      ),
    );
    const cookies = makeCookies({ auth_state: "state-1", auth_nonce: "nonce-123", ...jarInit });
    const res = (await call(callback, {
      cookies,
      redirect,
      locals: {},
      rewrite: vi.fn(),
      url: new URL("https://site.example/auth/callback?code=abc&state=state-1"),
    })) as Response;
    return { res, cookies };
  };

  it("redirects to the remembered returnTo and clears it", async () => {
    const { res, cookies } = await callbackWith({ [RETURN_TO_COOKIE]: "/loos/abc/edit" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/loos/abc/edit");
    expect(cookies.jar.has(RETURN_TO_COOKIE)).toBe(false);
  });

  it("falls back to the home page when the remembered value is unsafe", async () => {
    const { res } = await callbackWith({ [RETURN_TO_COOKIE]: "//evil.example" });
    expect(res.headers.get("Location")).toBe("/");
  });

  it("falls back to the home page without a returnTo", async () => {
    const { res } = await callbackWith({});
    expect(res.headers.get("Location")).toBe("/");
  });

  it("sets the session cookies' maxAge from the access token's exp", async () => {
    const { cookies } = await callbackWith({});
    for (const name of ["access_token", "id_token", "signed_in"]) {
      const opts = cookies.set.mock.calls.find(([n]) => n === name)?.[2];
      expect(opts, name).toMatchObject({ maxAge: 5400, secure: true, path: "/" });
    }
    const flagOpts = cookies.set.mock.calls.find(([n]) => n === "signed_in")?.[2];
    expect(flagOpts).toMatchObject({ httpOnly: false });
    const tokenOpts = cookies.set.mock.calls.find(([n]) => n === "access_token")?.[2];
    expect(tokenOpts).toMatchObject({ httpOnly: true });
  });

  it("signs in a user whose name is outside Latin-1 (Łukasz Ŵyn)", async () => {
    const { res, cookies } = await callbackWith({});
    expect(res.status).toBe(302);
    expect(cookies.jar.has("access_token")).toBe(true);
  });

  it("keeps no profile in a readable cookie: the signed-in flag holds no data", async () => {
    const { cookies } = await callbackWith({ user_info: "eyJzdWIiOiJvbGQifQ==" });
    expect(cookies.jar.get("signed_in")).toBe("1");
    // The legacy profile cookie is removed.
    expect(cookies.jar.has("user_info")).toBe(false);
    for (const [, value] of cookies.set.mock.calls) {
      expect(value).not.toContain("ukasz");
    }
    expect(cookies.set.mock.calls.map(([name]) => name)).not.toContain("user_info");
  });
});

/** No session cookie was written. */
const expectNoSession = (cookies: ReturnType<typeof makeCookies>) => {
  const written = cookies.set.mock.calls.map(([name]) => name);
  for (const name of ["access_token", "id_token", "signed_in", "user_info"]) {
    expect(written, name).not.toContain(name);
  }
};

describe("GET /auth/callback errors: the friendly error page", () => {
  /** Calls the callback; any error comes back as the rewrite's target plus locals.authError. */
  const failWith = async ({
    query,
    jar = { auth_state: "state-1", auth_nonce: "nonce-123", [RETURN_TO_COOKIE]: "/loos/abc" },
    token,
  }: {
    query: string;
    jar?: Record<string, string>;
    token?: Response;
  }) => {
    const fetchMock = vi.fn(async () => token ?? new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const cookies = makeCookies(jar);
    const locals: Record<string, unknown> = {};
    const rewrite = vi.fn(async (path: string) => new Response(`page:${path}`, { status: 200 }));
    const res = (await call(callback, {
      cookies,
      redirect,
      locals,
      rewrite,
      url: new URL(`https://site.example/auth/callback?${query}`),
    })) as Response;
    return { res, rewrite, error: locals.authError, cookies, fetchMock };
  };

  it("shows Auth0's access_denied with its description when the state matches", async () => {
    const { rewrite, error, cookies, fetchMock } = await failWith({
      query: "error=access_denied&error_description=Please%20verify%20your%20email&state=state-1",
    });
    expect(rewrite).toHaveBeenCalledWith("/auth/error");
    expect(error).toEqual({
      kind: "denied",
      description: "Please verify your email",
      returnTo: "/loos/abc",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // The one-time cookies are cleared either way.
    expect(cookies.jar.has("auth_state")).toBe(false);
    expect(cookies.jar.has(RETURN_TO_COOKIE)).toBe(false);
  });

  it("drops Auth0's description when the state doesn't match (it could be a crafted link)", async () => {
    const { error } = await failWith({
      query: "error=access_denied&error_description=Call%200800%20000%20000&state=forged",
    });
    expect(error).toEqual({ kind: "denied", description: undefined, returnTo: "/loos/abc" });
  });

  it.each([
    ["temporarily_unavailable", "unavailable"],
    ["server_error", "unavailable"],
    ["login_required", "expired"],
    ["unauthorized", "denied"],
    ["invalid_request", "failed"],
  ])("maps Auth0's %s to %s", async (code, kind) => {
    const { error } = await failWith({ query: `error=${code}&state=state-1` });
    expect(error).toMatchObject({ kind });
  });

  it("says the sign-in expired when the state cookie is gone", async () => {
    const { error } = await failWith({ query: "code=abc&state=state-1", jar: {} });
    expect(error).toEqual({ kind: "expired", description: undefined, returnTo: null });
  });

  it("stops a sign-in whose state doesn't match this browser's", async () => {
    const { error, fetchMock } = await failWith({
      query: "code=abc&state=state-1",
      jar: { auth_state: "other", auth_nonce: "n" },
    });
    expect(error).toMatchObject({ kind: "state" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops a callback with no state at all", async () => {
    const { error } = await failWith({ query: "code=abc" });
    expect(error).toMatchObject({ kind: "state" });
  });

  it("reports a missing code", async () => {
    const { error } = await failWith({ query: "state=state-1" });
    expect(error).toMatchObject({ kind: "failed", returnTo: "/loos/abc" });
  });

  it("treats a used or expired code (invalid_grant) as an expired sign-in", async () => {
    const { error } = await failWith({
      query: "code=abc&state=state-1",
      token: new Response(JSON.stringify({ error: "invalid_grant" }), { status: 403 }),
    });
    expect(error).toMatchObject({ kind: "expired" });
  });

  it("reports other token failures as failed", async () => {
    const { error } = await failWith({
      query: "code=abc&state=state-1",
      token: new Response("nope", { status: 401 }),
    });
    expect(error).toMatchObject({ kind: "failed" });
  });

  it("reports a nonce mismatch like a state mismatch", async () => {
    const accessToken = jwt({ exp: Date.now() / 1000 + 3600 });
    const { error, cookies } = await failWith({
      query: "code=abc&state=state-1",
      jar: { auth_state: "state-1", auth_nonce: "different-nonce" },
      token: new Response(JSON.stringify({ access_token: accessToken, id_token: "id.token.x" })),
    });
    expect(error).toMatchObject({ kind: "state" });
    expectNoSession(cookies);
  });

  it("leaves no half-session when id_token verification throws", async () => {
    const { authenticateToken } = await import("@toiletmap/auth");
    vi.mocked(authenticateToken).mockRejectedValueOnce(new Error("bad signature"));
    const accessToken = jwt({ exp: Date.now() / 1000 + 3600 });
    const { error, cookies } = await failWith({
      query: "code=abc&state=state-1",
      jar: { auth_state: "state-1", auth_nonce: "nonce-123" },
      token: new Response(JSON.stringify({ access_token: accessToken, id_token: "id.token.x" })),
    });
    expect(error).toMatchObject({ kind: "error" });
    expectNoSession(cookies);
  });

  it("reports an exception as our error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    const locals: Record<string, unknown> = {};
    await call(callback, {
      cookies: makeCookies({ auth_state: "state-1", auth_nonce: "nonce-123" }),
      redirect,
      locals,
      rewrite: vi.fn(),
      url: new URL("https://site.example/auth/callback?code=abc&state=state-1"),
    });
    expect(locals.authError).toMatchObject({ kind: "error" });
  });

  it("never keeps an unsafe remembered returnTo for Try again", async () => {
    const { error } = await failWith({
      query: "error=access_denied&state=state-1",
      jar: { auth_state: "state-1", auth_nonce: "n", [RETURN_TO_COOKIE]: "//evil.example" },
    });
    expect(error).toMatchObject({ returnTo: null });
  });
});
