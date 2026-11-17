// Tests for the /auth/login and /auth/callback endpoints. The leading underscore keeps
// Astro from treating this file as a route.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RETURN_TO_COOKIE } from "../../utils/returnTo";
import { GET as callback } from "./callback";
import { GET as login } from "./login";

vi.mock("@toiletmap/auth", () => ({
  authenticateToken: vi.fn(async () => ({
    sub: "auth0|user",
    email: "user@example.com",
    name: "User",
    nickname: "user",
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

const base64Url = (value: string) =>
  btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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

  it.each(["https://evil.example/", "//evil.example", "/\\evil.example", "javascript:alert(1)"])(
    "ignores an unsafe returnTo (%s)",
    async (returnTo) => {
      const cookies = makeCookies({ [RETURN_TO_COOKIE]: "/stale" });
      const url = new URL("https://site.example/auth/login");
      url.searchParams.set("returnTo", returnTo);
      await call(login, { cookies, redirect, url });
      expect(cookies.jar.has(RETURN_TO_COOKIE)).toBe(false);
    },
  );
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
    for (const name of ["access_token", "id_token", "user_info"]) {
      const opts = cookies.set.mock.calls.find(([n]) => n === name)?.[2];
      expect(opts, name).toMatchObject({ maxAge: 5400, secure: true, path: "/" });
    }
    const userInfoOpts = cookies.set.mock.calls.find(([n]) => n === "user_info")?.[2];
    expect(userInfoOpts).toMatchObject({ httpOnly: false });
    const tokenOpts = cookies.set.mock.calls.find(([n]) => n === "access_token")?.[2];
    expect(tokenOpts).toMatchObject({ httpOnly: true });
  });

  it("still rejects a mismatched state", async () => {
    const cookies = makeCookies({ auth_state: "other", auth_nonce: "n" });
    const res = (await call(callback, {
      cookies,
      redirect,
      url: new URL("https://site.example/auth/callback?code=abc&state=state-1"),
    })) as Response;
    expect(res.status).toBe(400);
  });
});
