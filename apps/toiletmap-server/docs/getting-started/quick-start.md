# Quick Start Guide

Get up and running with toiletmap-server in under 5 minutes.

## Prerequisites

- **Node.js 20+** (see [.nvmrc](../../.nvmrc))
- **pnpm** (`npm install -g pnpm`)
- **Docker** (for local database)

## Setup

```bash
# 1. Clone and install
git clone https://github.com/public-convenience-ltd/toiletmap-server.git
cd toiletmap-server
pnpm install

# 2. Generate Prisma clients
pnpm prisma:generate

# 3. Start local database (PostgreSQL + PostGIS)
pnpm supabase:start

# 4. Start dev stack (Worker + admin UI + local auth server)
pnpm dev
```

`pnpm dev` runs Wrangler, the Vite asset watcher, and the bundled auth server on port 44555. The API + admin UI are now available at [http://localhost:8787](http://localhost:8787).

## Verify Setup

```bash
# Health check
curl http://localhost:8787/
# Response: {"status":"ok"}

# Run tests
pnpm test:e2e
# All tests should pass ✅
```

## Next Steps

- **Detailed Setup**: See [environment.md](../onboarding/environment.md) for environment configuration
- **Architecture**: Understand the system in [architecture/overview.md](../architecture/overview.md)
- **Development**: Learn common tasks in [onboarding/workflows.md](../onboarding/workflows.md)
- **Testing**: Run and write tests in [development/testing.md](../development/testing.md)

## Common Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Full dev stack (Wrangler + Vite + local auth server) |
| `pnpm dev:api` | Wrangler + Vite only (use with real Auth0) |
| `pnpm test:e2e` | Run integration tests |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm supabase:start` | Start local PostgreSQL + PostGIS |
| `pnpm supabase:stop` | Stop local database |
| `pnpm prisma:generate` | Regenerate Prisma clients |
| `pnpm auth:server` | Run just the local auth server (port 44555) |

## Troubleshooting

### Database connection fails

**Issue**: `Error: connect ECONNREFUSED ::1:54322`

**Solution**:
```bash
pnpm supabase:stop
pnpm supabase:start
```

### Port 8787 already in use

**Solution**:
```bash
# Find and kill the process
lsof -ti:8787 | xargs kill -9
pnpm dev
```

### Prisma client errors

**Issue**: `Cannot find module '@prisma/client'`

**Solution**:
```bash
pnpm prisma:generate
```

## Need Help?

- See [troubleshooting.md](../development/troubleshooting.md) for detailed troubleshooting
- Check [onboarding/workflows.md](../onboarding/workflows.md) for how-to guides
- Review [Onboarding Guide](../onboarding/overview.md) for comprehensive onboarding
