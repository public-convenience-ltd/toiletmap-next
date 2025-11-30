# Environment & Configuration

## Setup Steps

1. Copy `.env.example` to `.env.local` (or `.env`). All variables listed there are read by `src/env.ts` at start-up. The service will exit early if `AUTH0_ISSUER_BASE_URL` or `AUTH0_AUDIENCE` are missing.

## Database Connection Configuration

The application uses **Cloudflare Hyperdrive bindings** for all runtime database connections. Hyperdrive provides connection pooling, edge connection setup, and query caching to accelerate database access from Cloudflare Workers.

### Runtime Connections (Application Code)

**Production:**

- Uses the `HYPERDRIVE` binding configured in Cloudflare dashboard
- Provides:
  - Fast connection setup at the edge (reduces 7 round trips to 1)
  - Connection pooling near the database for optimal performance
  - Automatic query caching for read operations (60s default TTL)
- Configured via wrangler.jsonc: `hyperdrive[].binding = "HYPERDRIVE"`

**Development:**

- Uses the `TEST_HYPERDRIVE` binding for local development
- Connects to local Supabase instance by default (port 54322)
- Same Hyperdrive architecture, but with `localConnectionString` for local database
- Configured via wrangler.jsonc: `env.development.hyperdrive[].localConnectionString`

**Key Difference:**

- `HYPERDRIVE` (production) points to the remote production database via Cloudflare dashboard configuration
- `TEST_HYPERDRIVE` (development) points to your local database via `localConnectionString` in wrangler.jsonc

> **Learn More**: See [Hyperdrive architecture documentation](../architecture/hyperdrive.md) for comprehensive details on how Hyperdrive accelerates database queries.

**Override Variable:**

- `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TEST_HYPERDRIVE` - Override TEST_HYPERDRIVE's local connection without modifying wrangler.jsonc
- Useful for:
  - Testing against a remote database
  - Running multiple Supabase instances on different ports
  - CI/CD environments with custom database URLs
  - Different local PostgreSQL setups per developer

**Connection Priority:**

```typescript
// Application runtime connection logic (src/middleware/services.ts)
const connectionString =
  c.env.HYPERDRIVE?.connectionString ?? c.env.TEST_HYPERDRIVE?.connectionString;
```

This fallback logic ensures:

1. Production uses `HYPERDRIVE` binding
2. Development uses `TEST_HYPERDRIVE` binding
3. If `HYPERDRIVE` is missing (local dev), fall back to `TEST_HYPERDRIVE`

### Database Migrations

**Important:** We do NOT use Prisma migrations because Prisma doesn't fully support our database schema (PostGIS extensions, custom functions, etc.).

Our migration process is:

1. **Create Supabase migration file** in `supabase/migrations/`
2. **Update Prisma schema** in `prisma/schema.prisma` to reflect the changes
3. **Generate Prisma client** with `pnpm prisma:generate`

Example workflow:

```bash
# 1. Create a new Supabase migration
pnpm supabase migration new add_new_column

# 2. Edit the generated SQL file in supabase/migrations/
# Add your SQL changes (DDL, functions, triggers, etc.)

# 3. Apply migration to local database
pnpm supabase db reset

# 4. Update prisma/schema.prisma to match your changes

# 5. Regenerate Prisma client
pnpm prisma:generate
```

### Common Scenarios

**Scenario 1: Standard local development**

```bash
# wrangler.jsonc handles TEST_HYPERDRIVE binding automatically
# Just run: pnpm dev
```

**Scenario 2: Test against remote database**

```bash
# In .env
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TEST_HYPERDRIVE=postgresql://user:pass@remote-host:5432/db

# Runtime uses remote database
```

**Scenario 3: Multiple Supabase instances**

```bash
# Terminal 2: Different project (port 54323)
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TEST_HYPERDRIVE=postgresql://postgres:postgres@localhost:54323/postgres
```

**Scenario 4: CI/CD environment**

```bash
# GitHub Actions sets the connection string
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TEST_HYPERDRIVE=${{ secrets.TEST_DATABASE_URL }}
```

2. Run `pnpm install` (workspace root).
3. Generate the Prisma client with `pnpm prisma:generate` whenever the schema changes.

## Auth0 Settings

The API uses Auth0 for authentication, supporting both **production Auth0** and a **test auth server** for local development.

### Local Development (Default)

By default, local development uses a **test auth server** instead of production Auth0. This is configured in `wrangler.jsonc`:

```jsonc
"development": {
  "vars": {
    "AUTH0_ISSUER_BASE_URL": "http://127.0.0.1:44555/",
    "AUTH0_AUDIENCE": "https://toiletmap.org.uk",
    "AUTH0_CLIENT_ID": "test_client_id",
    "AUTH0_CLIENT_SECRET": "test_client_secret"
  }
}
```

**Benefits:**

- No Auth0 account required
- Consistent with integration test environment
- Fast setup for new developers
- Full JWT validation still works

**Generating Test Tokens:**

Tokens are generated from the running auth server on port 44555:

```bash
# Terminal 1: Start the dev stack (Wrangler + Vite + auth server)
pnpm dev
#   (or run pnpm auth:server if you only need the auth server)

# Terminal 2: Generate tokens
pnpm token:issue

# Use token in API requests
TOKEN=$(pnpm token:issue)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/loos/search
```

> **Important**: The auth server must be running before you can issue tokens. The script connects to port 44555 to generate tokens with matching keys.

**Running the Test Auth Server:**

The test auth server provides a complete OAuth2 implementation for local development:

```bash
pnpm dev      # Full dev stack (Wrangler + Vite + auth server)
# or
pnpm auth:server  # Auth server only (use with pnpm dev:api or remote workers)
```

**Supported endpoints:**

- `/.well-known/jwks.json` - JWKS for JWT validation
- `/authorize` - OAuth2 authorization endpoint (admin UI login)
- `/oauth/token` - OAuth2 token exchange
- `/userinfo` - User profile endpoint
- `/authorize` now renders a local login portal so you can explicitly approve sign-ins (mirrors Auth0 UI)

> **✨ Complete OAuth2 Support**: You can now use the admin UI login flow locally without any Auth0 credentials!

### Production Auth0 (Optional for Testing Real Auth0)

To test against a real Auth0 tenant locally, create a `.env` file with production credentials:

```bash
# .env
AUTH0_ISSUER_BASE_URL=https://your-tenant.auth0.com/
AUTH0_AUDIENCE=https://www.toiletmap.org.uk/api
AUTH0_CLIENT_ID=your_production_client_id
AUTH0_CLIENT_SECRET=your_production_client_secret
# Optional fallback; runtime derives redirect URI automatically
# AUTH0_REDIRECT_URI=http://localhost:8787/admin/callback
AUTH0_SCOPE=openid profile email offline_access roles access:admin
```

These `.env` values will override the test auth server defaults in `wrangler.jsonc`.

The worker now inspects the current request origin (e.g., preview URLs like `https://743a6af5-toiletmap-server...`) to build the Auth0 redirect URI dynamically. Keeping the fallback value configured ensures Auth0 still recognises the callback, but you no longer need to edit environment variables for each deployment URL.

When running against real Auth0, start the worker without the bundled auth server:

```bash
pnpm dev:api
```

Run `pnpm auth:server` only if you still need the local auth server for tests.

> **Note**: Production deployment uses real Auth0 credentials configured in the Cloudflare dashboard, not test values.
