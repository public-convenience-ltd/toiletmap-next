// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  CMS_NOT_CONFIGURED_TITLE,
  cmsAuthHandoffScript,
  cmsAuthMessage,
  cmsAuthResultPage,
  cmsNotConfiguredPage,
  cmsOAuthConfig,
  cmsOAuthScope,
  constantTimeEquals,
  exchangeGitHubCode,
  GITHUB_TOKEN_URL,
  githubAuthorizeUrl,
  randomToken,
} from "./cmsOAuth";

const ORIGIN = "https://www.toiletmap.org.uk";

/**
 * Runs a hand-off script against a fake popup window. Returns what it posted to its opener
 * and a way to deliver "message" events to it.
 */
function runHandoff(script: string, { withOpener = true } = {}) {
  const posted: Array<{ message: unknown; targetOrigin: string }> = [];
  const opener = {
    postMessage: vi.fn((message: unknown, targetOrigin: string) => {
      posted.push({ message, targetOrigin });
    }),
  };
  let listener: ((event: { source: unknown; origin: string; data: unknown }) => void) | null = null;
  const fakeWindow = {
    opener: withOpener ? opener : null,
    addEventListener: (_type: string, fn: typeof listener) => {
      listener = fn;
    },
    removeEventListener: () => {
      listener = null;
    },
  };
  new Function("window", script)(fakeWindow);
  return {
    opener,
    posted,
    deliver: (event: { source: unknown; origin: string; data: unknown }) => listener?.(event),
  };
}

describe("cmsOAuthConfig", () => {
  it("needs both the client id and secret, ignoring blanks", () => {
    expect(cmsOAuthConfig({})).toBeNull();
    expect(cmsOAuthConfig(undefined)).toBeNull();
    expect(cmsOAuthConfig({ GITHUB_OAUTH_CLIENT_ID: "id" })).toBeNull();
    expect(
      cmsOAuthConfig({ GITHUB_OAUTH_CLIENT_ID: " ", GITHUB_OAUTH_CLIENT_SECRET: "s" }),
    ).toBeNull();
    expect(
      cmsOAuthConfig({ GITHUB_OAUTH_CLIENT_ID: " id ", GITHUB_OAUTH_CLIENT_SECRET: "s" }),
    ).toEqual({
      clientId: "id",
      clientSecret: "s",
    });
  });
});

describe("cmsOAuthScope", () => {
  it("allows public_repo and repo only, defaulting to public_repo", () => {
    expect(cmsOAuthScope("public_repo")).toBe("public_repo");
    expect(cmsOAuthScope("repo")).toBe("repo");
    expect(cmsOAuthScope(null)).toBe("public_repo");
    expect(cmsOAuthScope("repo,workflow")).toBe("public_repo");
    expect(cmsOAuthScope("admin:org")).toBe("public_repo");
  });
});

describe("randomToken / constantTimeEquals", () => {
  it("makes long, unpredictable hex tokens", () => {
    const a = randomToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(randomToken()).not.toBe(a);
    expect(randomToken(16)).toHaveLength(32);
  });

  it("compares exactly", () => {
    expect(constantTimeEquals("abc", "abc")).toBe(true);
    expect(constantTimeEquals("abc", "abd")).toBe(false);
    expect(constantTimeEquals("abc", "abcd")).toBe(false);
  });
});

describe("githubAuthorizeUrl", () => {
  it("asks GitHub for a code with our callback, scope and state", () => {
    const url = new URL(
      githubAuthorizeUrl({
        clientId: "client",
        redirectUri: `${ORIGIN}/api/cms-oauth/callback`,
        scope: "public_repo",
        state: "s1",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client",
      redirect_uri: `${ORIGIN}/api/cms-oauth/callback`,
      scope: "public_repo",
      state: "s1",
      allow_signup: "false",
    });
  });
});

describe("exchangeGitHubCode", () => {
  const config = { clientId: "client", clientSecret: "secret" };
  const redirectUri = `${ORIGIN}/api/cms-oauth/callback`;

  it("posts the code and secret to GitHub and returns the token", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ access_token: "gho_abc", scope: "public_repo" }),
    );
    await expect(
      exchangeGitHubCode({ config, code: "c1", redirectUri, fetchImpl: fetchImpl as typeof fetch }),
    ).resolves.toEqual({ ok: true, token: "gho_abc" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(GITHUB_TOKEN_URL);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("accept")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      client_id: "client",
      client_secret: "secret",
      code: "c1",
      redirect_uri: redirectUri,
    });
  });

  it.each([
    [
      "GitHub's 200-with-error answer",
      async () => Response.json({ error: "bad_verification_code" }),
    ],
    ["an HTTP error", async () => new Response("nope", { status: 500 })],
    ["a non-JSON answer", async () => new Response("<html>")],
    ["a network failure", () => Promise.reject(new TypeError("fetch failed"))],
  ])("fails cleanly on %s", async (_, impl) => {
    const result = await exchangeGitHubCode({
      config,
      code: "c1",
      redirectUri,
      fetchImpl: vi.fn(impl) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toMatch(/^(TOKEN_REQUEST_FAILED|MALFORMED_RESPONSE)$/);
      expect(result.error).not.toContain("bad_verification_code");
    }
  });
});

