# Toilet Map Client Architecture

`toiletmap-client` is the public UI for the Toilet Map platform. It renders a lightweight Astro site, backed by Preact islands, that calls the production API defined in `apps/toiletmap-server/src/docs/openapi.ts`.

## Stack & Runtime Model

- **Framework**: [Astro](https://astro.build) with SSR output (`output: "server"`).
- **UI layer**: Preact islands mounted with `client:only`, letting us tree‑shake everything except the interactive map.
- **Runtime**: Cloudflare Workers via `@astrojs/cloudflare`.
- **Styling**: Design tokens in the global layout + scoped inline styles inside islands.
- **Session storage**: Workers KV binding named `SESSION` (added automatically by the Cloudflare adapter).

## Rendering & Bundling Strategy

1. **Islands first** – Every interactive widget is an island (`<LooMap client:only="preact" ... />`). Static content keeps shipping zero JS.
2. **Dynamic Leaflet loading** – `src/components/LooMap.tsx` lazy‑loads Leaflet, `leaflet.markercluster`, and the related CSS via dynamic `import()` calls. Astro/Vite hoists those imports into a dedicated chunk so the initial HTML stays tiny.
3. **Asset inlining** – Marker images (`marker-icon.png`, `marker-shadow.png`, etc.) are imported as URLs which go through Vite’s asset pipeline, so they are cache‑friendly on Workers KV/Pages.
4. **Status overlay only** – The island renders one absolutely positioned status chip; all other UI is rendered by Leaflet/OSM tiles.

> **Tip:** If you add more client code, prefer lazy imports or additional islands so we keep the base payload close to the current ~12 kB gzipped JS (see `pnpm run build` output for the current chunk sizes).

## LooMap Subsystem

### Responsibilities

- Render a clustered Leaflet map focused on the UK (`DEFAULT_CENTER` / `DEFAULT_ZOOM`).
- Fetch toilets from `GET /api/loos/geohash/:prefix` using `compressed=true`.
- Decode the compressed payload into marker metadata and show feature badges in the popup.
- Keep the map responsive while moving/zooming by throttling and caching.
- Only render markers that intersect the current viewport (with a small padding) so off-screen loos do not impact DOM/cluster work.
- Diff marker additions/removals so the cluster layer never “flickers” during zoom/pan transitions.
- Provide a debug overlay so developers can visualise the geohash tiles currently backing the map.

### Data Contract & Compression

- The API contract comes from `apps/toiletmap-server/src/docs/openapi.ts` (`CompressedLoo` schema).
- Each entry is a tuple `[id: string, geohash: string, filterMask: number]`.
- The mask is generated in `apps/toiletmap-server/src/services/loo/mappers.ts` via `genLooFilterBitmask`. We mirror the same bit layout (`FILTER_MASKS`) to decode fields such as `accessible`, `noPayment`, `radar`, etc.
- Popups are rendered with a tiny HTML template. IDs are sanitized before string interpolation to prevent XSS, although geohashes/IDs are already predictable.

### Fetch & Bundling Pipeline

1. **Viewport tiling**
   - We derive Leaflet bounds + zoom, then choose a geohash precision using `PRECISION_BY_ZOOM`.
   - Precision drops as low as `/2` for nationwide views, meaning only a handful of coarse tiles are requested when zoomed out.
   - If the resulting tile set would exceed `MAX_TILE_REQUESTS` (200), we further degrade the precision (never lower than `/2`).
   - Tile IDs are generated with `ngeohash.bboxes`, deduplicated, and used as cache keys.
2. **Request throttling**
   - Move/zoom events schedule a fetch after ~260 ms (`FETCH_DEBOUNCE_MS`). Rapid pans collapse into one request.
   - Pending network calls are wrapped in an `AbortController` so new movements cancel the previous round trip.
3. **Batch fetching**
   - Tiles without a warm cache are grouped into batches of four (`FETCH_BATCH_SIZE`) to limit parallel connections.
   - Every response is validated (`parseCompressedResponse`) before being inflated into coordinates via `ngeohash.decode`.
4. **Caching**
   - Each tile is cached for five minutes (`TILE_TTL_MS`). Cached tiles are reused until they expire or the API URL changes.
   - Caching spans geohash precisions: if a `/3` tile is already in memory and the user zooms into a `/5` tile in the same region, we derive the subset directly from the cached parent rather than issuing another request. Derived tiles inherit the parent’s timestamp so they expire together.
   - Cache invalidation happens on component unmount and when the `apiUrl` prop changes (e.g., switching between staging/prod endpoints).
5. **Rendering**
   - Marker additions/removals are diffed against the existing cluster so we only touch the deltas, preventing the flicker that occurs when clearing/re-adding thousands of markers.
   - Clustering stays on until zoom ≥16, and the radius drops quickly (≈130 px at UK overview → ≈18 px near street level) so loos that are physically close together separate sooner without sacrificing nationwide performance. Cluster animation is disabled to avoid transient “old cluster” flicker when zooming.
   - Additions are batched through `addLayers` (allowing `leaflet.markercluster` to chunk internally), while removals happen lazily when loos fall outside the padded viewport.
   - Marker icons use the canonical Toilet Map pin (pink teardrop with white circle) and optionally swap the circle for a white star to highlight accessible loos—matching the shared design system.
   - A small status chip reports the number of loos, tiles, and the current geohash precision; errors are surfaced there too. The “Show stats” toggle exposes live fetch/cluster metrics for debugging performance.
6. **Debug overlay**
   - Clicking “Show tiles” in the status chip enables an overlay layer that renders each geohash tile’s bounding box + prefix/precision tag, letting developers confirm tiling/caching behaviour in real time.

### Error Handling & Observability

- Network/API errors are logged to `console.error` and reflected in the status chip.
- Abort errors are treated as expected churn and ignored.
- If the API payload shape ever drifts from the OpenAPI spec, the parser throws with enough context to show up in Cloudflare logs.

## Configuration & Environment

| Variable              | Purpose                                           | Default                          |
| --------------------- | ------------------------------------------------- | -------------------------------- |
| `PUBLIC_API_URL`      | Base URL for the Toilet Map API (Workers host).   | `http://localhost:8787` in dev   |
| `SESSION` KV binding  | Added by `@astrojs/cloudflare` for SSR sessions.  | Must exist in `wrangler.jsonc`   |

- `index.astro` resolves `PUBLIC_API_URL` first from the Worker runtime (`Astro.locals.runtime.env`) so preview deploys can inject per-request origins.
- All other configuration lives in the server repo (Supabase, Auth0, etc.).

## Project Structure (Client)

- `src/pages/index.astro` – entry route, mounts `<LooMap />`.
- `src/components/LooMap.tsx` – everything described above.
- `src/layouts/Layout.astro` – root HTML shell, injects design tokens + global styles.
- `docs/architecture.md` – this document (keep it in sync when touching map logic).

## Build & Deployment

- `pnpm install && pnpm run dev` – Astro dev server on `localhost:4321` proxying API calls to the Worker URL.
- `pnpm run build` – compiles the Worker bundle (see log for chunk sizes and asset list).
- `pnpm run deploy` – `wrangler deploy` using the Cloudflare adapter output in `dist/`.

Refer back to the API spec (`apps/toiletmap-server/src/docs/openapi.ts`) whenever you extend the map. Any new compressed payload fields should be documented there first, then decoded here to keep both halves aligned.
