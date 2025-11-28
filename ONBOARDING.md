# Onboarding Guide

Welcome to the Toilet Map API project! This guide will help you understand the architecture, set up your development environment, and become a productive contributor.

## Table of Contents

- [Project Mission](#project-mission)
- [Architecture Overview](#architecture-overview)
- [Getting Started](#getting-started)
- [Understanding the Codebase](#understanding-the-codebase)
- [Authentication Deep Dive](#authentication-deep-dive)
- [Admin Interface Architecture](#admin-interface-architecture)
- [Database & PostGIS](#database--postgis)
- [Testing Strategy](#testing-strategy)
- [Common Development Tasks](#common-development-tasks)
- [Troubleshooting](#troubleshooting)
- [Best Practices](#best-practices)
- [Contributing Guidelines](#contributing-guidelines)

## Project Mission

The Toilet Map API provides a public service for mapping and managing accessible public toilets across the UK. Our goals are:

1. **Accessibility**: Make public toilet data freely available via a REST API
2. **Data Quality**: Maintain accurate, verified toilet records with audit trails
3. **Ease of Use**: Provide intuitive admin tools for data management
4. **Performance**: Deliver fast, global access via Cloudflare Workers edge network
5. **Community**: Enable contributors to improve toilet data for everyone

## Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Cloudflare Workers                       │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    Hono Application                     │ │
│  │                                                          │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │ │
│  │  │  API Routes  │  │  Admin UI    │  │  Auth        │ │ │
│  │  │  /api/*      │  │  /admin/*    │  │  Middleware  │ │ │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │ │
│  │         │                 │                  │          │ │
│  │         └─────────────────┴──────────────────┘          │ │
│  │                           │                              │ │
│  │                    ┌──────▼──────┐                      │ │
│  │                    │  Services   │                      │ │
│  │                    │  (Business  │                      │ │
│  │                    │   Logic)    │                      │ │
│  │                    └──────┬──────┘                      │ │
│  │                           │                              │ │
│  │                    ┌──────▼──────┐                      │ │
│  │                    │   Prisma    │                      │ │
│  │                    │   Client    │                      │ │
│  │                    └──────┬──────┘                      │ │
│  └───────────────────────────┼──────────────────────────────┘ │
└────────────────────────────────┼──────────────────────────────┘
                                 │
                        ┌────────▼────────┐
                        │   PostgreSQL    │
                        │   + PostGIS     │
                        │   (Supabase)    │
                        └─────────────────┘
                                 │
                        ┌────────▼────────┐
                        │     Auth0       │
                        │   (JWT + OAuth) │
                        └─────────────────┘
```

### Technology Stack

- **Runtime**: Cloudflare Workers (V8 isolates, not Node.js processes)
- **Framework**: Hono (lightweight, edge-optimized)
- **Database**: PostgreSQL 15+ with PostGIS extension
- **Connection Pooling**: Cloudflare Hyperdrive
- **ORM**: Prisma 7+ with Cloudflare adapter
- **Authentication**: Auth0 (RS256 JWT + OAuth2)
- **Validation**: Zod for runtime schema validation
- **Testing**: Vitest with E2E integration tests
- **Admin UI**: Server-side JSX (Hono JSX, not React)

### Why Cloudflare Workers?

- **Global Distribution**: Deploy to 300+ edge locations worldwide
- **Low Latency**: Serve requests from the nearest location to users
- **Scalability**: Automatic scaling without configuration
- **Cost-Effective**: Pay only for what you use
- **Zero Cold Starts**: V8 isolates start in milliseconds

## Getting Started

### Prerequisites

Before you begin, ensure you have:

- **Node.js 20+**: Use `nvm` to manage versions (see `.nvmrc`)
- **pnpm**: Package manager (`npm install -g pnpm`)
- **Docker**: For running Supabase locally
- **Git**: Version control
- **Code Editor**: VS Code recommended with Prisma and TypeScript extensions

### Initial Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/public-convenience-ltd/toiletmap-server.git
   cd toiletmap-server
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Set up environment variables (optional):**
   
   The default configuration in `wrangler.jsonc` is sufficient for local development. You can optionally create a `.env` file to override defaults:

   ```bash
   # Optional: Override database connection
   # CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TEST_DB=postgresql://postgres:postgres@localhost:54322/postgres
   
   # Optional: Override Auth0 settings to test against production Auth0
   # By default, local development uses test auth server (http://127.0.0.1:44555/)
   # AUTH0_ISSUER_BASE_URL=https://your-tenant.auth0.com/
   # AUTH0_AUDIENCE=https://www.toiletmap.org.uk/api
   # AUTH0_CLIENT_ID=your_client_id
   # AUTH0_CLIENT_SECRET=your_client_secret
   ```

   > **Note**: Auth0 credentials are **not required** for local development. The project uses a test auth server by default (see [Authentication for Development](#authentication-for-development) below).

4. **Generate Prisma clients:**
   ```bash
   pnpm prisma:generate
   ```

   This generates two Prisma clients:
   - `src/generated/prisma/` - Cloudflare Workers runtime
   - `test/integration/generated/client/` - Node.js test runtime

5. **Start local database:**
   ```bash
   pnpm supabase:start
   ```

   This command:
   - Starts PostgreSQL 15 with PostGIS in Docker
   - Runs all migrations from `supabase/migrations/`
   - Seeds the database with test data from `supabase/seed.sql`
   - Exposes PostgreSQL on port `54322`

6. **Start development server:**
   ```bash
   pnpm dev
   ```

   The server starts on [http://localhost:8787](http://localhost:8787)

7. **Verify setup:**
   ```bash
   # Health check
   curl http://localhost:8787/

   # Should return: {"status":"ok"}
   ```

### Authentication for Development

The project includes a **test auth server** that eliminates the need for Auth0 credentials during local development. `pnpm dev` starts it automatically alongside Wrangler and Vite.

**Generate test tokens for API testing:**
```bash
# Terminal 1: start the dev stack (includes auth server)
pnpm dev
#   (or run pnpm auth:server if you're connecting to a deployed worker)

# Terminal 2: generate tokens
pnpm token:issue

# Use the token in API requests
curl -H "Authorization: Bearer $(pnpm token:issue)" http://localhost:8787/api/loos/search
```

> **Note**: `pnpm token:issue` connects to the running auth server on port 44555 to generate tokens with valid keys.

**Run the test auth server:**
```bash
pnpm dev          # Full dev stack (Wrangler + Vite + auth server)
# or, for auth server only:
pnpm auth:server

# Visit http://localhost:8787/admin and click Login
# When redirected to the local auth portal, click "Continue as Test User"
```

The test auth server provides:
- JWKS endpoint compatible with Auth0 middleware
- **Full OAuth2 authorization code flow**
- Valid RS256 JWT tokens
- Configurable user claims (name, email, permissions)
- Interactive login portal so `/authorize` flows mimic Auth0 (click the button to continue as Test User)

Before continuing you can customise the demo subject: toggle the `access:admin` / `report:loo` grants, add extra permissions, override name/email/scope, or paste JSON that will be merged into the issued tokens and `/userinfo` payload. This makes it easy to impersonate different contributors without touching code.

**Production Auth0 (optional):**
To test against real Auth0, create a `.env` file with your Auth0 credentials. This will override the test auth server defaults in `wrangler.jsonc`. When doing so, start the worker with `pnpm dev:api` so the local auth server is not launched automatically.

📚 See [Authentication Documentation](docs/authentication/overview.md) for details.

### Your First Contribution

Let's make a simple change to verify everything works:

1. **Run the test suite:**
   ```bash
   pnpm test:e2e
   ```

   All tests should pass ✅

2. **Make a small change:**
   Open `src/app.ts` and find the health check handler:
   ```typescript
   app.get('/', (c) => c.json({ status: 'ok' }))
   ```

   Change it to:
   ```typescript
   app.get('/', (c) => c.json({ status: 'ok', version: '1.0.0' }))
   ```

3. **Test your change:**
   ```bash
   curl http://localhost:8787/
   # Should return: {"status":"ok","version":"1.0.0"}
   ```

4. **Run type checking:**
   ```bash
   pnpm check
   ```

Congratulations! You've successfully set up your development environment and made your first change.

## Understanding the Codebase

### Request Flow

Let's trace a typical API request through the system:

```
1. Client Request
   │
   ├─→ GET /api/loos/abc123
   │
2. Cloudflare Worker Entry Point
   │   (src/index.ts)
   │
3. Hono Application
   │   (src/app.ts)
   │
4. Authentication Middleware
   │   (src/auth/middleware.ts)
   │   ├─→ Extract JWT from Authorization header or session cookies
   │   ├─→ Verify JWT with Auth0 (cached JWKS) and fetch userinfo if needed
   │   └─→ Set user + profile in context
   │
5. Route Handler
   │   (src/routes/loos/index.ts)
   │   ├─→ Validate request params with Zod
   │   └─→ Delegate to service layer
   │
6. Service Layer
   │   (src/services/loo/loo.service.ts)
   │   ├─→ Execute business logic
   │   └─→ Query database via Prisma
   │
7. Prisma Client
   │   (src/generated/prisma/client)
   │   ├─→ Execute SQL query
   │   └─→ Return database records
   │
8. Mappers
   │   (src/services/loo/mappers.ts)
   │   └─→ Transform DB records to API responses
   │
9. Response
   │   └─→ JSON returned to client
```

### Directory Structure Deep Dive

#### `src/routes/`

Route handlers are thin layers that:
- Validate incoming requests with Zod schemas
- Delegate to service layer
- Return responses

**Example**: `src/routes/loos/index.ts`
```typescript
app.get('/:id', zValidator('param', z.object({ id: z.string() })), async (c) => {
  const { id } = c.req.valid('param')
  const loo = await looService.getById(id)

  if (!loo) {
    return c.json({ message: 'Not found' }, 404)
  }

  return c.json(mapLoo(loo))
})
```

**Key principles**:
- Keep handlers thin (5-10 lines)
- No business logic in handlers
- Always validate inputs
- Use mappers for responses

#### `src/services/`

Service layer contains business logic and data access:

**`loo/loo.service.ts`**: Main service class
- `getById(id)` - Fetch single loo
- `getByIds(ids)` - Batch fetch
- `search(params)` - Filtered search with pagination
- `getSearchMetrics(params)` - Aggregate statistics
- `getByProximity(lat, lng, radius)` - Spatial proximity search
- `getWithinGeohash(geohash)` - Geohash prefix search
- `getReports(id)` - Audit trail
- `create(id, data, contributor)` - Insert new loo
- `upsert(id, data, contributor)` - Update or insert

**`loo/sql.ts`**: Complex SQL queries
- PostGIS spatial queries
- Full-text search
- Dynamic WHERE clause building
- Raw SQL with Prisma tagged templates

**`loo/mappers.ts`**: Data transformers
- `mapLoo()` - DB record → API response
- `mapNearbyLoo()` - DB record → Proximity response (with distance)
- `mapAuditRecordToReport()` - Audit log → Report response
- Pure functions, no side effects

**`loo/mutation.ts`**: Mutation field mapping
- Maps API request fields to database fields
- Handles special cases (opening hours, coordinates)

**`loo/persistence.ts`**: Low-level database operations
- `insertLoo()` - Raw INSERT with PostGIS functions
- `updateLoo()` - Raw UPDATE with array operations

#### `src/middleware/`

**`require-auth.ts`**: Authentication middleware
- Checks `Authorization` header for Bearer token
- Falls back to `access_token` cookie
- Verifies JWT with Auth0 JWKS
- Sets `c.user` in context
- Returns 401 if no valid auth

**`require-admin-role.ts`**: Authorization middleware
- Checks for `access:admin` permission
- Used to reveal contributor info in reports

#### `src/admin/`

Server-side rendered admin interface using Hono JSX:

**`index.tsx`**: Admin router
- Registers all admin routes
- Applies session middleware

**`auth.ts`**: OAuth2 flow handlers
- `/admin/login` - Redirects to Auth0
- `/admin/callback` - Exchanges code for tokens
- `/admin/logout` - Clears session

**`pages/`**: Admin pages
- `Dashboard.tsx` - Admin home
- `loos/list.tsx` - Dataset explorer
- `loos/create.tsx` - Loo creation form
- `Contributors.tsx` - Contributor management

**`components/`**: Reusable UI components
- `Layout.tsx` - Page layout wrapper
- `Header.tsx` - Navigation header
- Form components, buttons, etc.

**Important**: These are NOT React components! They use JSX syntax but compile to HTML strings. No client-side React runtime.

#### `src/auth/`

**`verify.ts`**: JWT verification logic
- Downloads JWKS from Auth0
- Verifies RS256 signatures
- Validates audience and issuer
- Caches signing keys (5 entries, 10 min TTL)

**`session.ts`**: Cookie session management
- Creates HTTP-only cookies
- Extracts tokens from cookies
- Encodes/decodes user info

#### `test/integration/`

E2E integration tests covering all endpoints:

- `health.spec.ts` - Health check
- `areas.spec.ts` - Area endpoints
- `loos.read.spec.ts` - Read operations
- `loos.mutation.spec.ts` - Create/update operations
- `loos.dataset.spec.ts` - Search and metrics
- `auth-cookies.spec.ts` - Session authentication
- `admin/admin.spec.ts` - Admin UI

**`utils/`**: Test helpers
- `auth-server.ts` - Mock JWKS server
- `test-client.ts` - Direct Worker invocation
- `fixtures.ts` - Test data factories
- `cleanup.ts` - Database cleanup

### Key Concepts

#### Dual Prisma Clients

The project uses two Prisma clients to support different runtime environments:

1. **Cloudflare Workers client** (`src/generated/prisma/`):
   - Uses `@prisma/adapter-pg` for edge runtime
   - No filesystem access (WASM engine)
   - Used in application code

2. **Node.js test client** (`test/integration/generated/client/`):
   - Standard Node.js runtime
   - Used only in tests

**Important**: Always import from the correct location:
```typescript
// In src/**/*.ts (application code)
import { PrismaClient } from '@/generated/prisma/client'

// In test/**/*.ts (test code)
import { PrismaClient } from '../generated/client'
```

#### Opening Hours Special Case

Opening hours are represented as a 7-element JSON array (Monday through Sunday):

```typescript
[
  ["09:00", "17:00"],  // Monday: 9am-5pm
  ["09:00", "17:00"],  // Tuesday: 9am-5pm
  [],                  // Wednesday: Closed
  ["00:00", "00:00"],  // Thursday: 24 hours (special case!)
  ["09:00", "17:00"],  // Friday: 9am-5pm
  ["10:00", "16:00"],  // Saturday: 10am-4pm
  []                   // Sunday: Closed
]
```

**Important**: `["00:00", "00:00"]` means "open 24 hours", not "closed" or "invalid"! This is handled specially in validation schemas.

#### Geohash Indexing

Every toilet record has a geohash (auto-generated by PostGIS):

```sql
-- Trigger on toilets table
CREATE TRIGGER set_geohash BEFORE INSERT OR UPDATE ON toilets
FOR EACH ROW EXECUTE FUNCTION update_geohash();
```

Geohashes enable efficient map tiling queries:

```typescript
// Get all toilets in a geohash region
const loos = await looService.getWithinGeohash('gcpuv')

// This uses a simple prefix match:
// WHERE geohash LIKE 'gcpuv%'
```

#### Audit Trail System

Every mutation creates an audit record in the `record_version` table:

```typescript
// When updating a toilet
await looService.upsert(id, data, contributor)

// This automatically creates a record_version entry:
{
  record_id: 'abc123',
  op: 'UPDATE',
  ts: '2024-11-29T09:21:00.000Z',
  auth_uid: 'user123',
  record: { /* current state */ },
  old_record: { /* previous state */ }
}
```

The audit trail is used for:
- Viewing change history (`GET /api/loos/:id/reports`)
- Tracking contributors
- Debugging data issues
- Compliance and transparency

## Authentication Deep Dive

### JWT Flow (API Clients)

1. **Client obtains JWT from Auth0:**
   ```
   Client → Auth0: Request token
   Auth0 → Client: Returns JWT
   ```

2. **Client makes API request:**
   ```bash
   curl -H "Authorization: Bearer eyJhbGc..." \
     http://localhost:8787/api/loos
   ```

3. **Server validates JWT:**
   ```typescript
   // src/auth/auth-context.ts
   const auth = await authenticateRequest(c)
   if (!auth) throw new HTTPException(401)
   c.set('user', auth.user) // includes name/email via user.profile
   ```

4. **JWT verification process:**
   ```typescript
   // src/auth/verify.ts

   // 1. Download JWKS from Auth0
   const jwks = await fetchJwks(issuerUrl)

   // 2. Find signing key for JWT
   const key = jwks.keys.find(k => k.kid === jwt.header.kid)

   // 3. Verify RS256 signature
   const valid = crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, payload)

   // 4. Validate claims
   assert(jwt.aud === env.AUTH0_AUDIENCE)
   assert(jwt.iss === env.AUTH0_ISSUER_BASE_URL)
   assert(jwt.exp > Date.now() / 1000)

   // 5. Return decoded token
   return jwt.payload
   ```

### OAuth2 Flow (Admin Interface)

1. **User visits `/admin/login`:**
   ```typescript
   // src/admin/auth.ts
   const authUrl = `${issuer}/authorize?` +
     `client_id=${clientId}&` +
     `redirect_uri=${redirectUri}&` +
     `response_type=code&` +
     `scope=${scope}`

   return c.redirect(authUrl)
   ```

2. **User authenticates on Auth0**

3. **Auth0 redirects back to `/admin/callback`:**
   ```typescript
   const code = c.req.query('code')

   // Exchange code for tokens
   const response = await fetch(`${issuer}/oauth/token`, {
     method: 'POST',
     body: JSON.stringify({
       grant_type: 'authorization_code',
       client_id: clientId,
       client_secret: clientSecret,
       code: code,
       redirect_uri: redirectUri
     })
   })

   const { access_token, id_token } = await response.json()
   ```

4. **Server sets HTTP-only cookies:**
   ```typescript
   setCookie(c, 'access_token', access_token, { httpOnly: true })
   setCookie(c, 'id_token', id_token, { httpOnly: true })
   setCookie(c, 'user_info', base64(userInfo), { httpOnly: true })

   return c.redirect('/admin')
   ```

5. **Subsequent requests use cookies:**
   ```typescript
   // src/auth/auth-context.ts
   const auth = await authenticateRequest(c)
   const user = auth?.user // falls back to id_token if needed
   ```

### Contributor Extraction

Contributor names are extracted from JWT claims:

```typescript
// src/services/loo/loo.service.ts

const contributorPath = env.AUTH0_PROFILE_KEY || 'name'
const contributor = contributorPath.split('.').reduce(
  (obj, key) => obj?.[key],
  user
) as string

// Examples:
// AUTH0_PROFILE_KEY="name" → user.name
// AUTH0_PROFILE_KEY="app_metadata.contributor_name" → user.app_metadata.contributor_name
```

This is stored in the `contributors` array in the database:

```sql
UPDATE toilets
SET contributors = array_append(contributors, $1)
WHERE id = $2
```

## Admin Interface Architecture

### Server-Side Rendering (SSR)

The admin interface uses Hono JSX for server-side rendering:

```typescript
// src/admin/pages/Dashboard.tsx

export function Dashboard() {
  return (
    <Layout title="Dashboard">
      <div class="container">
        <h1>Admin Dashboard</h1>
        <p>Welcome to the Toilet Map Admin Interface</p>
      </div>
    </Layout>
  )
}

// src/admin/index.tsx
app.get('/admin', requireAdminAuth, (c) => {
  return c.html(<Dashboard />)
})
```

**Key points**:
- JSX compiles to HTML strings (not React)
- No client-side framework
- Fast, lightweight pages
- SEO-friendly

### Client-Side Interactivity

For dynamic behavior, embed vanilla JavaScript:

```typescript
// src/admin/pages/loos/list.tsx

export function LoosList() {
  return (
    <Layout title="Dataset Explorer">
      <div id="loos-container"></div>

      <script>{`
        async function fetchLoos() {
          const response = await fetch('/api/loos/search?page=1&limit=25')
          const data = await response.json()
          renderTable(data)
        }

        function renderTable(data) {
          const container = document.getElementById('loos-container')
          container.innerHTML = data.data.map(loo => /* ... */).join('')
        }

        fetchLoos()
      `}</script>
    </Layout>
  )
}
```

### Dataset Explorer

The dataset explorer (`/admin/loos`) is the most complex admin page:

**Features**:
1. Real-time metrics panel
2. Advanced filtering (status, accessibility, payment, etc.)
3. Full-text search
4. Sortable columns
5. Pagination
6. Feature coverage visualization

**Implementation**:
- Fetches data from `/api/loos/search` and `/api/loos/metrics`
- Vanilla JS manages state and renders table
- URL query params store filter/sort state
- Server-side renders initial HTML shell

### User Tooling

Two dedicated pages keep contributor analytics separate from Auth0 account management:

#### User Statistics (`/admin/users/statistics`)

- Search contributors by handle (with autosuggest)
- View activity summaries, area coverage, recent loos, and audit diffs
- Quick links back to dataset explorer and individual loos
- Still powered by `UserInsightsService` and Prisma read models

#### User Administration (`/admin/users/admin`)

- Searches Auth0 directory records by email, name, or `user_id`
- Shows profile metadata (last login, total logins, created date) plus the raw permission list for our API
- Provides toggle buttons for the two critical permissions:
  - `access:admin` → unlocks the admin dashboard itself
  - `report:loo` → grants loo contribution/reporting rights
- Uses the new `Auth0ManagementClient` (`src/services/auth0/management.ts`) which wraps the Auth0 Management API with token caching
- Requires a dedicated Auth0 M2M application (`AUTH0_MANAGEMENT_CLIENT_ID` / `AUTH0_MANAGEMENT_CLIENT_SECRET`). Optionally override the default audience via `AUTH0_MANAGEMENT_AUDIENCE`.
- When credentials are missing, the page renders a warning banner and disables live search/updates so it is safe to deploy without the secrets.

## Database & PostGIS

### Schema Overview

The database has three main tables:

#### `toilets` (Main table)

```sql
CREATE TABLE toilets (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  verified_at TIMESTAMPTZ,
  contributors TEXT[],

  -- Location
  geography GEOGRAPHY(POINT, 4326),
  geohash TEXT GENERATED ALWAYS AS (st_geohash(geography, 10)) STORED,
  location JSONB GENERATED ALWAYS AS (
    jsonb_build_object(
      'lat', ST_Y(geography::geometry),
      'lng', ST_X(geography::geometry)
    )
  ) STORED,
  area_id TEXT REFERENCES areas(id),

  -- Features (boolean flags)
  accessible BOOLEAN,
  active BOOLEAN DEFAULT true,
  attended BOOLEAN,
  automatic BOOLEAN,
  baby_change BOOLEAN,
  men BOOLEAN,
  women BOOLEAN,
  urinal_only BOOLEAN,
  all_gender BOOLEAN,
  children BOOLEAN,
  radar BOOLEAN,
  no_payment BOOLEAN,

  -- Text fields
  name TEXT,
  notes TEXT,
  payment_details TEXT,
  removal_reason TEXT,
  opening_times JSONB
)
```

#### `areas` (Administrative boundaries)

```sql
CREATE TABLE areas (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE,
  type TEXT,
  geometry GEOGRAPHY(MULTIPOLYGON, 4326),
  priority INTEGER,
  dataset_id INTEGER,
  version INTEGER
)
```

#### `record_version` (Audit trail)

```sql
CREATE TABLE record_version (
  id BIGSERIAL PRIMARY KEY,
  record_id TEXT,
  old_record_id TEXT,
  op operation,  -- INSERT | UPDATE | DELETE | TRUNCATE
  ts TIMESTAMPTZ DEFAULT now(),
  table_oid OID,
  table_schema NAME,
  table_name NAME,
  record JSONB,
  old_record JSONB,
  auth_uid TEXT,
  auth_role TEXT
)
```

### PostGIS Functions

Common PostGIS operations used in the project:

**Create a point from coordinates:**
```sql
ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
```

**Distance query (proximity search):**
```sql
SELECT *,
  ST_Distance(
    geography,
    ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography
  ) as distance
FROM toilets
WHERE ST_DWithin(
  geography,
  ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography,
  $radius
)
ORDER BY distance
```

**Geohash generation:**
```sql
SELECT st_geohash(geography, 10) as geohash
FROM toilets
```

**Nearest neighbor search:**
```sql
SELECT *
FROM toilets
ORDER BY geography <-> ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography
LIMIT 10
```

### Migrations

Database migrations live in `supabase/migrations/`:

```
supabase/migrations/
├── 20231101000000_initial_schema.sql
├── 20231115000000_add_opening_hours.sql
├── 20231120000000_add_audit_triggers.sql
└── ...
```

**Creating a new migration:**

1. Make schema changes in Prisma Studio or SQL
2. Generate migration:
   ```bash
   supabase db diff -f my_migration_name
   ```
3. Review generated SQL in `supabase/migrations/`
4. Test migration:
   ```bash
   pnpm supabase:reset
   ```
5. Update Prisma schema if needed:
   ```bash
   pnpm prisma:db:pull
   pnpm prisma:generate
   ```

## Testing Strategy

### Test Philosophy

- **E2E Integration Tests**: Primary testing approach
- **No Unit Tests**: We test the system as a whole
- **Real Database**: Tests use actual Supabase instance
- **Mock Auth**: Local JWKS server for deterministic tokens

### Test Setup

Before each test run:

```typescript
// test/integration/setup.ts

beforeAll(async () => {
  // 1. Start mock JWKS server
  await startAuthServer()

  // 2. Start Supabase if not running
  if (!isSupabaseRunning()) {
    await execAsync('pnpm supabase:start')
  }

  // 3. Generate test Prisma client
  await execAsync('pnpm prisma:generate')

  // 4. Get test client
  testClient = createTestClient()
})

afterAll(async () => {
  // Cleanup (unless KEEP_SUPABASE=1)
  await stopAuthServer()
  if (!process.env.KEEP_SUPABASE) {
    await execAsync('pnpm supabase:stop')
  }
})
```

### Writing Tests

**Example test:**

```typescript
// test/integration/loos.read.spec.ts

import { describe, it, expect, beforeAll } from 'vitest'
import { testClient } from './context'
import { issueTestToken } from './utils/auth-server'
import { createTestLoo } from './utils/fixtures'

describe('GET /api/loos/:id', () => {
  let token: string
  let looId: string

  beforeAll(async () => {
    // Issue test JWT
    token = issueTestToken({ sub: 'user123', name: 'Test User' })

    // Create test loo
    const loo = await createTestLoo({
      name: 'Test Toilet',
      lat: 51.5074,
      lng: -0.1278
    })
    looId = loo.id
  })

  it('returns loo by ID', async () => {
    const response = await testClient.request('/api/loos/' + looId, {
      headers: { Authorization: `Bearer ${token}` }
    })

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.id).toBe(looId)
    expect(body.name).toBe('Test Toilet')
    expect(body.location).toEqual({
      lat: expect.closeTo(51.5074, 4),
      lng: expect.closeTo(-0.1278, 4)
    })
  })

  it('returns 404 for unknown ID', async () => {
    const response = await testClient.request('/api/loos/unknown', {
      headers: { Authorization: `Bearer ${token}` }
    })

    expect(response.status).toBe(404)
  })
})
```

### Test Utilities

**`issueTestToken(payload)`**: Create test JWT
```typescript
import { issueTestToken } from './utils/auth-server'

const token = issueTestToken({
  sub: 'user123',
  name: 'Test User',
  permissions: ['access:admin']
})
```

**`createTestLoo(data)`**: Create test toilet record
```typescript
import { createTestLoo } from './utils/fixtures'

const loo = await createTestLoo({
  name: 'Test Toilet',
  lat: 51.5074,
  lng: -0.1278,
  accessible: true
})
```

**`testClient.request(path, options)`**: Make test request
```typescript
import { testClient } from './context'

const response = await testClient.request('/api/loos', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ name: 'New Toilet' })
})
```

### Running Tests

```bash
# Run all tests
pnpm test:e2e

# Run specific test file
pnpm vitest run test/integration/loos.read.spec.ts

# Run tests in watch mode
pnpm vitest watch

# Keep database running between test runs
KEEP_SUPABASE=1 pnpm test:e2e
```

## Common Development Tasks

### Adding a New API Endpoint

Let's add a `GET /api/loos/count` endpoint:

1. **Define Zod schema** (if needed):
   ```typescript
   // src/routes/loos/schemas.ts
   export const CountQuerySchema = z.object({
     active: z.enum(['true', 'false', 'any']).optional()
   })
   ```

2. **Add service method**:
   ```typescript
   // src/services/loo/loo.service.ts
   async count(active?: boolean): Promise<number> {
     return await this.prisma.toilets.count({
       where: active !== undefined ? { active } : {}
     })
   }
   ```

3. **Create route handler**:
   ```typescript
   // src/routes/loos/index.ts
   import { zValidator } from '@hono/zod-validator'
   import { CountQuerySchema } from './schemas'

   app.get(
     '/count',
     requireAuth,
     zValidator('query', CountQuerySchema),
     async (c) => {
       const { active } = c.req.valid('query')
       const count = await looService.count(
         active === 'true' ? true : active === 'false' ? false : undefined
       )
       return c.json({ count })
     }
   )
   ```

4. **Write tests**:
   ```typescript
   // test/integration/loos.read.spec.ts
   describe('GET /api/loos/count', () => {
     it('returns total count', async () => {
       const response = await testClient.request('/api/loos/count', {
         headers: { Authorization: `Bearer ${token}` }
       })

       expect(response.status).toBe(200)
       const body = await response.json()
       expect(body.count).toBeGreaterThan(0)
     })
   })
   ```

5. **Run tests and verify**:
   ```bash
   pnpm test:e2e
   ```

### Modifying Database Schema

Let's add a `rating` field to toilets:

1. **Update Prisma schema**:
   ```prisma
   // prisma/schema.prisma
   model toilets {
     // ... existing fields
     rating Float?
   }
   ```

2. **Create migration**:
   ```bash
   # Create SQL migration
   supabase db diff -f add_rating_field

   # This creates: supabase/migrations/20241129000000_add_rating_field.sql
   ```

3. **Review migration**:
   ```sql
   -- supabase/migrations/20241129000000_add_rating_field.sql
   ALTER TABLE toilets ADD COLUMN rating FLOAT;
   ```

4. **Test migration**:
   ```bash
   pnpm supabase:reset
   ```

5. **Generate Prisma clients**:
   ```bash
   pnpm prisma:generate
   ```

6. **Update mappers**:
   ```typescript
   // src/services/loo/mappers.ts
   export function mapLoo(loo: Toilet): LooResponse {
     return {
       // ... existing fields
       rating: loo.rating
     }
   }
   ```

7. **Update mutation types**:
   ```typescript
   // src/services/loo/mutation.ts
   export const MutationFieldMap = {
     // ... existing fields
     rating: 'rating'
   }
   ```

8. **Add validation**:
   ```typescript
   // src/routes/loos/schemas.ts
   export const CreateLooSchema = z.object({
     // ... existing fields
     rating: z.number().min(0).max(5).optional()
   })
   ```

### Adding Admin Interface Page

Let's add a `/admin/stats` page:

1. **Create page component**:
   ```typescript
   // src/admin/pages/Stats.tsx
   import { Layout } from '../components/Layout'

   export function Stats() {
     return (
       <Layout title="Statistics">
         <div class="container">
           <h1>System Statistics</h1>
           <div id="stats-container">Loading...</div>

           <script>{`
             async function loadStats() {
               const response = await fetch('/api/loos/metrics')
               const data = await response.json()

               document.getElementById('stats-container').innerHTML = \`
                 <div>
                   <p>Total: \${data.total}</p>
                   <p>Active: \${data.active}</p>
                   <p>Verified: \${data.verified}</p>
                 </div>
               \`
             }

             loadStats()
           `}</script>
         </div>
       </Layout>
     )
   }
   ```

2. **Register route**:
   ```typescript
   // src/admin/index.tsx
   import { Stats } from './pages/Stats'

   app.get('/admin/stats', requireAuth, (c) => {
     return c.html(<Stats />)
   })
   ```

3. **Add navigation link**:
   ```typescript
   // src/admin/components/Header.tsx
   export function Header() {
     return (
       <nav>
         <a href="/admin">Dashboard</a>
         <a href="/admin/loos">Loos</a>
         <a href="/admin/stats">Statistics</a>
       </nav>
     )
   }
   ```

4. **Test in browser**:
   - Navigate to http://localhost:8787/admin/stats
   - Verify page loads and displays statistics

### Debugging Production Issues

1. **Access Cloudflare logs**:
   ```bash
   wrangler tail
   ```

2. **View logs in dashboard**:
   - Go to Cloudflare dashboard → Workers → toiletmap-server → Logs

3. **Add debug logging**:
   ```typescript
   // src/services/loo/loo.service.ts
   async getById(id: string) {
     console.log('[LooService] Getting loo by ID:', id)

     const loo = await this.prisma.toilets.findUnique({ where: { id } })

     console.log('[LooService] Found loo:', loo ? 'yes' : 'no')

     return loo
   }
   ```

4. **Test locally with production config**:

   Option 1: Use wrangler dev with remote bindings:
   ```bash
   # Test with production HYPERDRIVE binding
   pnpm wrangler dev --remote
   ```

   Option 2: Override TEST_DB locally:
   ```bash
   # In .env, temporarily set the override to point to production database
   CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TEST_DB=<production-database-url>
   AUTH0_ISSUER_BASE_URL=https://your-tenant.auth0.com/

   # Start dev server
   pnpm dev
   ```

## Troubleshooting

### Common Issues

#### "Prisma client is not configured for this environment"

**Problem**: Using wrong Prisma client for runtime

**Solution**: Import from correct location
```typescript
// In src/**/*.ts
import { PrismaClient } from '@/generated/prisma/client'

// In test/**/*.ts
import { PrismaClient } from '../generated/client'
```

#### "JWKS endpoint not accessible"

**Problem**: Auth0 JWKS endpoint unreachable

**Solution**: Check `AUTH0_ISSUER_BASE_URL` is correct
```bash
# Test JWKS endpoint
curl https://your-tenant.auth0.com/.well-known/jwks.json
```

#### "Supabase is not running"

**Problem**: Database not started

**Solution**: Start Supabase manually
```bash
pnpm supabase:start

# If that fails, check Docker:
docker ps

# Reset if needed:
pnpm supabase:stop
docker system prune -a
pnpm supabase:start
```

#### "Opening hours validation failed"

**Problem**: Treating `["00:00", "00:00"]` as invalid

**Solution**: Remember this means "24 hours open"
```typescript
// Validation schema handles this:
z.array(z.tuple([z.string(), z.string()])).refine(
  ([open, close]) => {
    // Allow 00:00-00:00 (24 hours)
    if (open === '00:00' && close === '00:00') return true

    // Otherwise open must be before close
    return open < close
  }
)
```

#### "401 Unauthorized in tests"

**Problem**: Missing or invalid test token

**Solution**: Use `issueTestToken()` helper
```typescript
import { issueTestToken } from './utils/auth-server'

const token = issueTestToken({ sub: 'test-user' })

const response = await testClient.request('/api/loos', {
  headers: { Authorization: `Bearer ${token}` }
})
```

### Getting Help

1. **Check documentation**:
   - [AGENTS.md](./AGENTS.md) - Project overview
   - [README.md](./README.md) - Quick start guide
   - This file - Comprehensive onboarding

2. **Search existing code**:
   ```bash
   # Find similar patterns
   grep -r "similar pattern" src/

   # Find usage examples
   grep -r "functionName" test/
   ```

3. **Run tests**:
   ```bash
   pnpm test:e2e
   ```
   Tests are executable documentation!

4. **Check Cloudflare Workers docs**:
   - https://developers.cloudflare.com/workers/

5. **Ask maintainers**:
   - Open GitHub issue
   - Tag maintainers in PR

## Best Practices

### Code Style

1. **Use TypeScript strictly**:
   ```typescript
   // ✅ Good
   function getUser(id: string): Promise<User | null> {
     return prisma.users.findUnique({ where: { id } })
   }

   // ❌ Bad
   function getUser(id: any): any {
     return prisma.users.findUnique({ where: { id } })
   }
   ```

2. **Validate inputs with Zod**:
   ```typescript
   // ✅ Good
   const schema = z.object({ name: z.string().min(1) })
   const data = schema.parse(input)

   // ❌ Bad
   const data = input as { name: string }
   ```

3. **Keep functions small**:
   ```typescript
   // ✅ Good (single responsibility)
   async function createLoo(data: LooInput) {
     validateLooData(data)
     const loo = await insertLoo(data)
     await createAuditRecord(loo)
     return loo
   }

   // ❌ Bad (too much in one function)
   async function createLoo(data: any) {
     // 100 lines of validation
     // 50 lines of transformation
     // 30 lines of database operations
     // 20 lines of audit logging
   }
   ```

4. **Use mappers consistently**:
   ```typescript
   // ✅ Good
   const loo = await prisma.toilets.findUnique({ where: { id } })
   return mapLoo(loo)

   // ❌ Bad
   const loo = await prisma.toilets.findUnique({ where: { id } })
   return {
     id: loo.id,
     name: loo.name,
     // ... manual mapping
   }
   ```

### Security

1. **Never log sensitive data**:
   ```typescript
   // ✅ Good
   console.log('User authenticated:', user.id)

   // ❌ Bad
   console.log('Token:', token)
   console.log('Full user:', user)
   ```

2. **Enforce auth on mutation endpoints**:
   ```typescript
   // ✅ Good
   app.post('/api/loos', requireAuth, async (c) => { /* ... */ })

   // ❌ Bad
   app.post('/api/loos', async (c) => {
     // No auth check!
   })
   ```
   Read endpoints stay public—wrap them in `optionalAuth` only when you need user context (e.g., revealing contributor names for admins).

3. **Use environment variables for secrets**:
   ```typescript
   // ✅ Good
   const secret = env.AUTH0_CLIENT_SECRET

   // ❌ Bad
   const secret = 'hardcoded_secret'
   ```

4. **Sanitize user input**:
   ```typescript
   // ✅ Good
   const name = z.string().max(100).parse(input.name)

   // ❌ Bad
   const name = input.name // Could be malicious
   ```

### Performance

1. **Use database indexes**:
   ```sql
   -- Create index for common queries
   CREATE INDEX idx_toilets_active ON toilets(active);
   CREATE INDEX idx_toilets_geohash ON toilets(geohash);
   ```

2. **Batch database queries**:
   ```typescript
   // ✅ Good
   const loos = await prisma.toilets.findMany({
     where: { id: { in: ids } }
   })

   // ❌ Bad
   const loos = await Promise.all(
     ids.map(id => prisma.toilets.findUnique({ where: { id } }))
   )
   ```

3. **Cache expensive operations**:
   ```typescript
   // ✅ Good
   let cachedJwks: JWK[] | null = null
   let cacheExpiry = 0

   async function getJwks() {
     if (cachedJwks && Date.now() < cacheExpiry) {
       return cachedJwks
     }

     cachedJwks = await fetchJwks()
     cacheExpiry = Date.now() + 10 * 60 * 1000 // 10 min
     return cachedJwks
   }
   ```

4. **Minimize response payload**:
   ```typescript
   // ✅ Good
   return c.json(mapLoo(loo)) // Only necessary fields

   // ❌ Bad
   return c.json(loo) // Includes internal fields
   ```

## Contributing Guidelines

### Before You Start

1. **Read this guide** completely
2. **Set up development environment** and verify tests pass
3. **Check existing issues** to avoid duplicate work
4. **Discuss major changes** before implementing

### Development Workflow

1. **Create feature branch**:
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make changes**:
   - Write code following style guide
   - Add tests for new functionality
   - Update documentation if needed

3. **Test locally**:
   ```bash
   pnpm check        # Type checking
   pnpm test:e2e     # Run tests
   pnpm dev          # Manual testing
   ```

4. **Commit changes**:
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

   Use conventional commit messages:
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation changes
   - `refactor:` Code refactoring
   - `test:` Test changes
   - `chore:` Build/tooling changes

5. **Push and create PR**:
   ```bash
   git push origin feature/my-feature
   ```

   In PR description:
   - Describe what changed and why
   - Link related issues
   - Include screenshots if UI changes
   - List breaking changes if any

### Pull Request Checklist

- [ ] Tests pass locally (`pnpm test:e2e`)
- [ ] Type checking passes (`pnpm check`)
- [ ] Code follows style guide
- [ ] New functionality has tests
- [ ] Documentation updated if needed
- [ ] Commit messages are clear
- [ ] PR description is complete

### Code Review Process

1. Maintainer reviews PR
2. Address feedback if requested
3. Maintainer approves and merges
4. Changes deployed to production

## Conclusion

Congratulations! You've completed the onboarding guide. You should now have:

- ✅ Understanding of project architecture
- ✅ Working development environment
- ✅ Knowledge of authentication flows
- ✅ Familiarity with testing approach
- ✅ Ability to make common changes
- ✅ Troubleshooting skills
- ✅ Best practices knowledge

### Next Steps

1. **Pick your first issue**:
   - Look for `good first issue` label on GitHub
   - Start with documentation or test improvements

2. **Explore the codebase**:
   - Read through `src/services/loo/` to understand core logic
   - Review `test/integration/` to see how things work

3. **Make your first contribution**:
   - Fix a small bug
   - Add a test
   - Improve documentation

4. **Ask questions**:
   - Open GitHub discussions
   - Comment on issues
   - Tag maintainers

### Useful Resources

- **Hono Docs**: https://hono.dev/
- **Cloudflare Workers**: https://developers.cloudflare.com/workers/
- **Prisma**: https://www.prisma.io/docs
- **PostGIS**: https://postgis.net/documentation/
- **Auth0**: https://auth0.com/docs
- **Zod**: https://zod.dev/

Welcome to the team! 🚽✨
