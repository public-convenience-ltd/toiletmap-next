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

The client communicates with the toiletmap-server backend API:

**Centralized Configuration** ([src/api/config.ts](src/api/config.ts))
- Pure function `getApiUrl(baseUrl, path)` for constructing API URLs
- No mutable state - apiUrl is passed explicitly where needed

**Available Endpoints:**
- `GET /api/loos/dump` - Fetches compressed list of all loos (id, geohash, filterMask)
- `GET /api/loos/:id` - Fetches detailed information for a specific loo

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
1. Environment variable is defined in `wrangler.jsonc`
2. Astro accesses it via `Astro.locals.runtime.env.PUBLIC_API_URL` (server-side)
3. Passed to Preact components as props
4. Components pass `apiUrl` explicitly to API functions (immutable, no global state)

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

Deploy to Cloudflare Workers:

```bash
# Deploy to preview environment
pnpm run deploy

# Deploy to production
pnpm run deploy --env production
```

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
- Look for CORS errors (should not occur with localhost)
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
