import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentPath,
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  jwtExpiry,
  loginHref,
  safeReturnTo,
  sessionMaxAge,
} from "./returnTo";

const base64Url = (value: string) =>
  btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const jwt = (payload: unknown) =>
  `${base64Url(JSON.stringify({ alg: "RS256" }))}.${base64Url(JSON.stringify(payload))}.sig`;

describe("safeReturnTo", () => {
  it("keeps same-origin relative paths, including query and hash", () => {
    expect(safeReturnTo("/")).toBe("/");
    expect(safeReturnTo("/loos/abc/edit")).toBe("/loos/abc/edit");
    expect(safeReturnTo("/loos/add?lat=51.5&lng=-0.1&zoom=17")).toBe(
      "/loos/add?lat=51.5&lng=-0.1&zoom=17",
    );
    expect(safeReturnTo("/loos/abc#hours")).toBe("/loos/abc#hours");
  });

  it.each([
    ["absolute http URL", "https://evil.example/"],
    ["absolute URL with same-looking host", "http://www.toiletmap.org.uk/"],
    ["protocol-relative", "//evil.example/path"],
    ["backslash host", "/\\evil.example"],
    ["double backslash", "\\\\evil.example"],
    ["mixed slashes", "/\\/evil.example"],
    ["javascript: scheme", "javascript:alert(1)"],
    ["data: scheme", "data:text/html,hi"],
    ["relative without leading slash", "loos/abc"],
    ["tab-smuggled protocol-relative", "/\t/evil.example"],
    ["newline-smuggled protocol-relative", "/\n/evil.example"],
    ["empty", ""],
    ["too long", `/${"a".repeat(3000)}`],
  ])("rejects %s", (_label, value) => {
    expect(safeReturnTo(value)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(safeReturnTo(null)).toBeNull();
    expect(safeReturnTo(undefined)).toBeNull();
  });

  it("does not let dot segments normalise into a protocol-relative path", () => {
    expect(safeReturnTo("/.//evil.example")).toBeNull();
  });

  it.each([
    ["encoded protocol-relative", "/%2F%2Fevil.example"],
    ["encoded second slash", "/%2Fevil.example"],
    ["lower-case encoded slashes", "/%2f%2fevil.example"],
    ["encoded backslash", "/%5Cevil.example"],
    ["encoded slash and backslash", "/%2F%5Cevil.example"],
    ["double-encoded protocol-relative", "/%252F%252Fevil.example"],
    ["triple-encoded protocol-relative", "/%25252F%25252Fevil.example"],
    ["encoded tab", "/%09/evil.example"],
    ["encoded newline", "/%0A/evil.example"],
    ["encoded backslash in the query", "/loos?x=%5C"],
    ["malformed escape", "/loos/%E0%A4%A"],
    ["encoded javascript: scheme", "%6Aavascript:alert(1)"],
    ["encoded leading slash", "%2F%2Fevil.example"],
  ])("rejects %s", (_label, value) => {
    expect(safeReturnTo(value)).toBeNull();
  });

  it.each([
    "/auth/login",
    "/auth/login?returnTo=%2F",
    "/auth/logout",
    "/auth/callback?x=1",
    "/auth",
  ])("rejects the sign-in routes themselves (%s)", (value) => {
    expect(safeReturnTo(value)).toBeNull();
  });

  it.each([
    ["dot segment before an encoded slash", "/./%2F/evil.example"],
    ["dot-dot segment before an encoded slash", "/a/../%2F/evil.example"],
    ["dot segment before an encoded backslash", "/./%5C/evil.example"],
    ["dot segment before a double-encoded slash", "/./%252F/evil.example"],
  ])("re-checks the normalised path in decoded form (%s)", (_label, value) => {
    expect(safeReturnTo(value)).toBeNull();
  });

  it.each([
    "/login",
    "/login/",
    "/login?returnTo=%2Fposts",
    "/api/auth/login",
    "/api/auth/callback?code=x",
    "/%61uth/logout",
    "/%2561uth/logout",
    "/./auth/login",
    "/AUTH/logout",
  ])("rejects the legacy sign-in URLs and encoded sign-in routes (%s)", (value) => {
    expect(safeReturnTo(value)).toBeNull();
  });

  it("keeps encoded characters that stay on this site", () => {
    expect(safeReturnTo("/loos/a%20b")).toBe("/loos/a%20b");
    expect(safeReturnTo("/?q=caf%C3%A9")).toBe("/?q=caf%C3%A9");
    expect(safeReturnTo("/authors")).toBe("/authors");
    expect(safeReturnTo("/loginhelp")).toBe("/loginhelp");
    expect(safeReturnTo("/api/authors")).toBe("/api/authors");
    expect(safeReturnTo("/loos/add?from=%2Floos%2Fabc")).toBe("/loos/add?from=%2Floos%2Fabc");
  });
});

describe("loginHref", () => {
  it("adds an encoded returnTo for safe paths", () => {
    expect(loginHref("/loos/abc/edit?x=1")).toBe(
      "/auth/login?returnTo=%2Floos%2Fabc%2Fedit%3Fx%3D1",
    );
  });

  it("drops unsafe or missing returnTo", () => {
    expect(loginHref("//evil.example")).toBe("/auth/login");
    expect(loginHref(undefined)).toBe("/auth/login");
  });
});

describe("currentPath", () => {
  const original = window.location;
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("reads pathname and search from the browser", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/loos/add", search: "?lat=1&lng=2" },
    });
    expect(currentPath("/fallback")).toBe("/loos/add?lat=1&lng=2");
  });

  it("falls back when the location can't be read", () => {
    Object.defineProperty(window, "location", { configurable: true, value: { href: "x" } });
    expect(currentPath("/fallback")).toBe("/fallback");
  });
});

describe("jwtExpiry / sessionMaxAge", () => {
  it("reads exp without verifying the signature", () => {
    expect(jwtExpiry(jwt({ exp: 1_800_000_000 }))).toBe(1_800_000_000);
  });

  it("returns null for malformed tokens", () => {
    expect(jwtExpiry("not-a-jwt")).toBeNull();
    expect(jwtExpiry("a.b.c")).toBeNull();
    expect(jwtExpiry(jwt({ exp: "soon" }))).toBeNull();
    expect(jwtExpiry(null)).toBeNull();
  });

  it("sizes the cookie to the token's remaining lifetime", () => {
    const now = 1_700_000_000_000;
    expect(sessionMaxAge(jwt({ exp: now / 1000 + 7200 }), now)).toBe(7200);
  });

  it("falls back to an hour without exp, and to 0 for an expired token", () => {
    const now = 1_700_000_000_000;
    expect(sessionMaxAge(jwt({ sub: "x" }), now)).toBe(DEFAULT_SESSION_MAX_AGE_SECONDS);
    expect(DEFAULT_SESSION_MAX_AGE_SECONDS).toBe(3600);
    expect(sessionMaxAge(jwt({ exp: now / 1000 - 10 }), now)).toBe(0);
  });

  it("uses Date.now by default", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2_000_000_000_000));
    expect(sessionMaxAge(jwt({ exp: 2_000_000_060 }))).toBe(60);
    vi.useRealTimers();
  });
});
