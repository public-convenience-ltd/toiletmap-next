# Toilet Map Hono API

A standalone REST API for the Toilet Map project built on [Hono](https://hono.dev/). The service ships with the Prisma data model, Supabase CLI configuration, and documentation required to run it independently of the Next.js codebase.

## Highlights

- Uses Prisma to access the Supabase-hosted Postgres database (PostGIS enabled).
- Bundles Supabase project config, migrations, and seed data for local development.
- Provides read-only endpoints mirroring the most used legacy GraphQL queries.

## Getting Started

### Prerequisites

- Node.js 20 (see `.nvmrc` in the monorepo) and [pnpm](https://pnpm.io/)
- Docker (for local Supabase)
- The Supabase CLI (added as a dev dependency – `pnpm supabase -- --help` works too)

### Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Configure environment variables:
   ```bash
   cp .env.example .env.local
   ```
   Update the values to match your environment. `src/env.ts` requires `POSTGRES_URI`, `AUTH0_ISSUER_BASE_URL`, and `AUTH0_AUDIENCE` to start successfully. The example file now includes sensible local defaults for the Auth0 test issuer that powers the E2E suite.
3. Generate the Prisma client:
   ```bash
   pnpm prisma:generate
   ```

### Optional: start Supabase locally

This project includes the Supabase configuration from the monorepo under `supabase/`. To bring up the full stack with seeded data:

```bash
pnpm supabase:start
```

The CLI will read `supabase/config.toml`, run the migrations in `supabase/migrations/`, and load `supabase/seed.sql`. When you are finished, use `pnpm supabase:stop` or `pnpm supabase:reset`.

### Testing

The Vitest-powered E2E suite boots Supabase for you (or connects to an already running instance) and exercises every public route, mutation path, and admin/doc endpoint:

```bash
pnpm test:e2e
```

- Set `KEEP_SUPABASE=1` if you want to keep the Docker stack running between test runs.
- The suite exposes a deterministic auth server; issue additional tokens in tests via `tests/e2e/utils/auth`.
- To focus on a single file, use `pnpm vitest run tests/e2e/<file>.test.ts`.

### Run the server

- Development: `pnpm dev`
- Production build: `pnpm build`
- Production serve: `pnpm start`

The server listens on `PORT` (defaults to `4001`) and exposes a health check at `GET /`.

### Script cheatsheet

- `pnpm check` – Type-check the codebase.
- `pnpm prisma:db:pull` – Inspect and pull the live database schema.
- `pnpm prisma:studio` – Launch Prisma Studio with the bundled schema.

## Supabase & Prisma layout

- `supabase/config.toml` – Supabase CLI project settings.
- `supabase/migrations/` – SQL migrations mirrored from the primary repo.
- `supabase/seed.sql` – Deterministic dataset used during `supabase:start`.
- `prisma/schema.prisma` – Prisma schema with the generated client outputting to `src/generated/prisma/client`.

## API Overview

The canonical response schemas live in `src/services/loo/types.ts` (see `LooResponseSchema`, `NearbyLooResponseSchema`, and friends) and are expressed with Zod so you can rely on them both at type-level and runtime if needed.

All responses are JSON. Errors follow the shape:

```json
{
  "message": "Description of the issue"
}
```

### GET `/loos/:id`
- **Description:** Retrieve a single loo by ID.
- **Response:**
  ```jsonc
  {
    "id": "abc123",
    "name": "Example Loo",
    "geohash": "gcpuv",
    "createdAt": "2024-11-29T09:21:00.000Z",
    "updatedAt": "2024-12-01T10:00:00.000Z",
    "verifiedAt": null,
    "location": { "lat": 52.62, "lng": 1.26 },
    "area": [{ "name": "Norwich", "type": "district" }],
    "accessible": true,
    "noPayment": false,
    "...": "see code for full shape"
  }
  ```

### GET `/loos`
- **Description:** Batch lookup by ID.
- **Query Parameters:** `ids` (repeatable or comma-separated).
- **Response:**
  ```json
  {
    "count": 2,
    "data": [{ "...loo..." }, { "...loo..." }]
  }
  ```

### GET `/loos/geohash/:geohash`
- **Description:** Fetch all loos whose geohash starts with the supplied prefix.
- **Query Parameters:** `active` (optional, `true` | `false` | `any`, defaults to `true`).
- **Response:** same array format as `GET /loos`.

### GET `/loos/proximity`
- **Description:** Query loos within a radius of a coordinate.
- **Query Parameters:**
  - `lat` – required latitude (`-90` – `90`)
  - `lng` – required longitude (`-180` – `180`)
  - `radius` – optional radius in meters (default `1000`, max `50000`)
- **Response:**
  ```json
  {
    "count": 5,
    "data": [
      {
        "...loo fields...",
        "distance": 124.6
      }
    ]
  }
  ```

### GET `/loos/:id/reports`
- **Description:** Return audit trail records for a loo ordered newest first.
- **Response:**
  ```json
  {
    "count": 3,
    "data": [
      {
        "id": "987654321",
        "contributor": "Anonymous",
        "createdAt": "2024-10-03T08:12:00.000Z",
        "isSystemReport": false,
        "notes": "Example note",
        "location": { "lat": 52.62, "lng": 1.26 }
      }
    ]
  }
  ```

### GET `/areas`
- **Description:** List known areas (name and type only).
- **Response:**
  ```json
  {
    "count": 12,
    "data": [{ "name": "Norwich", "type": "district" }]
  }
  ```

## Project Structure

```
.
├── .env.example
├── .gitignore
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── prisma/
│   └── schema.prisma
├── src/
│   ├── env.ts
│   ├── index.ts
│   ├── mappers/
│   ├── prisma.ts
│   ├── routes/
│   └── utils/
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   └── seed.sql
└── tsconfig.json
```

## Next Steps

1. Wire the UI (or other consumers) to the REST endpoints.
2. Add structured logging and observability once deployed independently.
3. Publish an OpenAPI/Swagger description if the API becomes public-facing.

## Developer Onboarding

`docs/ONBOARDING.md` walks through the architecture, Supabase fixtures, route layout, and common workflows (running seeds, issuing auth tokens, and reading audit trails). It is the recommended first stop for new contributors before diving into the source.
