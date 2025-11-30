# AGENTS.md

> **Purpose**: This document provides AI coding assistants with essential context about the Toilet Map API project to enable effective contributions.

**Workspace layout**: This repository is a pnpm monorepo. The API/Admin worker now lives in `apps/toiletmap-server` (all paths below are relative to that directory unless noted). A placeholder frontend worker is available in `apps/toiletmap-client`.

## Project Overview

**Toilet Map API** is a REST API service and admin interface for managing public toilet data, deployed as a [Cloudflare Worker](https://workers.cloudflare.com/). Built on the [Hono](https://hono.dev/) framework, it provides CRUD operations for toilet records with geospatial queries, audit trails, authentication, and a server-side rendered admin dashboard.

### Key Technologies

- **Runtime**: Cloudflare Workers with Node.js compatibility mode
- **Framework**: [Hono](https://hono.dev/) v4.10+ (edge-optimized web framework)
- **Database**: PostgreSQL with PostGIS extension via Supabase
- **ORM**: Prisma v7+ with Cloudflare adapter (`@prisma/adapter-pg`)
- **Validation**: Zod v4+ for runtime schema validation
- **Authentication**: Auth0 JWT validation (RS256 tokens) + OAuth2 flow
- **Admin UI**: Server-side JSX rendering (Hono JSX, not React)
- **Testing**: Vitest with E2E integration tests
- **Deployment**: Wrangler CLI for Cloudflare Workers

## Architecture

### Core Structure

```
src/
├── app.ts                     # Hono app setup, route registration
├── index.ts                   # Cloudflare Worker entry point
├── types.ts                   # Shared TypeScript types
├── prisma.ts                  # Prisma client factory (runtime-aware)
├── routes/                    # HTTP route handlers (thin layer)
│   ├── loos/                  # Loo CRUD + query endpoints
│   │   ├── index.ts           # Route handlers
│   │   └── schemas.ts         # Zod request validation
│   ├── areas/                 # Area lookup endpoints
│   └── shared/                # Shared validation utilities
├── services/                  # Business logic & data access
│   ├── loo/                   # Loo domain services
│   │   ├── loo.service.ts     # Main service class (CRUD operations)
│   │   ├── sql.ts             # Complex PostGIS queries
│   │   ├── mappers.ts         # DB → API response transformers
│   │   ├── mutation.ts        # Mutation field mapping
│   │   ├── persistence.ts     # Low-level insert/update
│   │   └── types.ts           # Domain types & Zod schemas
│   └── area.service.ts        # Area domain service
├── middleware/                # Additional middleware
│   └── require-admin-role.ts  # Role-based access control
├── admin/                     # Admin interface (SSR with Hono JSX)
│   ├── index.tsx              # Admin router
│   ├── auth.ts                # OAuth2 flow handlers
│   ├── pages/                 # Admin pages
│   │   ├── loos/              # Loo management UI
│   │   │   ├── list.tsx       # Dataset explorer
│   │   │   └── create.tsx     # Loo creation form
│   │   └── users/             # User analytics + Auth0 tooling
│   │       ├── index.tsx      # User statistics (contributor insights)
│   │       └── admin.tsx      # Auth0 permission management
│   └── components/            # Reusable UI components
├── auth/                      # Authentication utilities
│   ├── auth-context.ts        # Request auth resolver + enrichment
│   ├── middleware.ts          # Shared Hono middleware (API + admin)
│   ├── session.ts             # Cookie session management
│   ├── userinfo.ts            # Auth0 /userinfo fetch helper
│   └── verify.ts              # JWT verification + JWKS cache
├── docs/                      # OpenAPI documentation
│   ├── openapi.ts             # OpenAPI spec generation
│   └── generate.ts            # Doc generation script
└── generated/
    └── prisma/                # Generated Prisma client (Cloudflare runtime)

test/
├── integration/               # E2E integration tests
│   ├── setup.ts               # Test environment setup
│   ├── health.spec.ts         # Health check tests
│   ├── areas.spec.ts          # Area endpoint tests
│   ├── loos.read.spec.ts      # Read operation tests
│   ├── loos.mutation.spec.ts  # Create/update tests
│   ├── loos.dataset.spec.ts   # Search & metrics tests
│   ├── auth-cookies.spec.ts   # Session auth tests
│   └── utils/
│       ├── auth-server.ts     # Mock JWKS server
│       ├── test-client.ts     # Direct Worker invocation
│       ├── fixtures.ts        # Test data factories
│       └── cleanup.ts         # Database cleanup
└── admin/
    └── admin.spec.ts          # Admin UI tests
```

### Data Flow

1. **Request** → Route handler validates input with Zod schemas
2. **Route** → Delegates to service layer (`src/services/loo/`)
3. **Service** → Executes business logic, queries database via Prisma or raw SQL
4. **Mappers** → Transform database records to API response schemas
5. **Response** → JSON returned to client

### Key Files

- **`src/app.ts`**: Main Hono application with route registration and middleware
- **`src/index.ts`**: Cloudflare Worker entry point (exports `fetch` handler)
- **`src/services/loo/`**: Core domain logic for toilet records
  - `loo.service.ts`: Main service class with CRUD operations
  - `sql.ts`: Complex SQL queries using Prisma raw SQL (PostGIS functions)
  - `mappers.ts`: Transform DB models to API responses
  - `types.ts`: Zod schemas for request/response validation
- **`src/routes/loos/schemas.ts`**: Request validation schemas (including opening hours logic)
- **`src/admin/`**: Server-side rendered admin interface (Hono JSX)
- **`test/integration/`**: Executable documentation for all endpoints

## Domain Model

### Primary Entity: `toilets` (Toilet Record)

Key fields:
- **Identity**: `id` (24-char hex), `geohash` (geospatial indexing, auto-generated)
- **Location**: `geography` (PostGIS Point), `location` (GeoJSON, auto-generated), `area_id` (FK to areas)
- **Features**: `accessible`, `no_payment`, `baby_change`, `radar`, `attended`, `automatic`, `urinal_only`, `all_gender`, `children`, `men`, `women`
- **Metadata**: `created_at`, `updated_at`, `verified_at`, `active` (soft delete flag), `contributors` (text array)
- **Opening Hours**: 7-element JSON array `[Monday, ..., Sunday]`
  - Each day: `["HH:mm", "HH:mm"]` (open/close times)
  - Empty array `[]`: closed or unknown
  - **Special case**: `["00:00", "00:00"]` represents "open 24 hours" (not a validation error!)
- **Text Fields**: `name`, `notes`, `payment_details`, `removal_reason`

### Audit Trail: `record_version`

All mutations to `toilets` records create audit entries tracking:
- Contributor information (`auth_uid`)
- Timestamp (`ts`)
- Operation type (`op`: INSERT, UPDATE, DELETE)
- Full snapshot of changed fields (`record`)
- Previous state (`old_record`)
- Database metadata (table OID, schema, name)

### Administrative Areas: `areas`

- `id` (24-char hex)
- `name` (unique), `type` (e.g., "district", "county")
- `geometry` (PostGIS geography)
- `priority`, `dataset_id`, `version`

## Authentication & Authorization

### Two Authentication Methods

1. **Bearer Token (API clients)**:
   - Send `Authorization: Bearer <JWT>` header
   - RS256 JWT signed by Auth0
   - Validated against JWKS from `AUTH0_ISSUER_BASE_URL`

2. **Session Cookie (Admin interface)**:
   - HTTP-only cookies set by OAuth2 flow
   - `access_token`, `id_token`, `user_info` cookies
   - Used for admin UI authentication

### Middleware Flow

**`optionalAuth`, `requireAuth`, `requireAdminAuth`** (`src/auth/middleware.ts`):
1. Attempt to authenticate via `Authorization: Bearer` header.
2. Fall back to session cookies (`access_token` → `id_token`).
3. Enrich `c.user` with Auth0 userinfo (cookie payload or `/userinfo` call) so `name`, `email`, etc. are always present on the request user (and mirrored under `user.profile`).
4. `optionalAuth` skips auth if no credentials are provided, `requireAuth` returns `401`, and `requireAdminAuth` redirects to `/admin/login`.

**`requireAdminRole` middleware** (`src/middleware/require-admin-role.ts`):
- Checks for `access:admin` permission in JWT claims
- Used to reveal contributor info in audit reports
- Protects admin-only routes

### OAuth2 Flow (Admin Interface)

Flow implemented in `src/admin/auth.ts`:
1. **GET /admin/login** → Redirect to Auth0 authorize endpoint
2. User authenticates on Auth0
3. **GET /admin/callback** → Exchange authorization code for tokens
4. Set HTTP-only cookies (`id_token`, `access_token`, `user_info`)
5. Redirect to `/admin`
6. **GET /admin/logout** → Clear all cookies

### Environment Variables (Auth)

```bash
# Required
AUTH0_ISSUER_BASE_URL=https://your-tenant.auth0.com/
AUTH0_AUDIENCE=https://www.toiletmap.org.uk/api
AUTH0_CLIENT_ID=your_client_id              # OAuth2 client ID
AUTH0_CLIENT_SECRET=your_client_secret      # OAuth2 client secret (Cloudflare secret)
AUTH0_REDIRECT_URI=https://your-worker.workers.dev/admin/callback  # Fallback; actual redirect uses the incoming request origin
AUTH0_MANAGEMENT_CLIENT_ID=mgmt_client_id   # Auth0 Management API client (M2M)
AUTH0_MANAGEMENT_CLIENT_SECRET=mgmt_secret  # Store as a secret

# Optional
AUTH0_PROFILE_KEY=app_metadata.contributor_name  # Nested claim for contributor name
AUTH0_SCOPE=openid profile email offline_access roles access:admin
# Override defaults for the Auth0 Management API audience (defaults to https://<tenant>/api/v2/)
# AUTH0_MANAGEMENT_AUDIENCE=https://your-tenant.auth0.com/api/v2/
```

## API Endpoints

### Public Endpoints (No Auth Required)

- **GET /** - Health check
- **GET /api/docs** - Swagger UI
- **GET /api/docs/openapi.json** - OpenAPI spec
- **GET /admin/login** - Initiate OAuth2 flow
- **GET /admin/callback** - OAuth2 callback handler
- **GET /api/areas** - List administrative areas (name and type only)
- **GET /api/loos/:id** - Fetch single loo by ID
- **GET /api/loos?ids=** - Batch fetch loos (comma-separated or repeated `?ids=` params)
- **GET /api/loos/geohash/:geohash** - Search by geohash prefix (optional `?active=true/false/any`)
- **GET /api/loos/proximity** - Find nearby loos (`lat`, `lng` required, optional `radius`)
- **GET /api/loos/search** - Advanced search with filters, sorting, pagination
- **GET /api/loos/metrics** - Aggregate metrics for filtered results
- **GET /api/loos/:id/reports** - Audit history (contributors redacted unless caller has `access:admin`)

Public routes still accept optional authentication so admin tokens can unlock extra data (e.g., contributor names in reports).

### Protected API Endpoints (JWT or Session Required)

- **POST /api/loos** - Create new loo (requires contributor info in JWT)
- **PUT /api/loos/:id** - Upsert (create or update) loo (requires contributor info in JWT)

### Admin Interface Routes (Session Auth Required)

- **GET /admin** - Admin dashboard
- **GET /admin/loos** - Dataset explorer with filters, search, metrics, and pagination
- **GET /admin/loos/create** - Loo creation form
- **POST /admin/loos** - Create loo via admin form (form submission)
- **GET /admin/users/statistics** (alias `/admin/users`) - Contributor analytics / user statistics dashboard
- **GET /admin/users/admin** - Auth0-backed user administration (view + edit permissions)
- **POST /admin/users/admin/permissions** - Toggle `access:admin` / `report:loo` via Auth0 Management API
- **GET /admin/logout** - Clear session and redirect to login

## Development Workflows

### Setup

```bash
pnpm install                   # Install dependencies
cp .env.example .env           # Configure environment variables
pnpm prisma:generate           # Generate Prisma client
pnpm supabase:start            # Start local Postgres (Docker)
pnpm dev                       # Start dev stack (Wrangler + Vite + auth server)
```

### Common Commands

```bash
pnpm dev                       # Start Cloudflare Workers dev stack (incl. auth server)
pnpm dev:api                   # Start Wrangler + Vite only (use with real Auth0)
pnpm start                     # Alias for dev
pnpm build                     # Build for production (generates Prisma client)
pnpm check                     # TypeScript type checking + dry-run deploy
pnpm typecheck                 # TypeScript type checking only
pnpm deploy                    # Deploy to Cloudflare Workers

# Database
pnpm prisma:generate           # Generate Prisma clients (both runtimes)
pnpm supabase:start            # Start Supabase (Postgres + PostGIS)
pnpm supabase:stop             # Stop Supabase
pnpm supabase:reset            # Reset DB with migrations + seed data

# Testing
pnpm test:e2e                  # Run all E2E tests
KEEP_SUPABASE=1 pnpm test:e2e  # Keep DB running between test runs
pnpm vitest run test/integration/loos.read.spec.ts  # Run single test file

# Documentation
pnpm docs:generate             # Generate OpenAPI spec
```

### Testing Strategy

- **E2E Suite**: 7 test files in `test/integration/` covering all endpoints
- **Test Client**: Direct Worker invocation via `app.fetch()` (no HTTP server)
- **Database**: Supabase auto-starts if not running (set `KEEP_SUPABASE=1` to persist between runs)
- **Auth**: Mock JWKS server at `http://127.0.0.1:44555/` issues deterministic test tokens
- **Fixtures**: Reusable test data factories in `test/integration/utils/fixtures.ts`
- **Cleanup**: Automated database cleanup between tests

### Prisma Workflow

The project uses **dual Prisma clients** to support both Cloudflare Workers and Node.js test environments:

1. **Cloudflare Workers client**: `src/generated/prisma/` (uses `@prisma/adapter-pg`)
2. **Node.js test client**: `test/integration/generated/client/` (standard Node.js runtime)

**Schema Changes**:
1. Edit `prisma/schema.prisma`
2. Run `pnpm prisma:generate` (generates both clients)
3. Import from `src/generated/prisma/client` in application code
4. Import from `test/integration/generated/client` in test code

**Important**: Never import Prisma types via relative paths to `prisma/src/generated/` or `node_modules/.prisma/`

### Database Migrations

The project uses **Supabase migration tooling** (NOT Prisma migrations) because Prisma doesn't fully support the PostgreSQL/PostGIS features used in this project.

**Migration Files Location**: `supabase/migrations/`

**Creating New Migrations**:

1. **Manual Migration Creation**:
   ```bash
   # Create a new migration file with timestamp prefix
   # Format: YYYYMMDDHHMMSS_description.sql
   # Example: 20251125000000_add_geohash_indexes.sql
   ```

2. **Migration File Structure**:
   ```sql
   -- Description of what the migration does
   -- Include rollback instructions in comments

   CREATE INDEX IF NOT EXISTS idx_name ON table_name (column);
   ```

3. **Applying Migrations Locally**:
   ```bash
   # Reset database (drops all data, reapplies all migrations + seed)
   pnpm supabase:reset

   # Or start Supabase (applies pending migrations)
   pnpm supabase:start
   ```

4. **Verifying Migrations**:
   ```bash
   # Connect to local database with admin access
   psql postgresql://postgres:postgres@localhost:54322/postgres

   # Check table structure
   \d table_name

   # Check indexes
   \di
   ```

5. **Migration Best Practices**:
   - Use `IF NOT EXISTS` for idempotent migrations
   - Add descriptive comments explaining the purpose
   - Include rollback commands in comments
   - Test locally before deploying to production
   - Keep migrations small and focused on one change
   - Always run integration tests after applying migrations

**Production Deployment**:
Migrations are automatically applied by Supabase when deploying. Coordinate timing with the team for migrations that may impact performance (e.g., creating indexes on large tables).

**CRITICAL**: Do NOT use `prisma migrate` commands - they will not work correctly with this project's schema.

### Adding New Routes

1. Create route handler in `src/routes/<domain>/`
2. Define Zod schemas for request/response validation in `schemas.ts`
3. Implement business logic in `src/services/<domain>/`
4. Add E2E tests in `test/integration/<domain>/`
5. Update `src/app.ts` to register new routes
6. Update OpenAPI documentation if needed

## Admin Interface Architecture

### Technology Stack

- **Rendering**: Server-side JSX (Hono JSX, compiles to HTML strings)
- **Not React**: JSX syntax but no client-side React runtime
- **Client-side JS**: Vanilla JavaScript embedded in `<script>` tags
- **Styling**: CSS with custom properties (design tokens)
- **Icons**: Font Awesome CDN

### Dataset Explorer Features (`/admin/loos`)

The dataset explorer (`src/admin/pages/loos/list.tsx`) provides:

1. **Real-time Metrics Panel**:
   - Total count, active, verified, accessible, radar, payment-free
   - Feature coverage with visual progress bars
   - Top 5 areas by toilet count

2. **Advanced Filtering**:
   - Status (active/inactive)
   - Accessibility (accessible/not accessible)
   - Payment (free/paid)
   - Radar (RADAR key required/not required)
   - Verification (verified/unverified)
   - Area (dropdown with all areas)
   - Full-text search (name, notes, geohash)

3. **Data Table**:
   - Sortable columns (name, updated, verified, created)
   - Pagination with configurable page size (10, 25, 50, 100, 200)
   - Inline feature icons (accessible, payment, radar, etc.)
   - Click to view loo details

4. **Client-side State Management**:
   - Embedded vanilla JS fetches from `/api/loos/search` and `/api/loos/metrics`
   - Renders dynamic table rows
   - Updates pagination controls
   - Handles filter/search interactions

### User Tooling

- **User Statistics (`/admin/users/statistics`, alias `/admin/users`)**
  - Contributor search with autosuggest (backed by `UserInsightsService`)
  - Activity snapshot cards, area coverage, recent loos, and audit timeline
  - Quick links into `/admin/loos/:id` and `/api/loos/:id`
- **User Administration (`/admin/users/admin`)**
  - Searches the Auth0 directory by email/name/subject
  - Shows profile metadata (created, last login, login count) and all API permissions
  - Toggle buttons for the key permissions: `access:admin` (dashboard access) and `report:loo` (loo contributions)
  - Powered by `Auth0ManagementClient` (`src/services/auth0/management.ts`) which wraps the Auth0 Management API with token caching
  - Requires dedicated `AUTH0_MANAGEMENT_CLIENT_ID` / `AUTH0_MANAGEMENT_CLIENT_SECRET` credentials (plus optional `AUTH0_MANAGEMENT_AUDIENCE`). Missing credentials trigger a warning banner and disable write actions.

### Loo Creation Form (`/admin/loos/create`)

Form-based loo creation with:
- Coordinate input (lat/lng)
- Feature checkboxes (accessible, payment, radar, etc.)
- Opening hours editor (24-hour toggle per day)
- Area selection dropdown
- Notes field
- Form submission creates loo via POST to `/admin/loos`

## Cloudflare Workers Deployment

### Configuration (`wrangler.jsonc`)

```jsonc
{
  "name": "toiletmap-server",
  "main": "./src/index.ts",
  "compatibility_date": "2025-11-18",
  "compatibility_flags": ["nodejs_compat"],
  "vars": {
    "AUTH0_ISSUER_BASE_URL": "https://gbptm.eu.auth0.com/",
    "AUTH0_AUDIENCE": "https://www.toiletmap.org.uk/api",
    "AUTH0_SCOPE": "openid profile email offline_access roles access:admin"
  },
  "env": {
    "production": {
      "vars": {
        "AUTH0_REDIRECT_URI": "https://your-worker.workers.dev/admin/callback" // Fallback; runtime derives the redirect from request origin
      }
    },
    "development": {
      "vars": {
        "AUTH0_REDIRECT_URI": "http://localhost:8787/admin/callback" // Local fallback when origin cannot be determined
      }
    }
  },
  "observability": {
    "logs": {
      "enabled": true,
      "head_sampling_rate": 1,
      "invocation_logs": true,
      "persist": true
    }
  }
}
```

### Secrets Management

Store sensitive values as Cloudflare secrets (not in `wrangler.jsonc`):

```bash
wrangler secret put AUTH0_CLIENT_SECRET
wrangler secret put AUTH0_MANAGEMENT_CLIENT_SECRET
```

Required secrets:
- `AUTH0_CLIENT_SECRET` - OAuth2 client secret (admin login + user-facing API)
- `AUTH0_MANAGEMENT_CLIENT_SECRET` - Auth0 Management API client secret (required for `/admin/users/admin`)

### Deployment Workflow

```bash
pnpm check      # Type-check + dry-run deploy
pnpm build      # Build (generates Prisma client)
pnpm deploy     # Deploy to Cloudflare Workers
```

### Production Considerations

- **No filesystem access**: Prisma client uses in-memory WASM engine
- **Connection pooling**: Use `@prisma/adapter-pg` with connection string
- **Cold starts**: First request may be slower due to Prisma initialization
- **Observability**: Full logging enabled via Cloudflare dashboard
- **Node.js compatibility**: Required for Prisma and jsonwebtoken libraries

## Common Patterns

### Schema Validation

```typescript
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

const schema = z.object({ name: z.string() });

app.post('/endpoint', zValidator('json', schema), async (c) => {
  const validated = c.req.valid('json'); // Type-safe!
  // ...
});
```

### Response Mappers

```typescript
// Always use mappers for consistency
import { mapLoo } from '@/services/loo/mappers';

const toilet = await prisma.toilets.findUnique({ where: { id } });
return c.json(mapLoo(toilet));
```

### Geospatial Queries (PostGIS)

```sql
-- Use PostGIS functions in raw SQL (src/services/loo/sql.ts)
SELECT *
FROM toilets
WHERE ST_DWithin(
  geography,
  ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
  $3
)
AND active = true
ORDER BY geography <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography;
```

### Raw SQL with Prisma

```typescript
import { Prisma } from '@/generated/prisma/client';

const result = await prisma.$queryRaw<Array<Toilet>>`
  SELECT * FROM toilets
  WHERE geohash LIKE ${geohash + '%'}
  AND active = ${active}
`;
```

### Contributor Extraction

```typescript
// Extract contributor name from JWT claims
const contributorPath = env.AUTH0_PROFILE_KEY || 'name';
const contributor = contributorPath.split('.').reduce(
  (obj, key) => obj?.[key],
  user
) as string;
```

## Recent Major Changes

### Cloudflare Workers Migration (2025-11)

- **Runtime**: Migrated from Node.js standalone server to Cloudflare Workers
- **Prisma**: Dual client setup (Cloudflare adapter for Workers, Node.js for tests)
- **Deployment**: Wrangler CLI replaces traditional Node.js deployment
- **Admin Interface**: SSR with Hono JSX (no separate frontend)

### Admin Interface (2025-11)

- **Added**: Server-side rendered admin dashboard with OAuth2 authentication
- **Dataset Explorer**: Advanced search, filtering, metrics, pagination
- **Loo Creation**: Form-based loo creation interface
- **Session Management**: HTTP-only cookie-based sessions

### Opening Hours Validation (2025-11)

- **Schema Update**: `["00:00", "00:00"]` now represents "open 24 hours" (previously invalid)
- **Validation**: `src/routes/loos/schemas.ts` special-cases this format to bypass "open < close" check
- **Admin UI**: Tri-state toggles (Closed / 24 Hours / Custom) for opening hours

## Important Constraints

### Do NOT

- ❌ Import Prisma types via relative paths to `prisma/src/generated/` or `node_modules/.prisma/`
- ❌ Use wrong Prisma client (use Workers client in `src/`, Node.js client in `test/`)
- ❌ Use `prisma migrate` commands - this project uses Supabase migrations instead
- ❌ Mutate database directly in route handlers (delegate to services)
- ❌ Add business logic to mappers (keep them pure transformation functions)
- ❌ Use `["00:00", "00:00"]` opening hours without understanding it means "24 hours open"
- ❌ Skip E2E tests when adding/modifying endpoints
- ❌ Use filesystem operations in Cloudflare Workers (not supported)
- ❌ Deploy without running `pnpm check` first

### DO

- ✅ Use Zod schemas for all request/response validation
- ✅ Keep route handlers thin (validate → delegate → respond)
- ✅ Add E2E test cases for new features or bug fixes
- ✅ Use Supabase migrations for all database schema changes (see Database Migrations section)
- ✅ Use `Prisma.sql` tagged template for raw SQL queries
- ✅ Follow existing patterns in `src/services/loo/` for consistency
- ✅ Use mappers to transform DB records to API responses
- ✅ Update `ONBOARDING.md` if introducing new architectural patterns
- ✅ Store secrets in Cloudflare Workers secrets (not in code or wrangler.jsonc)
- ✅ Test locally with `pnpm dev` before deploying

## Known Gotchas

1. **Database Migrations**: Use Supabase migrations (NOT `prisma migrate`) - Prisma doesn't fully support this project's PostgreSQL/PostGIS features
2. **Opening Hours Format**: `["00:00", "00:00"]` is valid and means "24 hours" (not a validation error)
3. **Geohash Queries**: Prefix matching is case-sensitive and uses `LIKE 'prefix%'` pattern
4. **Auth Profile Key**: If using nested Auth0 profile fields, set `AUTH0_PROFILE_KEY` to the namespaced claim URL or path (e.g., `app_metadata.contributor_name`)
5. **Prisma Client Location**: Always import from `src/generated/prisma/client` in app code, `test/integration/generated/client` in tests
6. **Test Database**: E2E suite auto-starts Supabase; use `KEEP_SUPABASE=1` to avoid teardown delays
7. **Soft Deletes**: Filter by `active = true` in most queries (see `src/services/loo/sql.ts` examples)
8. **Cloudflare Cold Starts**: First request after deploy may be slower due to Prisma initialization
9. **JWKS Caching**: Auth0 signing keys are cached (5 entries, 10 min TTL) - rate-limited to 10 requests/min
10. **Dual Prisma Clients**: Never mix imports - always use the correct client for your runtime
11. **Session Cookies**: Admin interface uses HTTP-only cookies; test with browser or cookie-aware HTTP client

## Documentation

- **README.md**: Quick start, API endpoint reference, setup instructions
- **docs/onboarding/**: Deep dive for new contributors (architecture, testing, workflows)
- **test/integration/**: Executable documentation for all endpoints
- **OpenAPI**: Generate with `pnpm docs:generate` → view at `/api/docs` when server running

## Support Channels

- **Documentation**: Start with `README.md` and `ONBOARDING.md`
- **Tests**: Treat `test/integration/` as executable documentation
- **Code Comments**: Add context for non-obvious decisions; update this file for architectural changes
- **Cloudflare Logs**: Use Cloudflare dashboard for production logs and errors

---

**Last Updated**: 2025-11-23
**Maintainer**: Public Convenience Ltd.
**Repository**: `public-convenience-ltd/toiletmap-server`
**Deployment**: Cloudflare Workers
