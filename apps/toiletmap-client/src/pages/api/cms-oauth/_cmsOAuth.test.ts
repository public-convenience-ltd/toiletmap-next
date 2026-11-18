// @vitest-environment node
// Tests for the CMS's GitHub sign-in endpoints (/api/cms-oauth/*). The leading underscore
// keeps Astro from treating this file as a route.

import { env } from "cloudflare:workers";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAllowedApiPath } from "../../../utils/api";
import { CMS_OAUTH_STATE_COOKIE } from "../../../utils/cmsOAuth";
import { GET as auth } from "./auth";
import { GET as callback } from "./callback";
import { GET as status } from "./status";

const ORIGIN = "https://site.example";

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

const call = async (handler: typeof auth, ctx: Record<string, unknown>) =>
  // biome-ignore lint/suspicious/noExplicitAny: a minimal stand-in for Astro's APIContext
  (await handler(ctx as any)) as Response;

const configure = () =>
  Object.assign(env, {
    GITHUB_OAUTH_CLIENT_ID: "client-id",
    GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
  });

/** The hand-off script's message to the CMS window, from a result page. */
const handoffMessage = (html: string) => html.match(/var message = ("(?:[^"\\]|\\.)*");/)?.[1];

beforeEach(() => {
  Object.assign(env, { GITHUB_OAUTH_CLIENT_ID: undefined, GITHUB_OAUTH_CLIENT_SECRET: undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("routing", () => {
  it("are static, server-rendered routes the API proxy never handles", () => {
    for (const name of ["auth", "callback", "status"]) {
      const source = readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8");
      expect(source, name).toContain("export const prerender = false;");
      expect(source, name).toContain("export const GET");
    }
    // Static routes outrank src/pages/api/[...path].ts; and were one ever proxied, the
    // proxy's allow-list would refuse it rather than forward it to the API.
    for (const path of [
      "/api/cms-oauth/auth",
      "/api/cms-oauth/callback",
      "/api/cms-oauth/status",
    ]) {
      expect(isAllowedApiPath(path), path).toBe(false);
    }
  });
});

describe("without GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET", () => {
  it.each([
    ["auth", auth, "/api/cms-oauth/auth?provider=github&scope=public_repo"],
    ["callback", callback, "/api/cms-oauth/callback?code=c&state=s"],
  ])('%s answers 503 "CMS sign-in isn\'t configured yet"', async (_, handler, path) => {
    const cookies = makeCookies({ [CMS_OAUTH_STATE_COOKIE]: "s" });
    const res = await call(handler, { url: new URL(path, ORIGIN), cookies });
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("CMS sign-in isn&#39;t configured yet");
    expect(handoffMessage(html)).toContain("NOT_CONFIGURED");
    expect(cookies.set).not.toHaveBeenCalled();
  });

  it("is half-configured with only one of the two: still 503", async () => {
    Object.assign(env, { GITHUB_OAUTH_CLIENT_ID: "client-id" });
    const res = await call(auth, {
      url: new URL("/api/cms-oauth/auth", ORIGIN),
      cookies: makeCookies(),
    });
    expect(res.status).toBe(503);
  });

  it("status says so", async () => {
    const res = await call(status, {});
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ configured: false });
    configure();
    await expect((await call(status, {})).json()).resolves.toEqual({ configured: true });
  });
});

describe("GET /api/cms-oauth/auth", () => {
  beforeEach(configure);

  it("stores a random state in a short-lived httpOnly cookie and redirects to GitHub", async () => {
    const cookies = makeCookies();
    const res = await call(auth, {
      url: new URL(
        "/api/cms-oauth/auth?provider=github&site_id=site.example&scope=public_repo",
        ORIGIN,
      ),
      cookies,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("client-id");
    expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/cms-oauth/callback`);
    expect(location.searchParams.get("scope")).toBe("public_repo");

    const state = cookies.jar.get(CMS_OAUTH_STATE_COOKIE);
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    expect(location.searchParams.get("state")).toBe(state);
    const opts = cookies.set.mock.calls[0][2];
    expect(opts).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/cms-oauth",
    });
    expect(opts?.maxAge).toBeLessThanOrEqual(600);
    // The secret never goes to the browser.
    expect(res.headers.get("location")).not.toContain("client-secret");
  });

  it("uses a new state every time", async () => {
    const a = makeCookies();
    const b = makeCookies();
    await call(auth, { url: new URL("/api/cms-oauth/auth", ORIGIN), cookies: a });
    await call(auth, { url: new URL("/api/cms-oauth/auth", ORIGIN), cookies: b });
    expect(a.jar.get(CMS_OAUTH_STATE_COOKIE)).not.toBe(b.jar.get(CMS_OAUTH_STATE_COOKIE));
  });

  it("never asks for more than repo access", async () => {
    const res = await call(auth, {
      url: new URL("/api/cms-oauth/auth?provider=github&scope=repo,admin:org,workflow", ORIGIN),
      cookies: makeCookies(),
    });
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("scope")).toBe(
      "public_repo",
    );
  });

  it("refuses providers other than GitHub", async () => {
    const cookies = makeCookies();
    const res = await call(auth, {
      url: new URL("/api/cms-oauth/auth?provider=gitlab", ORIGIN),
      cookies,
    });
    expect(res.status).toBe(400);
    expect(cookies.set).not.toHaveBeenCalled();
  });
});

describe("GET /api/cms-oauth/callback", () => {
  beforeEach(configure);

  const githubReturnsToken = () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ access_token: "gho_token", token_type: "bearer" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("swaps the code for a token and hands it to the CMS window at our own origin", async () => {
    const fetchMock = githubReturnsToken();
    const cookies = makeCookies({ [CMS_OAUTH_STATE_COOKIE]: "state-1" });
    const res = await call(callback, {
      url: new URL("/api/cms-oauth/callback?code=code-1&state=state-1", ORIGIN),
      cookies,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://github.com/login/oauth/access_token");
    expect(JSON.parse(String(init.body))).toMatchObject({
      client_id: "client-id",
      client_secret: "client-secret",
      code: "code-1",
      redirect_uri: `${ORIGIN}/api/cms-oauth/callback`,
    });

    const html = await res.text();
    expect(JSON.parse(handoffMessage(html) ?? '""')).toBe(
      'authorization:github:success:{"provider":"github","token":"gho_token"}',
    );
    // postMessage only ever targets our origin; the legacy endpoint used "*".
    expect(html).toContain(`var origin = "${ORIGIN}";`);
    expect(html).toContain("opener.postMessage(message, origin)");
    expect(html).toContain("opener.postMessage(handshake, origin)");
    expect(html).not.toMatch(/postMessage\([^)]*["']\*["']/);
    expect(html).not.toContain("client-secret");
    // The state is single-use.
    expect(cookies.jar.has(CMS_OAUTH_STATE_COOKIE)).toBe(false);
    expect(cookies.delete).toHaveBeenCalledWith(CMS_OAUTH_STATE_COOKIE, { path: "/api/cms-oauth" });
  });

  it.each([
    ["a different state", { [CMS_OAUTH_STATE_COOKIE]: "state-1" }, "?code=c&state=state-2"],
    ["no state cookie", {}, "?code=c&state=state-1"],
    ["no state parameter", { [CMS_OAUTH_STATE_COOKIE]: "state-1" }, "?code=c"],
  ])("rejects %s with 400, without calling GitHub", async (_, jar, query) => {
    const fetchMock = githubReturnsToken();
    const cookies = makeCookies(jar);
    const res = await call(callback, {
      url: new URL(`/api/cms-oauth/callback${query}`, ORIGIN),
      cookies,
    });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    const html = await res.text();
    expect(handoffMessage(html)).toContain("CSRF_DETECTED");
    expect(html).not.toContain("gho_token");
    expect(cookies.jar.has(CMS_OAUTH_STATE_COOKIE)).toBe(false);
  });

  it("reports a refused or cancelled GitHub sign-in", async () => {
    const fetchMock = githubReturnsToken();
    const res = await call(callback, {
      url: new URL("/api/cms-oauth/callback?error=access_denied&state=state-1", ORIGIN),
      cookies: makeCookies({ [CMS_OAUTH_STATE_COOKIE]: "state-1" }),
    });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(handoffMessage(await res.text())).toContain("AUTH_DENIED");
  });

  it("needs a code", async () => {
    const res = await call(callback, {
      url: new URL("/api/cms-oauth/callback?state=state-1", ORIGIN),
      cookies: makeCookies({ [CMS_OAUTH_STATE_COOKIE]: "state-1" }),
    });
    expect(res.status).toBe(400);
  });

  it("answers 502 when GitHub won't swap the code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "bad_verification_code" })),
    );
    const res = await call(callback, {
      url: new URL("/api/cms-oauth/callback?code=old&state=state-1", ORIGIN),
      cookies: makeCookies({ [CMS_OAUTH_STATE_COOKIE]: "state-1" }),
    });
    expect(res.status).toBe(502);
    const message = handoffMessage(await res.text()) ?? "";
    expect(message).toContain("authorization:github:error:");
    expect(message).not.toContain('token\\":');
  });
});
