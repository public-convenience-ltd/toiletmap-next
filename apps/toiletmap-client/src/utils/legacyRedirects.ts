/**
 * Permanent (301) redirects from the legacy site's URLs (the Next.js toiletmap repo) to
 * this site's pages. The table in docs/security.md lists every one; legacyRedirects.test.ts
 * checks each.
 *
 * Paths the new site serves natively need no redirect: /, /loos/:id, /loos/:id/edit,
 * /loos/:id/remove, /loos/add, /posts, /posts/:slug, /about, /contact, /privacy, /app,
 * /app/privacy, /dataset (Phase 6) and the API under /api (the proxy, and the Phase 6.2
 * legacy GraphQL endpoint).
 *
 * Each redirect is a route (src/pages/map/[...path].ts and friends) calling
 * legacyRedirectResponse, rather than middleware: a route always matches, while middleware
 * would not run for paths `astro dev` hands to the prerendered catch-all page.
 */
import { toMapView } from "../components/LooMap/mapView";
import { loginHref, safeReturnTo } from "./returnTo";

/** The legacy map's default zoom (its MapState), for /map/:lng/:lat links without one. */
export const LEGACY_MAP_ZOOM = 16;

/** The dataset page (Phase 6), which replaces the legacy dataset explorer. */
export const DATASET_PATH = "/dataset";

const withSearch = (path: string, search: URLSearchParams): string => {
  const query = search.toString();
  return query ? `${path}?${query}` : path;
};

const segmentsOf = (pathname: string, prefix: string): string[] | null => {
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;
  return pathname
    .slice(prefix.length)
    .split("/")
    .filter((segment) => segment.length > 0);
};

const decode = (segment: string): string | null => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

/**
 * `/map/:lng/:lat` (legacy order: longitude first) and `/map/:lng/:lat/:zoom` open the map
 * there: `/?lat=…&lng=…&zoom=…` (LooMap reads it, see mapViewFromSearch). Bare `/map` and
 * anything unreadable go to the map's home view. Other query parameters (e.g. utm_*) are kept.
 */
function mapRedirect(segments: string[], search: URLSearchParams): string {
  const params = new URLSearchParams(search);
  for (const key of ["lat", "lng", "zoom"]) params.delete(key);
  if (segments.length < 2 || segments.length > 3) return withSearch("/", params);
  const [lng, lat, zoom] = segments.map(decode);
  const view = toMapView(lat, lng, zoom ?? String(LEGACY_MAP_ZOOM));
  if (!view) return withSearch("/", params);
  const location = new URLSearchParams({
    lat: String(view.lat),
    lng: String(view.lng),
    zoom: String(view.zoom),
  });
  for (const [key, value] of params) location.append(key, value);
  return `/?${location.toString()}`;
}

/**
 * `/explorer/loos/:id` is a toilet's page; the rest of the legacy explorer (its overview and
 * search) became the dataset page. The explorer's search parameters don't apply there.
 */
function explorerRedirect(segments: string[]): string {
  if (segments.length === 2 && segments[0] === "loos") {
    const id = decode(segments[1] ?? "");
    if (id) return `/loos/${encodeURIComponent(id)}`;
  }
  return DATASET_PATH;
}

/** `/login` and `/api/auth/login`: sign in, returning to a same-origin `returnTo` if given. */
function loginRedirect(search: URLSearchParams): string {
  return loginHref(safeReturnTo(search.get("returnTo")));
}

/**
 * The legacy site's Auth0 routes (nextjs-auth0's `/api/auth/[...auth0]`). The callback keeps
 * its query: a stale Auth0 round trip then lands on /auth/callback, which explains that the
 * sign-in expired. `/api/auth/me` (a JSON profile) has no equivalent: 404.
 */
function authRedirect(segments: string[], search: URLSearchParams): string | null {
  if (segments.length !== 1) return null;
  switch (segments[0]) {
    case "login":
      return loginRedirect(search);
    case "logout":
      return "/auth/logout";
    case "callback":
      return withSearch("/auth/callback", search);
    default:
      return null;
  }
}

/** The legacy Decap CMS GitHub sign-in (`/api/decap-oauth`, `/api/decap-oauth/callback`). */
function decapOAuthRedirect(segments: string[], search: URLSearchParams): string | null {
  if (segments.length === 0) return withSearch("/api/cms-oauth/auth", search);
  if (segments.length === 1 && segments[0] === "callback") {
    return withSearch("/api/cms-oauth/callback", search);
  }
  return null;
}

/** Where a legacy URL now lives, or null when it isn't a legacy URL this site redirects. */
export function legacyRedirectLocation(url: URL): string | null {
  // A trailing slash never changed the legacy page.
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  const search = url.searchParams;

  const map = segmentsOf(pathname, "/map");
  if (map) return mapRedirect(map, search);
  const explorer = segmentsOf(pathname, "/explorer");
  if (explorer) return explorerRedirect(explorer);
  if (pathname === "/login") return loginRedirect(search);
  const auth = segmentsOf(pathname, "/api/auth");
  if (auth) return authRedirect(auth, search);
  // The legacy Decap CMS page; the CMS is Sveltia at /cms/ now.
  if (pathname === "/api/admin") return "/cms/";
  const decap = segmentsOf(pathname, "/api/decap-oauth");
  if (decap) return decapOAuthRedirect(decap, search);
  return null;
}

/**
 * A 301 to the legacy URL's new home, or an empty 404 (no body or content type: every path
 * that can miss is an API path, such as /api/auth/me, where the site's 404 page would not help).
 */
export function legacyRedirectResponse(url: URL): Response {
  const location = legacyRedirectLocation(url);
  if (!location) return new Response(null, { status: 404, statusText: "Not Found" });
  // Sign-in redirects carry one-time values (Auth0's code and state) or lead to a session:
  // never cached. The rest may be cached, but not forever while the table can still change.
  const personal = url.pathname === "/login" || url.pathname.startsWith("/api/");
  return new Response(null, {
    status: 301,
    headers: {
      Location: location,
      "Cache-Control": personal ? "no-store" : "public, max-age=3600",
    },
  });
}
