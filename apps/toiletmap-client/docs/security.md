# Security headers, legacy redirects and sign-in

This covers the client worker's response headers and Content Security Policy (CSP), the
301 redirects from the legacy site's URLs, and how sign-in keeps people on their page.

| What | Code |
| --- | --- |
| Header values and policies (one source) | `src/utils/securityHeaders.ts` |
| The inline scripts the CSP allows | `src/utils/inlineScripts.ts` (Astro's island and directive scripts, `src/utils/shareButtonScript.ts`) |
| Pages and endpoints the worker renders | `src/middleware.ts` |
| Static assets (prerendered pages, `/cms`, `/_astro/*`) | `src/utils/staticSecurityHeaders.ts`, written into `dist/client/_headers` by `src/integrations/securityHeaders.ts` |
| CSP violation reports | `src/pages/api/csp-report.ts`, `src/utils/cspReport.ts` |
| Legacy redirects | `src/utils/legacyRedirects.ts` and one route per legacy prefix (table below) |
| Sign-in `returnTo` and error pages | `src/utils/returnTo.ts`, `src/pages/auth/*`, `src/utils/authError.ts` |
| Tests | `src/utils/*.test.ts` above, `src/contentImages.test.ts`, `e2e/csp.spec.ts`, `e2e/redirects.spec.ts`, `e2e/sign-in.spec.ts` |

## Headers

Every response gets these headers:

| Header | Value |
| --- | --- |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains`. Production only (`ENVIRONMENT=production`, over HTTPS; static assets: `pnpm build:production`). There's no `preload`, because that is a one-way commitment for the apex domain. |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` (`same-origin` on `/cms`) |
| `Permissions-Policy` | `geolocation=(self)` ("Find a toilet near me"). Everything else listed is `()`. `web-share` is left out: Chromium doesn't recognise it and logs a warning on every page, and the blog's Share button works without it. `fullscreen=()` would block a video embed in a post: allow it for `self` if posts ever embed one. |
| `X-Frame-Options` | `DENY` (with CSP `frame-ancestors 'none'`) |
| `Cross-Origin-Opener-Policy` | `same-origin`. `/cms` gets `same-origin-allow-popups`, so its GitHub sign-in popup keeps `window.opener`. `/api/cms-oauth/*` gets none: a `same-origin` popup would be cut off from the CMS window. |
| `Reporting-Endpoints` | `csp="/api/csp-report"` |
| CSP | See below. A route that sets its own CSP keeps it, as the CMS OAuth popup pages do (nonce-based, `src/utils/cmsOAuth.ts`). |

There are two delivery paths because static assets never run the worker:

- **Worker responses** (the map, toilets, forms, `/feedback`, `/dataset` and its `/dataset/*`
  downloads, the API proxy, redirects): the middleware adds the headers. It never reads the
  body: `script-src` lists the hashes of the inline scripts the site ships, whatever the page
  contains. It only adds headers a response lacks, so the downloads keep their own
  `Content-Disposition`, caching headers and `Access-Control-Allow-Origin: *`
  (`src/utils/dataset.ts`). They are not static assets, so `_headers` doesn't apply to them.
- **Static assets** (`/about`, `/posts/*`, `/app/privacy`, `/cms`, `/_astro/*`, images): the
  build appends `_headers` rules. A catch-all `/*` rule goes first, with the same hashes. The
  `/cms` and `/cms/*` rules go last. The build fails if a prerendered page has an inline
  script that isn't one of the site's own (raw HTML in a Markdown post, say).
- **Cloudflare quirks:**
  - `_headers` rules are keyed by path, so a second rule for a path replaces the first.
    `public/_headers` must not have rules for `/*`, `/cms` or `/cms/*`; the build fails if it
    does.
  - `! Name` (with the space) removes a header that an earlier rule set.
  - Lines over 2,000 characters are dropped silently, so the build fails instead.
- **`astro dev`** runs every page through the middleware, prerendered ones included. It
  doesn't apply `_headers`, so `/cms` has no headers in dev. `e2e/csp.spec.ts` adds the
  production policy to that response itself.

## Content Security Policy

The site's policy (`siteContentSecurityPolicy`):

```
default-src 'self';
script-src 'self' <sha256 hashes of the site's own inline scripts>;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
img-src 'self' data: blob: https://tile.openstreetmap.org
        https://avatars.githubusercontent.com https://upload.wikimedia.org;
font-src 'self' data: https://fonts.gstatic.com;
connect-src 'self';                 (astro dev adds ws: wss: for hot reload)
worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self';
frame-ancestors 'none';
report-uri /api/csp-report; report-to csp
```

- **Scripts:** the policy has no `'unsafe-inline'` and no `'unsafe-eval'`.
  - Astro emits inline scripts: the island loader and the `client:*` directive scripts. Their
    text comes from Astro's own prebuilt files, so an Astro upgrade updates the hashes too.
  - The blog's share button is an `is:inline` script whose text lives in
    `src/utils/shareButtonScript.ts`.
  - Each of these is allowed by its SHA-256 hash (`src/utils/inlineScripts.ts`), on every
    page. Hashes are never taken from a response, so a `<script>` that got into a page
    through a template or sanitisation bug, or a Markdown post, stays blocked once the
    policy is enforced. Inline event handlers (`onerror=`) are blocked too: there is no
    `'unsafe-hashes'`.
  - A new inline script must be added to `src/utils/inlineScripts.ts`. The build catches one
    on a prerendered page; `e2e/csp.spec.ts` catches one on a worker-rendered page.
  - Everything else is `'self'`: `/_astro/*` chunks and the Plausible script `/js/p.js`.
  - JSON-LD blocks are data, not scripts, so they need no hash.
  - Hashes were chosen over a nonce because prerendered pages can't carry a per-request
    nonce, and cached SSR pages must not reuse one.
- **Styles:** `'unsafe-inline'` is needed. Leaflet, Preact and Astro set inline styles, and
  Vite injects `<style>` in dev. The policy deliberately has no style hashes, because a hash
  would switch `'unsafe-inline'` off.
- **Connections:** everything is same-origin. That covers:
  - the API proxy `/api/*`, including `/api/geocode` and the Phase 6.2 legacy GraphQL
    `/api?query=`;
  - Plausible's `/api/event`;
  - the CMS status check.

  Auth0 sign-in and `/dataset` downloads are navigations, which CSP doesn't govern.
- **Images:** OSM tiles, `data:` and `blob:`, and the two remote hosts blog posts use
  (`REMOTE_IMAGE_ORIGINS`: an author's GitHub avatar and a Wikimedia Commons photo).
  `src/contentImages.test.ts` fails for a post or page image on any other host: copy it into
  `public/images/uploads` (where the CMS keeps uploads) or add the host.

`/cms` has its own policy (`cmsContentSecurityPolicy`) for Sveltia CMS. It allows:

- scripts from `'self'` and only the pinned package on unpkg,
  `https://unpkg.com/@sveltia/cms@<version>/` (`SVELTIA_CMS_VERSION`, which
  `src/cms.test.ts` checks against `public/cms/cms-loader.js`), not all of unpkg, where
  anyone can publish a package;
- connections to `https://api.github.com`, `https://raw.githubusercontent.com`,
  `https://www.githubstatus.com` and unpkg;
- images from `https://*.githubusercontent.com`, plus `blob:` and `data:`;
- Google Fonts, and `blob:` frames, media and workers.

### Report-only for now (`SITE_CSP_ENFORCED`, `CMS_CSP_ENFORCED`)

Both policies ship as `Content-Security-Policy-Report-Only`. Browsers report violations to
`/api/csp-report`, and each report becomes one `[csp] …` line in the worker logs (no query
strings; nothing stored). These things block enforcement:

1. **Only `astro dev` in Chromium so far.** `e2e/csp.spec.ts` passes with zero violations on
   desktop Chromium against `astro dev`. It covers the map, a toilet, the add, edit and report
   pages, a content page, the blog and every post (images and avatars included), `/feedback`,
   the kitchen sink, a sign-in error page and `/cms`. Report-only violations fire the same
   `securitypolicyviolation` event, so the spec works in either mode. Still to check: the
   production build on a preview, in Safari and Firefox too (watch the `[csp]` logs).
2. **Sveltia CMS signed in.** The spec only loads `/cms` up to its "sign-in isn't configured"
   notice. That's because loading Sveltia needs unpkg and GitHub, and tests make no live calls.
   Its full runtime needs (chunks, previews, fonts) are taken from Sveltia's documentation, not
   observed. Sign in once on a preview with the browser console open, or watch the `[csp]`
   logs.
3. **The production zone.** Cloudflare features on the real domain can inject inline scripts:
   Web Analytics, Rocket Loader, email obfuscation, bot-fight JavaScript detections. They can't
   be seen before the DNS cutover. Watch the `[csp]` logs for a week after cutover.

**Turning on enforcement** (owner: the repository owner; target: a week after the DNS
cutover with no unexplained `[csp]` reports). Until then the CSP only monitors: nothing it
lists is blocked, apart from framing, which `X-Frame-Options: DENY` covers anyway.

1. Set `SITE_CSP_ENFORCED = true` (and `CMS_CSP_ENFORCED` after a signed-in Sveltia session
   with no violations).
2. Run `pnpm --filter toiletmap-client test` and the `csp.spec.ts` e2e.
3. Deploy. The production policy then also gets `upgrade-insecure-requests`.

## Legacy URL redirects

These are all permanent (301) redirects. They are routes rather than middleware, because a
route always matches, while middleware wouldn't run for paths `astro dev` hands to the
prerendered catch-all page. The full table is unit-tested in
`src/utils/legacyRedirects.test.ts`.

| Legacy URL | New URL | Route |
| --- | --- | --- |
| `/map/:lng/:lat` (longitude first) | `/?lat=:lat&lng=:lng&zoom=16` (the legacy default zoom; other query parameters kept) | `src/pages/map/[...path].ts` |
| `/map/:lng/:lat/:zoom` | `/?lat=:lat&lng=:lng&zoom=:zoom` (zoom clamped to 0–19) | same |
| `/map`, and unreadable or out-of-range coordinates | `/` | same |
| `/explorer`, `/explorer/search`, `/explorer/*` | `/dataset` (Phase 6; the explorer's own query is dropped) | `src/pages/explorer/[...path].ts` |
| `/explorer/loos/:id` | `/loos/:id` | same |
| `/login` (legacy "Contributing / Log in" page) | `/auth/login`, with `?returnTo=` kept if it is same-origin | `src/pages/login.ts` |
| `/api/auth/login` | `/auth/login` (same `returnTo` rule) | `src/pages/api/auth/[...path].ts` |
| `/api/auth/logout` | `/auth/logout` | same |
| `/api/auth/callback?…` | `/auth/callback?…` (a stale Auth0 round trip then shows "Your sign-in expired") | same |
| `/api/admin` (legacy Decap CMS) | `/cms/` | `src/pages/api/admin.ts` |
| `/api/decap-oauth`, `/api/decap-oauth/callback` | `/api/cms-oauth/auth`, `/api/cms-oauth/callback` (query kept) | `src/pages/api/decap-oauth/[...path].ts` |

The old `/loo/*` paths go to `/loos/*` (`src/pages/loo/[...path].ts`, Phase 3).

**Caching:** `/login` and `/api/*` redirects are `no-store`, because they carry Auth0 codes or
lead to a session. The others are `public, max-age=3600`.

**Native, so no redirect:**

- `/`, `/loos/:id`, `/loos/:id/edit`, `/loos/:id/remove` and `/loos/add?lat&lng` (LooMap and the
  add form read `?lat&lng&zoom`);
- `/posts` and `/posts/:slug`;
- `/about`, `/contact`, `/privacy`, `/app` and `/app/privacy`;
- `/dataset` (Phase 6);
- the PDFs and `/images/uploads/*`;
- `/api/feedback` (POST, as before) and the GraphQL `/api` (Phase 6.2).

With Phases 6 and 6.2 merged, every `/explorer*` redirect and the footer's Dataset link land
on the real `/dataset` page.

**Not redirected (404):**

- `/api/auth/me`, the legacy JSON profile, which has no equivalent;
- `/api/cron/daily_export` and `/api/loos/:id/revalidate`, which were internal;
- the legacy-only static files `/site.webmanifest`, `/browserconfig.xml`,
  `/android-chrome-192x192.png`, `/mstile-150x150.png`, `/safari-pinned-tab.svg`,
  `/crosshair*.svg` and `/admin/config.yml`;
- `/images/uploads/8.19_bin_under_shelf.tif`, a 19 MB original that nothing links to (its
  `.jpg` is served);
- the legacy Plausible proxy paths (`/js/script.js`, `/proxy/api/event`), which only the
  legacy pages used.

`/auth0-bg.png` is still served (`public/auth0-bg.png`): nothing in the site uses it, but the
Auth0 Universal Login branding almost certainly points at it.

Check the table against a deployment with curl:
`curl -sI https://<host>/map/-0.1276/51.5072 | grep -i '^location'`.

## Sign-in: returnTo and error pages

- **Every "Sign in" link returns to the current page.**
  - **Header:** `SiteHeader` builds the link from the page the browser is on. It updates it
    again as the link is followed, because the map changes its URL (`/` to `/loos/:id`)
    without reloading.
  - **Other links:** the form, report and panel "Sign in" and "Sign in again" (401) links use
    `loginHref(currentPath(…))`.
  - **Pages with a fixed return or none:** the edit page uses its own URL; `/feedback` drops
    `?sent`; the 500 page and the error page itself have no return.
- **The round trip:** `/auth/login` keeps `returnTo` in a 5-minute httpOnly cookie, next to
  the `state` and `nonce` cookies. `/auth/callback` checks it again before redirecting.
- **Session cookies:** `/auth/callback` writes them only after every step that can fail, so a
  failure shows the error page and leaves no half-session. `access_token` and `id_token` are
  httpOnly; the only readable cookie is the value-less `signed_in=1` flag (src/utils/session.ts),
  so page JavaScript never sees a name, email or sub. The pre-2026-11 `user_info` cookie is
  deleted at sign-in and sign-out.
- **`safeReturnTo` accepts only a same-origin path.** It rejects:
  - absolute and protocol-relative URLs (`//host`);
  - backslashes (`/\host`);
  - control characters;
  - other schemes (`javascript:`);
  - the same tricks percent-encoded, up to three times (`/%2F%2Fhost`, `/%5Chost`, `/%09/`);
  - malformed escapes;
  - a value that only becomes one of these once normalised (`/./%2F/host` normalises to
    `/%2F/host`, which decodes to `//host`): the checks run again on the normalised path;
  - the sign-in routes themselves (`/auth/*`) and the legacy sign-in URLs that redirect into
    them (`/login`, `/api/auth/*`), compared decoded (`/%61uth/logout`), so signing in can't
    loop, go through Auth0 twice or sign straight out.
- **Error pages:** `/auth/callback` rewrites (not redirects) to `/auth/error` on
  `ContentLayout`. The details travel in `locals`, so a crafted URL can't put words on the page.

  | Case | Status | Page |
  | --- | --- | --- |
  | Auth0 `access_denied` or `unauthorized` | 403 | "Sign-in didn't go through". Shows Auth0's `error_description` only when the state matched, i.e. the round trip really started in this browser. |
  | Auth0 `temporarily_unavailable` or `server_error` | 503 | "Sign-in isn't working right now" |
  | Auth0 `login_required`, `consent_required` or `interaction_required`; no state cookie (over 5 minutes, or another browser); `invalid_grant` (code reused or expired) | 400 | "Your sign-in expired" |
  | State or nonce mismatch | 400 | "We stopped this sign-in" |
  | Missing code, other token failures | 400 | "We couldn't sign you in" |
  | An exception in the callback | 500 | "Something went wrong" |

  Each page has "Try signing in again" (keeping the `returnTo`), "Back to the map" and "Send
  feedback". Opening `/auth/error` directly shows fixed copy, chosen by `?reason=<kind>` at
  most.

## Cutover checklist (owner actions, not code)

These need the domain or owner access, so they are not done in code.

**Preconditions:** Phase 6 (`/dataset`) and Phase 6.2 (the GraphQL `/api` and `/api/`) are
merged and deployed, so the `/explorer*` redirects, the footer's Dataset link and old API
clients don't land on a 404.

- Point DNS for www and the apex at the client worker, and redirect the apex to www.
- Add `/auth/callback`, the logout return and the web origin for the real domain to the Auth0
  application.
- The server's `ALLOWED_ORIGINS` no longer has the `*.workers.dev` wildcard (exact origins
  only, never with credentials); add the real domain's origins there only if a third-party
  page needs to read the API from a browser.
- Give previews their own rate-limit namespaces, and move the preview secret to
  `wrangler secret`.
- Update the GitHub OAuth app the CMS signs in with (or create a new one): its callback must be
  `https://www.toiletmap.org.uk/api/cms-oauth/callback`, because the legacy
  `/api/decap-oauth/*` URLs now redirect there and GitHub refuses any other `redirect_uri`.
  Set the CMS OAuth secrets for it (`docs/cms.md`).
- Check the Auth0 Universal Login branding: its background image should still load from
  `https://www.toiletmap.org.uk/auth0-bg.png` (served from `public/`).
- Confirm every `toiletmap.org.uk` subdomain serves HTTPS before the apex sends HSTS with
  `includeSubDomains`.
- Note that the client's top-level `vars` say `ENVIRONMENT=production`, so a deploy without
  `--env` would send HSTS from the worker while its `_headers` (built without
  `CLOUDFLARE_ENV=production`) would not. Always deploy with `pnpm deploy`.
- Put the legacy site into read-only mode, then follow the decommission runbook in the plan.
- After cutover:
  - Watch `[csp]` log lines and 404s for about a week.
  - Then turn on CSP enforcement (above).
  - Consider HSTS `preload` only once every subdomain is HTTPS-only for good.
