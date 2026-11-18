import type { APIRoute } from "astro";
import { describe, expect, it } from "vitest";
import { mapViewFromSearch } from "../components/LooMap/mapView";
import { legacyRedirectLocation, legacyRedirectResponse } from "./legacyRedirects";

const ORIGIN = "https://www.toiletmap.org.uk";
const at = (path: string) => new URL(path, ORIGIN);

/** Every legacy URL this site redirects, and where it goes (docs/security.md has the same table). */
const REDIRECTS: [legacy: string, location: string][] = [
  // The legacy map page: /map/:lng/:lat (longitude first), opened at the legacy zoom (16).
  ["/map/-0.1276/51.5072", "/?lat=51.5072&lng=-0.1276&zoom=16"],
  ["/map/-0.1276/51.5072/", "/?lat=51.5072&lng=-0.1276&zoom=16"],
  ["/map/-2.2426/53.4808/12", "/?lat=53.4808&lng=-2.2426&zoom=12"],
  ["/map/-0.1276/51.5072?utm_source=app", "/?lat=51.5072&lng=-0.1276&zoom=16&utm_source=app"],
  ["/map/-0.1276/51.5072?lat=1&lng=2", "/?lat=51.5072&lng=-0.1276&zoom=16"],
  ["/map/-0.1276/51.5072/99", "/?lat=51.5072&lng=-0.1276&zoom=19"],
  ["/map", "/"],
  ["/map/", "/"],
  ["/map?utm_source=x", "/?utm_source=x"],
  ["/map/-0.1276", "/"],
  ["/map/abc/def", "/"],
  ["/map/0/95", "/"],
  ["/map/200/51", "/"],
  ["/map/-0.1/51.5/12/extra", "/"],
  // The dataset explorer became the dataset page; its toilet pages are the toilets' pages.
  ["/explorer", "/dataset"],
  ["/explorer/", "/dataset"],
  ["/explorer/search", "/dataset"],
  ["/explorer/search?text=cafe&page=2", "/dataset"],
  ["/explorer/loos/abc123", "/loos/abc123"],
  ["/explorer/loos/abc123/", "/loos/abc123"],
  ["/explorer/loos/a%20b", "/loos/a%20b"],
  ["/explorer/anything/else", "/dataset"],
  // The legacy "Contributing / Log in" page.
  ["/login", "/auth/login"],
  ["/login?returnTo=%2Floos%2Fabc%2Fedit", "/auth/login?returnTo=%2Floos%2Fabc%2Fedit"],
  ["/login?returnTo=%2F%2Fevil.example", "/auth/login"],
  ["/login?returnTo=https%3A%2F%2Fevil.example", "/auth/login"],
  ["/login?returnTo=%2F%5Cevil.example", "/auth/login"],
  // The legacy /login page linked to /api/auth/login?returnTo=/login: a second Auth0 trip.
  ["/login?returnTo=%2Flogin", "/auth/login"],
  ["/api/auth/login?returnTo=%2Flogin", "/auth/login"],
  ["/api/auth/login?returnTo=%2Fapi%2Fauth%2Flogin", "/auth/login"],
  // The legacy nextjs-auth0 routes.
  ["/api/auth/login", "/auth/login"],
  ["/api/auth/login?returnTo=%2Floos%2Fadd", "/auth/login?returnTo=%2Floos%2Fadd"],
  ["/api/auth/login?returnTo=javascript%3Aalert(1)", "/auth/login"],
  ["/api/auth/logout", "/auth/logout"],
  ["/api/auth/callback?code=c&state=s", "/auth/callback?code=c&state=s"],
  // The legacy Decap CMS page and its GitHub sign-in.
  ["/api/admin", "/cms/"],
  ["/api/decap-oauth", "/api/cms-oauth/auth"],
  ["/api/decap-oauth?provider=github&scope=repo", "/api/cms-oauth/auth?provider=github&scope=repo"],
  ["/api/decap-oauth/callback?code=c&state=s", "/api/cms-oauth/callback?code=c&state=s"],
];

/** Paths that are not redirected (native pages, or legacy URLs with nothing to go to). */
const NOT_REDIRECTED = [
  "/",
  "/loos/abc",
  "/loos/abc/edit",
  "/loos/abc/remove",
  "/loos/add?lat=51.5&lng=-0.1",
  "/posts",
  "/posts/loos-in-the-news",
  "/about",
  "/dataset",
  "/api/loos",
  "/api/auth/me",
  "/api/auth/login/extra",
  "/api/decap-oauth/other",
  "/mapping",
  "/explorers",
  "/logins",
];

describe("legacyRedirectLocation", () => {
  it.each(REDIRECTS)("%s → %s", (legacy, location) => {
    expect(legacyRedirectLocation(at(legacy))).toBe(location);
  });

  it.each(NOT_REDIRECTED)("leaves %s alone", (path) => {
    expect(legacyRedirectLocation(at(path))).toBeNull();
  });

  it("always redirects to a same-origin path", () => {
    for (const [legacy] of REDIRECTS) {
      const location = legacyRedirectLocation(at(legacy)) ?? "";
      expect(location.startsWith("/") && !location.startsWith("//"), legacy).toBe(true);
    }
  });

  it("opens the map where the legacy link pointed (LooMap reads ?lat&lng&zoom)", () => {
    const location = legacyRedirectLocation(at("/map/-1.5491/53.8008/14")) ?? "";
    expect(mapViewFromSearch(new URL(location, ORIGIN).search)).toEqual({
      lat: 53.8008,
      lng: -1.5491,
      zoom: 14,
    });
  });
});

describe("legacyRedirectResponse", () => {
  it("is a permanent redirect", () => {
    const res = legacyRedirectResponse(at("/explorer"));
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/dataset");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("never caches the sign-in redirects", () => {
    for (const path of ["/login?returnTo=%2F", "/api/auth/callback?code=c&state=s", "/api/admin"]) {
      expect(legacyRedirectResponse(at(path)).headers.get("Cache-Control"), path).toBe("no-store");
    }
  });

  it("is a body-less 404 (the site's 404 page) for a path it doesn't know", () => {
    const res = legacyRedirectResponse(at("/api/auth/me"));
    expect(res.status).toBe(404);
    expect(res.body).toBeNull();
  });
});

describe("the redirect routes", () => {
  // Each legacy prefix has a route that hands the URL to legacyRedirectResponse.
  const ROUTES: [module: string, path: string, location: string][] = [
    ["../pages/map/[...path]", "/map/-0.1276/51.5072", "/?lat=51.5072&lng=-0.1276&zoom=16"],
    ["../pages/explorer/[...path]", "/explorer/search", "/dataset"],
    ["../pages/login", "/login?returnTo=%2Fabout", "/auth/login?returnTo=%2Fabout"],
    ["../pages/api/auth/[...path]", "/api/auth/logout", "/auth/logout"],
    ["../pages/api/admin", "/api/admin", "/cms/"],
    [
      "../pages/api/decap-oauth/[...path]",
      "/api/decap-oauth/callback?code=c",
      "/api/cms-oauth/callback?code=c",
    ],
  ];

  it.each(ROUTES)("%s redirects %s", async (module, path, location) => {
    const route = (await import(/* @vite-ignore */ module)) as {
      ALL: APIRoute;
      prerender: boolean;
    };
    expect(route.prerender).toBe(false);
    // biome-ignore lint/suspicious/noExplicitAny: a minimal stand-in for Astro's APIContext
    const res = (await route.ALL({ url: at(path) } as any)) as Response;
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe(location);
  });
});
