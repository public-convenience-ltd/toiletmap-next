# Toilet Map Client

The public-facing frontend for the Toilet Map platform. It renders a single Astro page with a Preact-powered LooMap that consumes the API defined in `apps/toiletmap-server/src/docs/openapi.ts`.

## Stack

- **Framework**: [Astro](https://astro.build)
- **UI Library**: [Preact](https://preactjs.com) islands (only the map hydrates)
- **Maps**: Leaflet + `leaflet.markercluster`
- **Deployment**: Cloudflare Workers via `@astrojs/cloudflare`
- **Styling**: Design tokens in the layout + component-scoped inline styles

## Configuration

| Variable         | Description                                                     | Default                |
| ---------------- | --------------------------------------------------------------- | ---------------------- |
| `PUBLIC_API_URL` | Base URL for the Toilet Map API (e.g. `https://api.example.com`) | `http://localhost:8787` |

- When running behind Wrangler, `PUBLIC_API_URL` is resolved per-request from `Astro.locals.runtime.env` so preview/staging origins can be injected by the worker.
- Additional auth/database settings live in the server repo; the client only needs the public API host.

## Development

```bash
pnpm install
pnpm run dev
```

This starts Astro locally on `localhost:4321`. Set `PUBLIC_API_URL` if the Worker/API is not running on the default port.

## Deployment

```bash
pnpm run build   # astro build (Cloudflare Worker bundle)
pnpm run deploy  # wrangler deploy
```

## Key Components

- `src/pages/index.astro` – entry page that mounts `<LooMap client:only="preact" />`.
- `src/components/LooMap.tsx` – clustered Leaflet map with adaptive geohash tiling, cross-precision caching, viewport-only rendering, the official Toilet Map marker (pink pin + optional star for accessible loos), and a debug overlay toggle.
- `docs/architecture.md` – full architecture notes (rendering strategy, fetching pipeline, bundling/debug guidance). Keep this up to date when changing the map.

## Debug Overlay

Click the “Show tiles” button in the map status pill to render the geohash boundaries currently being fetched. Each tile shows its hash prefix/precision so you can confirm caching behaviour while panning/zooming; click “Hide tiles” to remove the overlay. The neighbouring “Show stats” button surfaces the latest fetch metrics (markers added/removed, tile cache hits, fetch duration) both in the pill and `console.debug` to help diagnose performance.

## Performance Notes

- Geohash precision automatically coarsens (down to `/2`) at nationwide zoom levels so we only request a handful of tiles when zoomed out.
- Fetches are debounced by ~250 ms after pan/zoom and tile caches are reused across precisions so rapid movements stay responsive.
- Marker updates are diffed against the existing cluster, preventing flicker when 10k+ loos are visible at the highest zoom.
- Clustering stays active until zoom level 16, with `maxClusterRadius` shrinking from ~130 px at nationwide views to ~18 px near street level, so nearby loos split apart sooner while distant ones stay bundled.

For API details, refer to `apps/toiletmap-server/src/docs/openapi.ts` and the accompanying integration tests in `apps/toiletmap-server/test/integration`.