describe("cmsAuthMessage", () => {
  it("uses the Decap/Sveltia popup message format", () => {
    expect(cmsAuthMessage({ token: "t" })).toBe(
      'authorization:github:success:{"provider":"github","token":"t"}',
    );
    expect(cmsAuthMessage({ error: "No", errorCode: "X" })).toBe(
      'authorization:github:error:{"provider":"github","error":"No","errorCode":"X"}',
    );
  });
});

describe("the hand-off script (postMessage to the CMS window)", () => {
  const script = cmsAuthHandoffScript({ origin: ORIGIN, result: { token: "gho_secret" } });

  it("announces itself to the opener at our own origin only, never '*'", () => {
    const { posted } = runHandoff(script);
    expect(posted).toEqual([{ message: "authorizing:github", targetOrigin: ORIGIN }]);
    expect(script).not.toMatch(/postMessage\([^)]*["']\*["']/);
  });

  it("sends the token only after the opener at our origin echoes the handshake", () => {
    const { opener, posted, deliver } = runHandoff(script);
    // Wrong origin, wrong window, wrong message: all ignored.
    deliver({ source: opener, origin: "https://evil.example", data: "authorizing:github" });
    deliver({ source: {}, origin: ORIGIN, data: "authorizing:github" });
    deliver({ source: opener, origin: ORIGIN, data: "authorizing:gitlab" });
    expect(posted).toHaveLength(1);

    deliver({ source: opener, origin: ORIGIN, data: "authorizing:github" });
    expect(posted[1]).toEqual({
      message: 'authorization:github:success:{"provider":"github","token":"gho_secret"}',
      targetOrigin: ORIGIN,
    });
    // Once only.
    deliver({ source: opener, origin: ORIGIN, data: "authorizing:github" });
    expect(posted).toHaveLength(2);
  });

  it("does nothing without an opener", () => {
    expect(runHandoff(script, { withOpener: false }).posted).toEqual([]);
  });

  it("can't be broken out of by anything in the token or origin", () => {
    const nasty = cmsAuthHandoffScript({
      origin: ORIGIN,
      result: { token: '</script><script>alert(1)</script>" ' },
    });
    expect(nasty).not.toContain("</script>");
    expect(nasty).not.toContain(" ");
    const { opener, posted, deliver } = runHandoff(nasty);
    deliver({ source: opener, origin: ORIGIN, data: "authorizing:github" });
    expect(posted[1].message).toBe(
      cmsAuthMessage({ token: '</script><script>alert(1)</script>" ' }),
    );
  });
});

describe("cmsAuthResultPage / cmsNotConfiguredPage", () => {
  it("is an uncached, unindexed page whose only script carries the nonce", async () => {
    const res = cmsAuthResultPage({ origin: ORIGIN, nonce: "n0nce", result: { token: "t" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-security-policy")).toContain("script-src 'nonce-n0nce'");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await res.text();
    expect(html).toContain('<script nonce="n0nce">');
    expect(html.match(/<script/g)).toHaveLength(1);
  });

  it("escapes error text in the page", async () => {
    const res = cmsAuthResultPage({
      origin: ORIGIN,
      nonce: "n",
      status: 400,
      result: { error: "<b>bad</b>", errorCode: "X" },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("&lt;b&gt;bad&lt;/b&gt;");
  });

  it("says sign-in isn't configured yet, with a 503, and tells the CMS window too", async () => {
    const res = cmsNotConfiguredPage({ origin: ORIGIN, nonce: "n" });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain(`<h1>${CMS_NOT_CONFIGURED_TITLE.replace("'", "&#39;")}</h1>`);
    expect(html).toContain("GITHUB_OAUTH_CLIENT_ID");
    expect(html).toContain("GITHUB_OAUTH_CLIENT_SECRET");
    const script = html.match(/<script nonce="n">([\s\S]*?)<\/script>/)?.[1] ?? "";
    const { opener, posted, deliver } = runHandoff(script);
    deliver({ source: opener, origin: ORIGIN, data: "authorizing:github" });
    expect(posted[1].targetOrigin).toBe(ORIGIN);
    expect(posted[1].message).toContain("authorization:github:error:");
    expect(posted[1].message).toContain("NOT_CONFIGURED");
  });
});
