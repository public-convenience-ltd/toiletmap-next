/**
 * The client's security headers and Content Security Policy, in one place.
 *
 * Two routes deliver them (docs/security.md):
 * - pages and endpoints the worker renders get them from src/middleware.ts
 *   (applySecurityHeaders);
 * - static assets (prerendered pages such as /about and /posts, /cms, /_astro/*) never reach
 *   the worker, so the build writes the same headers into dist/client/_headers
 *   (src/integrations/securityHeaders.ts, via staticHeadersRules).
 *
 * Both allow the same inline scripts: the hashes of the scripts the site itself ships
 * (src/utils/inlineScripts.ts), never of whatever a response happens to contain.
 *
 * Worker-safe: no Node or Astro imports (the build integration and the e2e spec use it too).
 */

/**
 * Whether the CSPs are enforced (`Content-Security-Policy`) or only reported
 * (`Content-Security-Policy-Report-Only`). Report-only until a browser run shows zero
 * violations: e2e/csp.spec.ts for the site, and Sveltia CMS signed in for /cms. See
 * docs/security.md ("Turning on enforcement") for what still blocks it.
 */
export const SITE_CSP_ENFORCED = false;
export const CMS_CSP_ENFORCED = false;

export const CSP_HEADER = "Content-Security-Policy";
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";

/** Same-origin endpoint that logs CSP violation reports (src/pages/api/csp-report.ts). */
export const CSP_REPORT_PATH = "/api/csp-report";
/** Reporting API group name (the `Reporting-Endpoints` header and `report-to`). */
export const CSP_REPORT_GROUP = "csp";

/** Two years, as on toiletmap-server. No `preload`: that is a one-way commitment for the apex. */
export const HSTS_VALUE = "max-age=63072000; includeSubDomains";

/**
 * Geolocation is the map's "Find a toilet near me", for this origin only. Every other
 * powerful feature listed is off for the page and any frame. Only names every browser we
 * support recognises: an unknown one logs a console warning on every page load (Chromium
 * doesn't know `web-share`, so it is left out; the blog's Share button works without it, as
 * a top-level same-origin document is allowed by default). `fullscreen` is off too: allow it
 * for this origin if a post ever embeds a video player.
 */
export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "browsing-topics=()",
  "camera=()",
  "display-capture=()",
  "encrypted-media=()",
  "fullscreen=()",
  "geolocation=(self)",
  "gyroscope=()",
  "hid=()",
  "idle-detection=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "picture-in-picture=()",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "serial=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

/** OpenStreetMap's tile server (the map and the add/edit location picker). */
export const OSM_TILE_ORIGIN = "https://tile.openstreetmap.org";
/**
 * Remote image hosts blog posts use: an author's GitHub avatar and a Wikimedia Commons photo.
 * src/contentImages.test.ts fails for a post or page image on any other host: copy it into
 * public/images/uploads (where the CMS keeps uploads) or add its host here.
 */
export const REMOTE_IMAGE_ORIGINS = [
  "https://avatars.githubusercontent.com",
  "https://upload.wikimedia.org",
] as const;
const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com";
const GOOGLE_FONTS_FILES = "https://fonts.gstatic.com";

export interface SiteCspOptions {
  /** `'sha256-…'` sources for the site's own inline scripts (src/utils/inlineScripts.ts). */
  scriptHashes?: readonly string[];
  /** `astro dev`: also allow Vite's hot-reload WebSocket. */
  dev?: boolean;
  /** Add `upgrade-insecure-requests` (ignored, with a console warning, in report-only). */
  upgradeInsecureRequests?: boolean;
}

/**
 * The site's policy (every page except /cms).
 *
 * - script-src: this origin plus the hashes of the inline scripts the site ships (Astro's
 *   island loader and directive scripts, the blog's share-button script). No 'unsafe-inline'
 *   and no 'unsafe-eval'.
 * - style-src 'unsafe-inline': Leaflet, Preact and Astro set inline styles, and Vite injects
 *   <style> elements in dev. Deliberately no style hashes: a hash would switch
 *   'unsafe-inline' off.
 * - img-src: OSM tiles, data: (Leaflet's and the design system's inline images), blob: and
 *   the remote image hosts blog posts use (REMOTE_IMAGE_ORIGINS).
 * - connect-src 'self': the API proxy (/api/*, including /api/geocode and the legacy
 *   GraphQL /api?query=), Plausible's /api/event and the CMS status check are all
 *   same-origin. Auth0 sign-in is a top-level navigation, which CSP doesn't govern.
 * - frame-ancestors 'none' (with X-Frame-Options: DENY for older browsers).
 */
