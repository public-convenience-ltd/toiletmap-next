# Toilet Map API Onboarding

Welcome aboard! This document condenses the practical information a senior engineer needs to become productive in this service. It complements the README by focusing on day-to-day workflows, data dependencies, and the files that matter most.

## 1. System Overview

- **Framework**: [Hono](https://hono.dev/) drives HTTP routing (`src/app.ts`).
- **Database**: Postgres/PostGIS managed through Prisma. The Prisma client is generated into `prisma/src/generated/prisma/client` and re-exported via `src/generated/prisma-client.ts` so application code can avoid brittle relative paths.
- **Authentication**: Auth0-issued JWTs validated via `src/middleware/require-auth.ts`. Tests spin up a local JWKS server so tokens can be minted without external calls.
- **Domain focus**: Everything interesting lives under `src/services/loo`. Routes marshal requests, defer to this service, and shape responses through `src/services/loo/mappers.ts` and `src/services/loo/types.ts`.

Recommended reading order for new contributors:

1. `src/app.ts` – exposes the available routers and the error handling conventions.
2. `src/routes/**` – thin handlers showing validation + response shape expectations.
3. `src/services/loo` – query/mutation/persistence layers and supporting SQL builders.
4. `tests/e2e/**` – executable documentation for every endpoint (see "Testing" below).

## 2. Environment & Configuration

1. Copy `.env.example` to `.env.local` (or `.env`). All variables listed there are read by `src/env.ts` at start-up. The service will exit early if `POSTGRES_URI`, `AUTH0_ISSUER_BASE_URL`, or `AUTH0_AUDIENCE` are missing.
2. Run `pnpm install` (workspace root).
3. Generate the Prisma client with `pnpm prisma:generate` whenever the schema changes.

### Auth0 settings

The API trusts RS256 JWTs issued by the configured Auth0 tenant. During development you can rely on the Vitest auth server:

- Point `AUTH0_ISSUER_BASE_URL` to the randomised issuer logged by the E2E setup (defaults to `http://127.0.0.1:44555/`).
- Use the `issueTestToken` helper from `tests/e2e/utils/auth.ts` in tests or REPL sessions to mint tokens that match the configured audience/issuer pair.
- `AUTH0_PROFILE_KEY` lets you embed contributor names in a nested object (handy when mirroring production Auth0 profiles).

## 3. Supabase & Data Flow

The repository vendors the Supabase configuration from the wider monorepo:

- `supabase/` contains migrations and deterministic seed data referenced by tests.
- `pnpm supabase:start` stands up the Docker stack. `supabase:reset` applies migrations + seed data again.
- The E2E suite automatically starts Supabase if it is not already running. Set `KEEP_SUPABASE=1` to leave the containers up between runs.

When the API mutates loos it writes audit entries into `record_version`. Snapshots are shaped via `src/services/loo/mappers.ts#mapAuditRecordToReport`, so consult that function before adjusting audit semantics.

## 4. Testing Strategy

Vitest executes everything under `tests/e2e/**` with a single-threaded runner (see `vitest.config.mts`). A few tips:

- `pnpm test:e2e` – full suite that boots Supabase, seeds data, and drives the HTTP surface.
- `KEEP_SUPABASE=1 pnpm vitest run tests/e2e/loos/mutation.test.ts` – rerun a single file while reusing the database between runs.
- `tests/e2e/context.ts` exposes a lightweight `testClient` that calls `createApp().fetch` directly; there is no HTTP server involved.
- Authentication helpers live in `tests/e2e/utils`. Issue tokens with `issueTestToken` and reuse fixtures from `tests/e2e/loos/helpers.ts`.

Every endpoint has at least one e2e spec. When adding new routes, mirror the existing pattern: helper-driven fixtures + explicit assertions about response metadata (`count`, `total`, etc.).

## 5. Common Workflows

- **Inspecting queries**: Complex read concerns are isolated in `src/services/loo/sql.ts`. The raw SQL returned from helpers is Prisma-safe (`Prisma.sql`).
- **Adding new Prisma entities**: Update `prisma/schema.prisma`, run `pnpm prisma:generate`, and import types via `src/generated/prisma-client.ts`.
- **Working on the admin explorer**: The HTML shell lives under `admin-explorer/`. Routes in `src/routes/admin/index.ts` template the Auth0 metadata; tweak there when wiring new single-page functionality.
- **Regenerating OpenAPI**: `pnpm docs:generate` writes `docs/openapi.json` using the schema definitions in `src/docs/openapi.ts`.

## 6. Support Channels

- **Docs**: README + this file.
- **Tests**: Treat the Vitest suite as executable documentation—add a case whenever behaviour changes.
- **Questions**: If something feels under-documented, add a short comment near the source and extend this guide; future-you will thank you.
