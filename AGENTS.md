# AGENTS.md

> **Purpose**: This document provides AI coding assistants with essential context about the Toilet Map API project to enable effective contributions.

## Project Overview

**Toilet Map Hono API** (`@toiletmap/hono-api`) is a standalone REST API service for the Toilet Map project, built on the [Hono](https://hono.dev/) framework. The service provides CRUD operations for public toilet data, including geospatial queries, audit trails, and administrative tools.

### Key Technologies

- **Framework**: [Hono](https://hono.dev/) v4.10+ (lightweight Node.js web framework)
- **Database**: PostgreSQL with PostGIS extension via Supabase
- **ORM**: Prisma v6.19+ (TypeScript ORM with type-safe clients)
- **Validation**: Zod v4+ for runtime schema validation
- **Authentication**: Auth0 JWT validation (RS256 tokens)
- **Runtime**: Node.js 20 (see `.nvmrc`)

## Architecture

### Core Structure

```
src/
├── app.ts                    # Hono application setup, route registration
├── index.ts                  # Server entry point
├── env.ts                    # Environment variable validation
├── prisma.ts                 # Prisma client singleton
├── routes/                   # HTTP route handlers (thin layer)
│   ├── loos/                 # Loo CRUD + query endpoints
│   ├── areas/                # Area lookup endpoints
│   └── shared/               # Shared validation schemas
├── services/                 # Business logic & data access
│   ├── loo/                  # Loo domain services (queries, mutations, mappers)
│   └── area.service.ts       # Area domain service
└── middleware/               # Auth & error handling
    ├── require-auth.ts       # JWT validation middleware
    └── error-handler.ts      # Global error handler

tests/
└── e2e/                      # End-to-end tests (all routes + mutations)
```

### Data Flow

1. **Request** → Route handler validates input with Zod schemas
2. **Route** → Delegates to service layer (`src/services/loo/`)
3. **Service** → Executes business logic, queries database via Prisma
4. **Mappers** → Transform database records to API response schemas (`src/services/loo/mappers.ts`)
5. **Response** → JSON returned to client

### Key Files

- **`src/services/loo/`**: Core domain logic for toilet records
  - `service.ts`: Main service class with CRUD operations
  - `sql.ts`: Complex SQL queries using Prisma raw SQL
  - `mappers.ts`: Transform DB models to API responses
  - `types.ts`: Zod schemas for request/response validation
- **`src/routes/loos/schemas.ts`**: Request validation schemas (including opening hours logic)
- **`tests/e2e/`**: Executable documentation for all endpoints

## Domain Model

### Primary Entity: `loo` (Toilet Record)

Key fields:
- **Identity**: `id` (cuid), `geohash` (geospatial indexing)
- **Location**: `lat`, `lng` (coordinates), `area` (reverse geocoded areas)
- **Features**: `accessible`, `noPayment`, `community_accessible`, `baby_changing`, etc.
- **Metadata**: `createdAt`, `updatedAt`, `verifiedAt`, `active` (soft delete flag)
- **Opening Hours**: Array format `["HH:MM", "HH:MM"]` per day
  - Special case: `["00:00", "00:00"]` represents "open 24 hours"
  - Empty array or `null` represents "closed" or "unknown"

### Audit Trail: `record_version`

All mutations to `loo` records create audit entries (`record_version` table) tracking:
- Contributor information
- Timestamp
- Full snapshot of changed fields
- Notes/comments

## Authentication & Authorization

- **Public Endpoints**: Read operations (`GET /loos/*`, `GET /areas`) are unauthenticated
- **Protected Endpoints**: Mutation operations require Auth0 JWT in `Authorization: Bearer <token>` header
- **Middleware**: `src/middleware/require-auth.ts` validates RS256 JWTs against configured Auth0 tenant
- **Test Auth**: E2E suite uses local JWKS server (`tests/e2e/utils/auth.ts`) to mint deterministic tokens

### Environment Variables (Auth)

```bash
AUTH0_ISSUER_BASE_URL=https://your-tenant.auth0.com/
AUTH0_AUDIENCE=https://toiletmap.org.uk
AUTH0_PROFILE_KEY=https://toiletmap.org.uk/contributor_name  # Optional nested profile field
```

## Development Workflows

### Setup

```bash
pnpm install                  # Install dependencies
cp .env.example .env.local    # Configure environment
pnpm prisma:generate          # Generate Prisma client
pnpm supabase:start           # Start local Postgres (Docker)
```

### Common Commands

```bash
pnpm dev                      # Start dev server (tsx watch)
pnpm check                    # TypeScript type checking
pnpm prisma:studio            # Open Prisma Studio UI
pnpm supabase:reset           # Reset DB with migrations + seed
```

### Testing Strategy

- **E2E Suite**: `tests/e2e/**/*.test.ts` (single-threaded via Vitest)
- **Test Client**: `tests/e2e/context.ts` provides `testClient` that calls `createApp().fetch()` directly (no HTTP server)
- **Database**: Supabase auto-starts if not running (set `KEEP_SUPABASE=1` to persist between runs)
- **Auth**: Use `issueTestToken()` helper from `tests/e2e/utils/auth.ts` to mint test JWTs
- **Fixtures**: Reusable test data in `tests/e2e/loos/helpers.ts`

### Prisma Workflow

1. **Schema Changes**: Edit `prisma/schema.prisma`
2. **Generate Client**: `pnpm prisma:generate`
3. **Import Types**: Always import from `src/generated/prisma-client.ts` (never use relative paths to generated code)

### Adding New Routes

1. Create route handler in `src/routes/<domain>/`
2. Define Zod schemas for request/response validation
3. Implement business logic in `src/services/<domain>/`
4. Add E2E tests in `tests/e2e/<domain>/`
5. Update `src/app.ts` to register new routes

## Recent Major Changes

### Opening Hours Validation (2025-11-20)

- **Schema Update**: `["00:00", "00:00"]` now represents "open 24 hours" (previously invalid)
- **Validation**: `src/routes/loos/schemas.ts` special-cases this format to bypass "open < close" check
- **Admin UI**: Admin Explorer now uses tri-state toggles (Closed / 24 Hours / Custom) for opening hours

### Admin Explorer Refactoring (2025-11-19)

- **Modularization**: Split monolithic `admin-explorer/index.html` into components, services, utilities
- **Bug Fixes**: Resolved race conditions in diff list, map coordinate picker cleanup issues
- **Testing**: Added comprehensive Playwright E2E suite for admin tooling

### Loo Service Refactoring (2025-11-19)

- **Schema Consolidation**: Moved Zod schemas to shared utility files
- **Validation Middleware**: Integrated `@hono/zod-validator` for cleaner route handlers
- **Service Simplification**: Refactored `LooService.getReports()` and `upsert()` for clarity

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
import { mapLooToResponse } from '@/services/loo/mappers';

const loo = await prisma.loo.findUnique({ where: { id } });
return c.json(mapLooToResponse(loo));
```

### Geospatial Queries

```sql
-- Use PostGIS functions in raw SQL (src/services/loo/sql.ts)
ST_DWithin(
  ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
  ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
  $3
)
```

## Documentation

- **README.md**: Quick start, API endpoint reference, setup instructions
- **docs/ONBOARDING.md**: Deep dive for new contributors (architecture, testing, workflows)
- **tests/e2e/**: Executable documentation for all endpoints
- **OpenAPI**: Generate with `pnpm docs:generate` → `docs/openapi.json`

## Important Constraints

### Do NOT

- ❌ Import Prisma types via relative paths to `prisma/src/generated/` (use `@/generated/prisma-client.ts`)
- ❌ Mutate database directly in route handlers (delegate to services)
- ❌ Add business logic to mappers (keep them pure transformation functions)
- ❌ Use `00:00`-`00:00` opening hours without understanding it means "24 hours open"
- ❌ Skip E2E tests when adding/modifying endpoints

### DO

- ✅ Use Zod schemas for all request/response validation
- ✅ Keep route handlers thin (validate → delegate → respond)
- ✅ Add E2E test cases for new features or bug fixes
- ✅ Use `Prisma.sql` tagged template for raw SQL queries
- ✅ Follow existing patterns in `src/services/loo/` for consistency
- ✅ Update `docs/ONBOARDING.md` if introducing new architectural patterns

## Known Gotchas

1. **Opening Hours Format**: `["00:00", "00:00"]` is valid and means "24 hours" (not a validation error)
2. **Geohash Queries**: Prefix matching is case-sensitive and uses `LIKE 'prefix%'` pattern
3. **Auth Profile Key**: If using nested Auth0 profile fields, set `AUTH0_PROFILE_KEY` to the namespaced claim URL
4. **Prisma Client Location**: Always regenerate after schema changes and import from `src/generated/prisma-client.ts`
5. **Test Database**: E2E suite auto-starts Supabase; use `KEEP_SUPABASE=1` to avoid teardown delays
6. **Soft Deletes**: Filter by `active = true` in most queries (see `src/services/loo/sql.ts` examples)

## Support Channels

- **Documentation**: Start with `README.md` and `docs/ONBOARDING.md`
- **Tests**: Treat `tests/e2e/` as executable documentation
- **Code Comments**: Add context for non-obvious decisions; update this file for architectural changes

---

**Last Updated**: 2025-11-20  
**Maintainer**: Public Convenience Ltd.  
**Repository**: `public-convenience-ltd/toiletmap-server`