export function siteContentSecurityPolicy({
  scriptHashes = [],
  dev = false,
  upgradeInsecureRequests = false,
}: SiteCspOptions = {}): string {
  const directives = [
    "default-src 'self'",
    ["script-src 'self'", ...uniqueSorted(scriptHashes)].join(" "),
    `style-src 'self' 'unsafe-inline' ${GOOGLE_FONTS_CSS}`,
    ["img-src 'self' data: blob:", OSM_TILE_ORIGIN, ...REMOTE_IMAGE_ORIGINS].join(" "),
    `font-src 'self' data: ${GOOGLE_FONTS_FILES}`,
    dev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(upgradeInsecureRequests ? ["upgrade-insecure-requests"] : []),
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to ${CSP_REPORT_GROUP}`,
  ];
  return directives.join("; ");
}

/**
 * The Sveltia CMS version public/cms/cms-loader.js loads (pinned, with SRI). src/cms.test.ts
 * checks the two agree: upgrade both together.
 */
export const SVELTIA_CMS_VERSION = "0.258.1";
/**
 * Scripts may come only from that exact package version on unpkg, not from all of unpkg
 * (where anyone can publish a package). Exact-version URLs don't redirect, so the path
 * match holds.
 */
export const SVELTIA_SCRIPT_SOURCE = `https://unpkg.com/@sveltia/cms@${SVELTIA_CMS_VERSION}/`;
/** Fetching from the CDN (never running what it returns: no 'unsafe-eval'). */
const SVELTIA_CDN = "https://unpkg.com";

/**
 * /cms (Sveltia CMS). Sveltia's documented needs for a GitHub backend: its code from the pinned
 * package on unpkg, the GitHub API and raw file contents, GitHub-hosted images (avatars, media
 * previews), blob:/data: previews and Google Fonts. Its "Sign in with GitHub" popup opens
 * /api/cms-oauth/auth on this origin, which CSP doesn't govern (see also COOP below).
 */
export function cmsContentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${SVELTIA_SCRIPT_SOURCE}`,
    `style-src 'self' 'unsafe-inline' ${GOOGLE_FONTS_CSS}`,
    "img-src 'self' data: blob: https://*.githubusercontent.com",
    "media-src 'self' blob:",
    `font-src 'self' data: ${GOOGLE_FONTS_FILES}`,
    `connect-src 'self' blob: data: ${SVELTIA_CDN} https://api.github.com https://raw.githubusercontent.com https://www.githubstatus.com`,
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to ${CSP_REPORT_GROUP}`,
  ].join("; ");
}

/** /cms and everything under it. */
export function isCmsPath(pathname: string): boolean {
  return pathname === "/cms" || pathname.startsWith("/cms/");
}

/** The CMS's GitHub sign-in popup (src/pages/api/cms-oauth/*). */
function isCmsOAuthPath(pathname: string): boolean {
  return pathname.startsWith("/api/cms-oauth/");
}

/**
 * Cross-Origin-Opener-Policy for a path: `same-origin` everywhere, except
 * - /cms: `same-origin-allow-popups`, so the GitHub sign-in popup keeps `window.opener`;
 * - /api/cms-oauth/*: none, because a popup with `same-origin` would be cut off from the
 *   /cms window it reports back to.
 */
export function crossOriginOpenerPolicy(pathname: string): string | null {
  if (isCmsOAuthPath(pathname)) return null;
  if (isCmsPath(pathname)) return "same-origin-allow-popups";
  return "same-origin";
}

export interface SecurityHeaderOptions {
  pathname: string;
  /** HSTS is only sent by production over HTTPS. */
  production: boolean;
  https: boolean;
}

/** Every header except the CSP, for one response. */
export function baseSecurityHeaders({
  pathname,
  production,
  https,
}: SecurityHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": PERMISSIONS_POLICY,
    "X-Frame-Options": "DENY",
    "Reporting-Endpoints": `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`,
  };
  const coop = crossOriginOpenerPolicy(pathname);
  if (coop) headers["Cross-Origin-Opener-Policy"] = coop;
  if (production && https) headers["Strict-Transport-Security"] = HSTS_VALUE;
  return headers;
}

/** `[header name, policy]` for a path: the CMS's own policy under /cms, the site's elsewhere. */
export function contentSecurityPolicyFor(
  pathname: string,
  site: SiteCspOptions,
): [name: string, value: string] {
  if (isCmsPath(pathname)) {
    return [CMS_CSP_ENFORCED ? CSP_HEADER : CSP_REPORT_ONLY_HEADER, cmsContentSecurityPolicy()];
  }
  return [
    SITE_CSP_ENFORCED ? CSP_HEADER : CSP_REPORT_ONLY_HEADER,
    siteContentSecurityPolicy({
      ...site,
      // Meaningless (and a console warning) in a report-only policy.
      upgradeInsecureRequests: SITE_CSP_ENFORCED && site.upgradeInsecureRequests,
    }),
  ];
}

/**
 * Script types a browser runs (and so checks against script-src). JSON-LD and other data
 * blocks are not scripts. Import maps and speculation rules are checked like scripts.
 */
const EXECUTABLE_SCRIPT_TYPES = new Set([
  "",
  "module",
  "text/javascript",
  "application/javascript",
  "application/ecmascript",
  "text/ecmascript",
  "importmap",
  "speculationrules",
]);

const SCRIPT_ELEMENT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const SRC_ATTRIBUTE = /(?:^|\s)src\s*=/i;
const TYPE_ATTRIBUTE = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

/** The text of each inline script in `html` that a browser would run. */
export function inlineScripts(html: string): string[] {
  const scripts: string[] = [];
  for (const [, attributes = "", content = ""] of html.matchAll(SCRIPT_ELEMENT)) {
    if (SRC_ATTRIBUTE.test(attributes)) continue;
    const type = TYPE_ATTRIBUTE.exec(attributes);
    const value = (type?.[1] ?? type?.[2] ?? type?.[3] ?? "").trim().toLowerCase();
    if (!EXECUTABLE_SCRIPT_TYPES.has(value)) continue;
    scripts.push(content);
  }
  return scripts;
}

/** `'sha256-…'` source expression for one script's text, as browsers hash it. */
export async function scriptHash(script: string): Promise<string> {
  // The HTML parser turns CRLF and lone CR into LF before the script text exists.
  const text = script.replace(/\r\n?/g, "\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return `'sha256-${btoa(binary)}'`;
}

/** Hashes of every inline script in `html` (deduplicated, sorted). For build checks only. */
export async function inlineScriptHashes(html: string): Promise<string[]> {
  return uniqueSorted(await Promise.all(inlineScripts(html).map(scriptHash)));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export interface ApplyOptions {
  url: URL;
  /**
   * `'sha256-…'` sources script-src allows: the site's own inline scripts
   * (knownInlineScriptHashes in src/utils/inlineScripts.ts). Never hashes of the response.
   */
  scriptHashes: readonly string[];
  /** The worker's ENVIRONMENT var. */
  environment: string | null | undefined;
  /** `astro dev`. */
  dev: boolean;
}

/** HSTS only from the production worker (never `astro dev`, preview or anything unknown). */
export function isProduction(environment: string | null | undefined, dev: boolean): boolean {
  return !dev && (environment ?? "").trim().toLowerCase() === "production";
}

/**
 * `response` with the security headers added (src/middleware.ts). The body is passed through
 * unread: the policy allows the site's known inline scripts, whatever the page contains.
 * Headers a route set itself win: the CMS OAuth popup pages send their own nonce-based CSP,
 * so a response that already has a CSP keeps it.
 */
export function applySecurityHeaders(
  response: Response,
  { url, scriptHashes, environment, dev }: ApplyOptions,
): Response {
  // Informational responses (a WebSocket upgrade) can't be rebuilt, and carry no document.
  if (response.status < 200) return response;
  const production = isProduction(environment, dev);
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(
    baseSecurityHeaders({ pathname: url.pathname, production, https: url.protocol === "https:" }),
  )) {
    if (!headers.has(name)) headers.set(name, value);
  }

  const hasOwnCsp = headers.has(CSP_HEADER) || headers.has(CSP_REPORT_ONLY_HEADER);
  if (!hasOwnCsp) {
    const [name, value] = contentSecurityPolicyFor(url.pathname, {
      scriptHashes,
      dev,
      upgradeInsecureRequests: production,
    });
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
