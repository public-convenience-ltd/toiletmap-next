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
| `toiletmap-client` | `apps/toiletmap-client` | Public-facing frontend (Astro, Preact, SSR). See [Architecture](apps/toiletmap-client/docs/architecture.md). |
| `toiletmap-design-system` | `apps/toiletmap-design-system` | Shared design tokens and assets. |

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
make db-start
```

Now launch the API/admin worker:

```bash
make dev-server
```

This command first generates the Prisma client and builds the admin interface assets, then concurrently runs the Vite build (watch mode), Wrangler dev server, and mock Auth0 server so you can visit your local Toilet Map immediately (default: `http://localhost:8787`).

Want to see the client worker placeholder?

```bash
make dev-client
```

## Code Quality

This project uses [Biome](https://biomejs.dev/) for linting and formatting. Biome is a fast, all-in-one toolchain that replaces ESLint and Prettier.

### Quick Commands

```bash
# Check code style (lint + format)
pnpm check

# Auto-fix issues
pnpm check:fix

# Only lint
pnpm lint

# Only format
pnpm format
```

Or use the Makefile shortcuts:

```bash
make check-style    # check lint + format
make fix-style      # auto-fix lint + format
make lint           # check linting only
make format         # check formatting only
```

### Editor Setup

**VSCode**: Install the [Biome extension](https://marketplace.visualstudio.com/items?itemName=biomejs.biome)

The workspace is already configured in `.vscode/settings.json` to:
- Use Biome as the default formatter
- Format on save
- Organize imports automatically
- Apply quick fixes on save

**Other editors**: See [Biome editor integrations](https://biomejs.dev/guides/integrate-in-editor/)

### CI Integration

All pull requests automatically run Biome checks via GitHub Actions. Make sure to run `pnpm check:fix` before pushing to avoid CI failures.

### Pre-commit Hooks

This project uses [Husky](https://typicode.github.io/husky/) to automatically run Biome checks on staged files before each commit.

**What runs on pre-commit:**
- Biome check with auto-fix (linting + formatting)
- Only runs on files you're committing (not the entire codebase)
- Automatically fixes what it can, blocks commit if unfixable errors exist

**First-time setup:**
The hooks are installed automatically when you run `pnpm install` (via the `prepare` script).

**Skipping hooks (use sparingly):**
If you need to bypass the pre-commit hook:
```bash
git commit --no-verify -m "your message"
# or
HUSKY=0 git commit -m "your message"
```

**Troubleshooting:**
If hooks aren't working:
1. Run `pnpm install` to reinstall hooks
2. Check that `.husky/pre-commit` exists and is executable
3. Ensure you're using Node 24 (`fnm use`)

## Common Tasks

### Building

```bash
make build-server      # client assets + worker bundle
make build-client      # frontend worker bundle
```

### Testing & Verification

```bash
make test-server-e2e                         # run end-to-end tests
make check                                   # style check + typecheck + wrangler dry-run
```

- Frontend tests will land once the client worker grows beyond static HTML.

### Development Helpers

```bash
make cf-typegen                              # generate cloudflare types
make token-issue                             # issue a test token
```

### Deployment

```bash
make deploy-server                           # deploys server
make deploy-client                           # deploys client
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
