# Toilet Map Client

The public-facing frontend for the Toilet Map, built with Astro and Preact.

## Stack

- **Framework**: [Astro](https://astro.build) 5.x (SSR mode)
- **UI Library**: [Preact](https://preactjs.com) (client-side hydration)
- **Deployment**: Cloudflare Workers
- **Styling**: CSS Modules
- **Map**: [Leaflet](https://leafletjs.com/) with [Supercluster](https://github.com/mapbox/supercluster) for marker clustering
- **Caching**: [idb-keyval](https://github.com/jakearchibald/idb-keyval) for IndexedDB storage

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

- Only allow-listed paths are forwarded: `/api/loos` and `/api/loos/*` (the only
  endpoints browser code calls). Anything else (e.g. the server's `/api/docs`
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
- Client IP is forwarded as `cf-connecting-ip` / `x-forwarded-for` for rate limiting.
- Upstream status, body and cache headers are returned; `set-cookie`,
  `access-control-*` and upstream `content-security-policy` are stripped. Every
  proxy response carries `content-security-policy: default-src 'none'; frame-ancestors 'none'`
  and `x-content-type-options: nosniff` (responses are JSON, never documents).

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

### Routes

- `/` - map
- `/loos/:id` - map with a toilet selected
- `/loos/:id/edit`, `/loos/add` - edit / add forms
- `/loo/*` - legacy aliases, 301-redirected to `/loos/*` (query string preserved)

### Caching Strategy

The application implements a two-tier caching approach using IndexedDB:

1. **Loos List Cache** (1-hour TTL)
   - Caches the compressed list of all loos
   - Reduces network requests and improves initial load time
   - Keys: `loos-cache`, `loos-cache-time`

2. **Individual Loo Details Cache** (persistent)
   - Caches detailed loo information by ID
   - Cache-first strategy: checks cache before fetching from API
   - Key: `loos-detail-cache`

All cache keys are centralized in [src/api/constants.ts](src/api/constants.ts).

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
and check the output lists `env.API (toiletmap-server)`.

Per-branch previews (`.github/workflows/deploy-preview.yml`) use a plain
`pnpm build` and `wrangler deploy --env preview --name <branch>-toiletmap-client`
with `--var` overrides; that works because a plain build has no target
environment and no service binding (previews reach their branch server over
`PUBLIC_API_URL`).

## Project Structure

```
src/
├── api/              # API client and configuration
│   ├── config.ts     # Centralized API URL configuration
│   ├── constants.ts  # Cache keys and constants
│   └── loos.ts       # Loo-related API functions
├── assets/           # Static assets (images, SVGs)
├── components/       # Preact components
│   └── LooMap.tsx    # Main map component with clustering
├── layouts/          # Astro layout components
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
- **Client-side clustering**: Supercluster groups nearby markers for better map performance
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
