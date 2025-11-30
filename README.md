# Toilet Map Monorepo

Public Convenience Ltd. maintains the UK’s largest open database of publicly accessible toilets. The Toilet Map hosts more than 14,000 facilities and is designed to be accurate, sustainable, and freely available. Everyone needs a toilet sooner or later; our mission is to make sure people can find one quickly, especially those with accessibility needs.

This repository contains the code that powers both the public API and the admin tooling (the primary Cloudflare Worker) as well as a new frontend worker that will evolve into the public-facing experience. The project is 100% open source and supported by an amazing community of contributors and sponsors.

## Project Overview

- **What we ship**: REST API, geospatial queries, authentication, admin dashboard, soon a dedicated client worker
- **Runtime**: Cloudflare Workers with Hono, Prisma, and Supabase/PostGIS
- **Why a monorepo**: keeps the API/admin worker and the frontend worker aligned, sharing tooling, CI, and documentation

## Workspace Layout

| Workspace          | Path                    | Purpose                                                                                                                        |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `toiletmap-server` | `apps/toiletmap-server` | The original API + admin Cloudflare Worker. Houses all routing, services, Prisma schema, Supabase migrations, docs, and tests. |
| `toiletmap-client` | `apps/toiletmap-client` | Frontend worker placeholder. Returns static HTML today while we design the client experience.                                  |

Each workspace keeps its own `package.json` and configuration files, but all dependencies are managed through pnpm at the repository root.

## Prerequisites

- Node.js 20.19+ (match `.nvmrc` using fnm, asdf, nvm, etc.)
- pnpm 8+ (we recommend 10.x)
- Wrangler CLI authenticated against the Cloudflare account you deploy to
- Docker + Supabase CLI if you plan to run the local Postgres/PostGIS stack
- Auth0 credentials (see the server workspace README for the exact environment variables)

Optional:

- Vercel CLI or other tooling for experimental deployments

## Getting Started

Clone the repository, switch to the required Node version, and install dependencies:

```bash
fnm use                       # or nvm/asdf equivalent, matching .nvmrc
pnpm install                  # installs all workspace dependencies
```

Create your local environment files (examples are inside `apps/toiletmap-server`):

```bash
cp apps/toiletmap-server/.env.example apps/toiletmap-server/.env
cp apps/toiletmap-server/.dev.vars.example apps/toiletmap-server/.dev.vars
```

To work with real data and run the API locally, start the Supabase development stack (loads 5,000 mock loos plus UK areas):

```bash
pnpm --filter toiletmap-server supabase:start
```

Now launch the API/admin worker:

```bash
pnpm --filter toiletmap-server dev
```

This script concurrently runs the Vite build, Wrangler dev server, and mock Auth0 server so you can visit your local Toilet Map immediately (default: `http://localhost:8787`).

Want to see the client worker placeholder?

```bash
pnpm --filter toiletmap-client dev
```

## Common Tasks

### Building

```bash
pnpm --filter toiletmap-server build      # client assets + worker bundle
pnpm --filter toiletmap-client build      # frontend worker bundle
pnpm run build                           # runs both via workspace recursion
```

### Testing

- `pnpm --filter toiletmap-server typecheck`
- `pnpm --filter toiletmap-server test:e2e`
- Frontend tests will land once the client worker grows beyond static HTML.

### Deployment

```bash
pnpm --filter toiletmap-server check      # typecheck + wrangler dry-run
pnpm run deploy                           # deploys server then client worker
```

The combined deploy script stops if either worker fails, keeping environments in sync.

#### Database Migrations

Database migrations are automatically deployed via GitHub Actions:

- **Staging**: Push to `postgres-staging` branch → triggers deployment to staging Supabase
- **Production**: Push to `main` branch → triggers deployment to production Supabase

Both workflows can also be manually triggered through GitHub Actions. See [ONBOARDING.md](ONBOARDING.md#migrations) for detailed migration creation and deployment instructions.

## Repository Structure (Top Level)

```
apps/
  toiletmap-server/   # API + admin worker (legacy project)
  toiletmap-client/   # frontend worker placeholder
docs/                 # project-wide docs (architecture, onboarding, ops)
package.json          # workspace scripts + overrides
pnpm-workspace.yaml   # workspace definition and onlyBuiltDependencies rules
```

## Contributing

We love contributions! See `ONBOARDING.md` for deeper architectural context and `CONTRIBUTING.md` (inside the server workspace) for coding standards, testing expectations, and deployment guidance. Please also review the Code of Conduct before interacting with the community.

Have questions about the dataset or want API access without hacking on the repo? Check out Toilet Map Explorer or reach out to the maintainers. Happy mapping!
