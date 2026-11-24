# Toilet Map Client

The public-facing frontend for the Toilet Map, built with Astro and Preact.

## Stack

- **Framework**: [Astro](https://astro.build) 7.x (SSR mode)
- **UI Library**: [Preact](https://preactjs.com) (client-side hydration)
- **Deployment**: Cloudflare Workers
- **Styling**: CSS Modules
- **Map**: [Leaflet](https://leafletjs.com/) with [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) for marker clustering
- **Caching**: [idb-keyval](https://github.com/jakearchibald/idb-keyval) keeps the map dataset in IndexedDB

## Architecture

### Server-Side Rendering (SSR) with Client-Side Hydration

The application uses Astro's SSR mode with the Cloudflare adapter:
- Astro pages ([index.astro](src/pages/index.astro)) are server-rendered on Cloudflare Workers
- The LooMap component uses `client:only="preact"` for client-side-only rendering
- Environment variables flow from Cloudflare Workers → Astro → Preact components via props

### API Integration

The browser **never talks to toiletmap-server directly**. All browser API calls are
same-origin requests to `/api/*` on this worker, handled by the proxy in
[src/pages/api/[...path].ts](src/pages/api/[...path].ts) (logic in
[src/utils/api.ts](src/utils/api.ts) `proxyApiRequest`):

- Only allow-listed paths are forwarded: `/api/loos` and `/api/loos/*`, `POST
  /api/feedback` and `GET /api/geocode` (the endpoints browser code calls; other
  methods on `/api/geocode` get a 405). Anything else (e.g. the server's `/api/docs`
  Swagger UI) gets a 404 JSON response. Paths containing dot segments, encoded
  slashes/backslashes (`%2f`, `%5c`), backslashes or `//` are rejected. When the
  browser starts calling a new endpoint, add its prefix to `ALLOWED_API_PREFIXES`
  in [src/utils/api.ts](src/utils/api.ts).
- Upstream is the `API` service binding when configured (production), otherwise
  `PUBLIC_API_URL` (local dev, per-branch previews — preview client hosts are mapped
  to the matching `<branch>-toiletmap-server` host).
- Forwards method, body, query string and `accept`/`content-type`/`if-none-match`/
  `if-match` etc. The browser `Cookie` header is never forwarded.
- State-changing methods (anything but GET/HEAD/OPTIONS) must send an `Origin`
  equal to the site origin (CSRF protection, otherwise 403) and get
  `Authorization: Bearer <access_token>` attached from the httpOnly cookie.
  The access token is never rendered into HTML or exposed to page JS.
- Request bodies are capped at 128 KiB (`PROXY_MAX_BODY_BYTES`) while they are read,
  chunked bodies included; a bigger one gets a 413 without contacting upstream.
- Client IP is forwarded as `cf-connecting-ip` / `x-forwarded-for` for rate limiting.
- Upstream status, body and cache headers are returned; `set-cookie`,
  `access-control-*` and upstream `content-security-policy` are stripped. Every
  proxy response carries `content-security-policy: default-src 'none'; frame-ancestors 'none'`
  and `x-content-type-options: nosniff` (responses are JSON, never documents).
- **Exception: the legacy GraphQL API.** Exactly `/api` and `/api/` (what the Flutter
  app and other old clients call: `GET /api/?query=`, `POST /api`) are proxied to the
  server's read-only `/api/graphql` by `proxyLegacyGraphqlRequest`. These calls come
  from apps and other origins, so this route has no CSRF `Origin` check, never
  forwards cookies or attaches a token, passes upstream `access-control-*` headers
  through (the server decides CORS), and still forwards the client IP for rate
  limiting. Bodies are capped at 64 KiB while they are read (chunked bodies
  included), and the proxy's own `405`/`413` errors carry
  `access-control-allow-origin: *`. `/api/feedback` and every other path keep the
  rules above (the Flutter app's `POST /api/feedback` goes through the public
  feedback route, not GraphQL).

Pages therefore pass `apiUrl=""` to islands, and `getApiUrl("", path)` from
[src/api/config.ts](src/api/config.ts) yields relative URLs. Server-side (SSR)
fetches in `.astro` pages use `fetchApi(env, Astro.url, path)` from
[src/utils/api.ts](src/utils/api.ts), which goes straight upstream (binding or
`PUBLIC_API_URL`), not through the proxy.

**Available Endpoints (via `/api/*`):**
- `GET /api/loos/dump` - Fetches compressed list of all loos (id, geohash, filterMask)
- `GET /api/loos/updates?since=…` - Incremental changes since a timestamp
- `GET /api/loos/:id` - Fetches detailed information for a specific loo
- `POST /api/loos`, `PUT /api/loos/:id` - Create / update a loo
- `GET /api/geocode?q=…` - Place and postcode search for the map and location picker
  search boxes. The server asks postcodes.io, then OpenStreetMap's Nominatim (GB only,
  throttled and cached), so the browser never calls a geocoder itself; results from
  Nominatim are shown with OpenStreetMap's credit. Typing only looks postcodes up
  (`&mode=suggest`, never Nominatim, whose policy forbids autocomplete); place names are
  searched on Enter

### Routes

- `/` - map
- `/loos/:id` - map with a toilet selected
- `/loos/:id/edit`, `/loos/add` - edit / add forms
- `/loo/*` - legacy aliases, 301-redirected to `/loos/*` (query string preserved)
- `/dataset` - the open dataset page: downloads, fields, CC BY 4.0 licence
- `/dataset/latest/*`, `/dataset/archive/YYYY-MM-DD/*` - the export files (`toilets.json`, `toilets.csv`, `manifest.json`), streamed from the `EXPORTS` R2 bucket with ETag/304 and caching headers. The bucket is bound in `env.production` only: in dev and preview the page says downloads are live-site only and the files answer 503. See [the server's dataset export doc](../toiletmap-server/docs/operations/dataset-export.md).
- `/map/:lng/:lat`, `/explorer/*`, `/login`, `/api/auth/*`, `/api/admin`,
  `/api/decap-oauth/*` - the legacy site's URLs, 301-redirected (`?lat&lng` map view,
  `/dataset`, `/auth/*`, `/cms/`); the table is in [docs/security.md](docs/security.md)
- `/auth/login?returnTo=<path>`, `/auth/callback`, `/auth/logout`, `/auth/error` - sign-in,
  back to a same-origin path, with friendly error pages
- `/feedback` - message to the team (`POST /api/feedback` through the proxy; the email is
  optional). `?loo=<id>` makes it about one toilet ("Report a problem → Something else"
  links there) and stores `/loos/<id>` as the message's `route`. Works without JavaScript:
  the form posts to the page itself, which redirects to `?sent=1` on success
- `/about`, `/contact`, `/privacy`, `/app`, `/app/privacy` - text pages from
  `src/content/pages/*.md` (prerendered; `/app/privacy` is the app's store-listed policy)
- `/posts`, `/posts/<slug>` (the legacy slugs), `/posts/page/<n>` past 20 posts - the blog,
  from `src/content/posts/*.md` (prerendered). Uploads live at `/images/uploads/*`
- `/cms/` - Sveltia CMS for the pages and posts (noindex), signing in with GitHub through
  `/api/cms-oauth/*`; see [docs/cms.md](docs/cms.md)
- `/sitemap.xml` (and `/sitemap-<n>.xml` chunks past 45,000 URLs), `/robots.txt`,
  `/posts/rss.xml` - SEO endpoints; see [Layouts, meta and SEO](#layouts-meta-and-seo)
- any unknown path or toilet - the site's 404 page (`src/pages/404.astro`, real 404 status);
  unhandled errors - the prerendered 500 page (`src/pages/500.astro`)

### Layouts, meta and SEO

- `layouts/BaseLayout.astro` - the document and `<head>`: `title`, `description`,
  `canonical` (defaults to the page's path on `site`), `image`, `ogType`, `noindex`,
  `nofollow`, `jsonLd` (escaped by `serializeJsonLd`), plus a `head` slot. Preview and
  development deployments (`ENVIRONMENT`) are always `noindex, nofollow`.
- `layouts/MapLayout.astro` - map pages: one screen tall, no scrolling.
- `layouts/ContentLayout.astro` - text pages in the design system's `.prose` column
  (`Prose` in toiletmap-design-system), with `heading` and `before`/`after` slots.
- `components/SiteChrome/` - the header and footer for every page; the nav is defined once
  in `utils/siteNav.ts`. On prerendered pages the header reads the sign-in cookie in the
  browser.
- `/loos/:id` fetches the toilet on the server (`utils/looPage.ts`): unknown or invalid ids
  are a 404; removed toilets are a 200 with `noindex` (the panel explains and offers restore,
  so old links keep working); active ones get a title, description, canonical and schema.org
  `PublicToilet` JSON-LD (`utils/looSeo.ts`).
- `site` in `astro.config.ts` is `SITE_URL` or `https://www.toiletmap.org.uk`. robots.txt
  disallows `/cms`, `/auth`, `/api`, `/dev` and the contribution forms in production and
  everything on previews. The sitemap lists the fixed pages, the `pages` and `posts`
  collections (`src/content.config.ts`) and every active toilet from `/api/loos/dump`
  (503 with `Retry-After` when the API is down).

### Security headers

Every response carries HSTS (production), `nosniff`, `Referrer-Policy`, `Permissions-Policy`
(geolocation for this origin only), `X-Frame-Options: DENY`, COOP and a Content Security
Policy (report-only for now; violations are logged via `/api/csp-report`): from
`src/middleware.ts` for worker responses and from the generated `_headers` for static
assets. See [docs/security.md](docs/security.md).

### Caching Strategy

1. **Map dataset** (IndexedDB, persistent): the compressed list from `/api/loos/dump` in one
   versioned record (`loos-cache-v2`), kept current with `/api/loos/updates?since=<cursor>`
   and shared between tabs. See [src/api/mapCache.ts](src/api/mapCache.ts).
2. **Loo details** (in memory only, up to 200): revalidated with `If-None-Match`, so a reload
   starts empty. See [src/api/loos.ts](src/api/loos.ts).

Cache keys are in [src/api/constants.ts](src/api/constants.ts).

## Environment Variables

The application uses environment-specific configuration managed through `wrangler.jsonc`:

### `PUBLIC_API_URL`

The base URL for the toiletmap-server API.

**Configured in:** [wrangler.jsonc](wrangler.jsonc)

**Values by environment:**
- **Development**: `http://localhost:8787` (local server)
- **Preview**: `https://feat-setup-map-toiletmap-server.gbtoiletmap.workers.dev`
- **Production**: `https://toiletmap-server.gbtoiletmap.workers.dev`

**How it works:**
1. Environment variable is defined in `wrangler.jsonc` (previews override it per branch)
2. Read server-side only (`env` from `cloudflare:workers`) by the `/api/*` proxy and
   SSR fetches; it is not sent to the browser
3. In production the `API` service binding (`env.production.services` in
   `wrangler.jsonc`) takes precedence over `PUBLIC_API_URL`. The binding only
   exists in a build made with `CLOUDFLARE_ENV=production` (see
   [Deploy](#deploy)).

### `PLAUSIBLE_DOMAIN` (optional, off by default)

The site domain to count pageviews under in [Plausible](https://plausible.io). A plain var
(not a secret), unset everywhere today. When set (in `env.production.vars` in
`wrangler.jsonc`), pages load the script from our own origin (`/js/p.js`) and send events to
our `/api/event`, which forwards them to plausible.io; when unset, nothing is rendered and
both routes 404. See [docs/analytics.md](docs/analytics.md) for what is and isn't tracked
(GPC / Do Not Track are honoured) and the privacy policy wording it needs.

### `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` (optional, unset today)

The GitHub OAuth app the CMS signs in with (worker secrets). Until both are set,
`/api/cms-oauth/auth` and `/api/cms-oauth/callback` answer 503 "CMS sign-in isn't configured
yet" and `/cms/` says so. [docs/cms.md](docs/cms.md) explains how to create the app (callback
URL `https://www.toiletmap.org.uk/api/cms-oauth/callback`) and set them.

## Development

### Prerequisites

- Node.js 18+ (managed via `fnm` or `nvm`)
- pnpm 8+
- The toiletmap-server must be running (typically on port 8787)

### Setup

```bash
# Install dependencies
pnpm install

# Start development server
pnpm run dev
```

The development server will start at `http://localhost:4321` (or next available port).

### Local Development Tips

**Ensure the API server is running:**
```bash
# In the toiletmap-server directory
cd apps/toiletmap-server
pnpm run dev
```

The client expects the server at `http://localhost:8787` in development mode.

## Testing

```bash
pnpm test           # Vitest: unit, component and SSR render tests (run `pnpm build` first for the render test)
pnpm typecheck      # tsc + astro check (uses the pinned TypeScript 6; see AGENTS.md)
pnpm test:e2e       # Playwright against the local stack (Docker Supabase must be running)
```

See [e2e/README.md](e2e/README.md) for Playwright prerequisites, reuse of running servers and overrides.

## Building and Deployment

### Build

```bash
pnpm run build
```

This creates a production build in the `dist/` directory optimized for Cloudflare Workers.

### Preview

Test the production build locally:

```bash
pnpm run preview
```

### Deploy

The Astro Cloudflare adapter resolves the Wrangler environment **at build
time**: `astro build` flattens `wrangler.jsonc` into `dist/server/wrangler.json`
using the environment named by `CLOUDFLARE_ENV` (top-level config when unset),
and writes `.wrangler/deploy/config.json` so that a later `wrangler deploy` /
`wrangler versions upload` automatically uses that flattened file (no
`--config` needed). A plain `pnpm build` therefore has **no** `API` service
binding, and production would silently fall back to public `fetch` against
`PUBLIC_API_URL`.

```bash
# Production: builds with CLOUDFLARE_ENV=production (includes the API service
# binding and env.production vars), then deploys.
pnpm run deploy

# Preview: builds with CLOUDFLARE_ENV=preview, then uploads a new version.
pnpm run deploy:preview
```

`pnpm build:production` / `pnpm build:preview` run just the build step. The
`--env` passed to wrangler must match the build's environment: wrangler refuses
to deploy `--env preview` from a production build (and vice versa). Validate
without deploying via `pnpm build:production && pnpm exec wrangler deploy --env production --dry-run`
and check the output lists `env.API (toiletmap-server)` and `env.EXPORTS (toiletmap-exports)`.

> **Create the R2 bucket before the first production deploy.** The production
> build binds the `EXPORTS` R2 bucket (`toiletmap-exports`, the dataset
> downloads). Cloudflare rejects a deploy whose bucket does not exist, so until
> the owner has run `pnpm exec wrangler r2 bucket create toiletmap-exports`
> once, `pnpm run deploy` fails here, and so does the server's production
> deploy. Dry-runs and preview deploys do not need it. See
> [the dataset export runbook](../toiletmap-server/docs/operations/dataset-export.md#owner-setup-once).

Per-branch previews (`.github/workflows/deploy-preview.yml`) use
`pnpm build:preview` and `wrangler deploy --env preview --name <branch>-toiletmap-client`
with `--var` overrides (the preview env has no service binding either; previews
reach their branch server over `PUBLIC_API_URL`). It has to be the preview build,
not a plain `pnpm build`: prerendered pages (about, privacy, posts, ...) take
`ENVIRONMENT` at build time, and only `env.preview` sets it to `preview`, which
makes them `noindex`. The `--var` flags reach server-rendered pages only. The
workflow checks the built `about.html` carries the noindex tag before deploying.

## Project Structure

```
src/
├── api/              # API client and configuration
│   ├── config.ts     # Centralized API URL configuration
│   ├── constants.ts  # Cache keys and constants
│   └── loos.ts       # Loo-related API functions
├── assets/           # Static assets (images, SVGs)
├── components/       # Preact components
│   └── LooMap/       # Main map component with clustering
├── content/          # Markdown content collections (posts, pages; schema in content.config.ts)
├── layouts/          # BaseLayout, MapLayout, ContentLayout
├── pages/            # Astro pages (routes)
│   └── index.astro   # Homepage with map
└── env.d.ts          # TypeScript environment definitions
```

## Troubleshooting

### Map doesn't load

**Check the API server:**
- Ensure `toiletmap-server` is running on port 8787
- Check browser console for network errors
- Verify `PUBLIC_API_URL` is correctly configured

**Check browser console:**
- API calls should be same-origin `/api/*` requests; CORS errors mean something is
  bypassing the proxy
- Check for JavaScript errors in the map initialization

### API requests fail in production

**Verify environment configuration:**
- Check `wrangler.jsonc` has correct `PUBLIC_API_URL` for production
- Ensure the production API server is accessible
- Check Cloudflare Workers logs for errors

### Build errors

**Clear caches and reinstall:**
```bash
rm -rf node_modules .astro dist
pnpm install
pnpm run build
```

### TypeScript errors

**Regenerate Cloudflare types:**
```bash
pnpm wrangler types
```

This regenerates `worker-configuration.d.ts` with the latest environment variable types.

## Performance Optimization

- **Compressed data format**: Loos are fetched in a compressed format `[id, geohash, filterMask]`
- **Client-side clustering**: Leaflet.markercluster groups nearby markers for better map performance
- **IndexedDB caching**: Reduces redundant API calls
- **Geohash decoding**: Client-side geohash decoding reduces data transfer size

## Contributing

When adding new features:

1. **API calls**: Use the pure `getApiUrl(apiUrl, path)` helper from [src/api/config.ts](src/api/config.ts)
   - Always pass `apiUrl` explicitly as a parameter
   - Avoid mutable module-level state
2. **Constants**: Add new cache keys or constants to [src/api/constants.ts](src/api/constants.ts)
3. **Type safety**: Update TypeScript interfaces when modifying API responses
4. **Documentation**: Update this README with new features or configuration changes
