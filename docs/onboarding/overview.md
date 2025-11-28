# System Overview

## Framework & Architecture

- **Framework**: [Hono](https://hono.dev/) drives HTTP routing (`src/app.ts`).
- **Database**: Postgres/PostGIS managed through Prisma. The Prisma client is generated into `prisma/src/generated/prisma/client` and re-exported via `src/generated/prisma-client.ts` so application code can avoid brittle relative paths.
- **Authentication**: Auth0-issued JWTs validated via `src/auth/middleware.ts`, which centralises header + cookie auth and enriches `c.get('user')` with Auth0 `/userinfo`. Tests spin up a local JWKS server so tokens can be minted without external calls.
- **Domain focus**: Everything interesting lives under `src/services/loo`. Routes marshal requests, defer to this service, and shape responses through `src/services/loo/mappers.ts` and `src/services/loo/types.ts`.

## Recommended Reading Order

1. `src/app.ts` – exposes the available routers and the error handling conventions.
2. `src/routes/**` – thin handlers showing validation + response shape expectations.
3. `src/services/loo` – query/mutation/persistence layers and supporting SQL builders.
4. `tests/e2e/**` – executable documentation for every endpoint (see [Testing Guide](../development/testing.md)).

## Support Channels

- **Docs**: README + these docs.
- **Tests**: Treat the Vitest suite as executable documentation—add a case whenever behaviour changes.
- **Questions**: If something feels under-documented, add a short comment near the source and extend this guide; future-you will thank you.
