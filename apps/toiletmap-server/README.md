# Toilet Map API

A REST API and admin interface for managing public toilet data across the UK. Deployed as a [Cloudflare Worker](https://workers.cloudflare.com/) with PostgreSQL + PostGIS for spatial queries, Auth0 for authentication, and server-side rendered admin dashboard.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)](https://workers.cloudflare.com/)
[![Prisma](https://img.shields.io/badge/Prisma-7.x-brightgreen)](https://www.prisma.io/)
[![PostGIS](https://img.shields.io/badge/PostGIS-3.x-blue)](https://postgis.net/)

## Features

- **🗺️ Geospatial API**: Proximity search, geohash indexing, and spatial queries powered by PostGIS
- **⚡ Edge Deployment**: Global low-latency access via Cloudflare's 300+ data centers
- **🔐 Secure Authentication**: Auth0 JWT validation with RS256 + OAuth2 session flow
- **📝 Complete Audit Trail**: Full history tracking for all data mutations
- **🎨 Admin Dashboard**: Server-side rendered interface for data management (Hono JSX)
- **✅ Type-Safe**: End-to-end TypeScript with Prisma ORM and Zod validation
- **🛡️ Rate Limiting**: Datacenter-level rate limiting via Cloudflare API

## Quick Start

```bash
# Install dependencies
pnpm install

# Generate Prisma clients
pnpm prisma:generate

# Start local database (PostgreSQL + PostGIS in Docker)
pnpm supabase:start

# Start dev stack (Worker + admin UI + local auth server)
pnpm dev
```

`pnpm dev` runs Vite (admin assets), Wrangler dev server, and the bundled auth server on http://127.0.0.1:44555. The API + admin UI are available at [http://localhost:8787](http://localhost:8787).

**Verify setup:**

```bash
curl http://localhost:8787/
# Response: {"status":"ok"}

pnpm test:e2e  # Run integration tests
```

> **Note**: Auth0 credentials are **optional** for local development. The project uses a test auth server by default. See [Authentication Setup](#authentication-for-local-development) below.

📚 See [Quick Start Guide](docs/getting-started/quick-start.md) for detailed setup

## Authentication for Local Development

The project includes a **test auth server** that runs automatically during development and integration tests. You can build and test authenticated features **without setting up Auth0**.

### Using Test Auth Server

`pnpm dev` launches Wrangler, the Vite asset watcher, and the local auth server on `http://127.0.0.1:44555/`. Open a second terminal for commands like `pnpm token:issue`. If you only need the auth server (for example when running tests against a deployed worker), start it standalone with `pnpm auth:server`.

**Option 1: Generate test tokens** (recommended for API testing)

```bash
# Terminal 1: start the dev stack (includes auth server)
pnpm dev

# Terminal 2: generate a token
pnpm token:issue

# Use the token in API requests
curl -H "Authorization: Bearer $(pnpm token:issue)" http://localhost:8787/api/loos/search
```

> **Note**: `pnpm token:issue` requires the auth server to be running on port 44555.

**Option 2: Admin UI Login** (OAuth2 flow supported!)

```bash
pnpm dev
# Visit http://localhost:8787/admin and click Login (then hit "Continue as Test User")
```

The test auth server provides:

- JWKS endpoint at `http://127.0.0.1:44555/`
- Valid JWT tokens that work with the Auth0 middleware
- Configurable user claims (name, email, permissions)
- Interactive login portal so `/authorize` flows look like Auth0 (click the button to continue)

#### Customising the demo user

Open the local login dialog and tailor the issued tokens before signing in:

- Toggle **`access:admin`** / **`report:loo`** or add comma/newline-separated permissions
- Override the subject, name, nickname, email, avatar, and contributor display name (`app_metadata.contributor_name`)
- Edit the OAuth **scope** to test different combinations
- Paste any JSON blob to merge custom claims into the ID token, access token, and `/userinfo` response (great for simulating Auth0 namespaces)

Changes are reflected instantly in the preview card, and client-side JSON validation helps catch typos before submitting.

Need to connect to real Auth0 or run the worker without the bundled auth? Use `pnpm dev:api` (Wrangler + Vite only) and either run `pnpm auth:server` separately or set real Auth0 credentials below.

### Using Production Auth0 (Optional)

To test against a real Auth0 tenant, override the default configuration in your `.env` file:

```bash
AUTH0_ISSUER_BASE_URL=https://your-tenant.auth0.com/
AUTH0_AUDIENCE=https://www.toiletmap.org.uk/api
AUTH0_CLIENT_ID=your_client_id
AUTH0_CLIENT_SECRET=your_client_secret
# Optional fallback; runtime derives redirect URI from the current request origin
# AUTH0_REDIRECT_URI=http://localhost:8787/admin/callback
AUTH0_SCOPE=openid profile email offline_access roles access:admin
```

📚 See [Authentication Documentation](docs/authentication/overview.md) for details.

## Documentation

### Getting Started

- [📖 Quick Start](docs/getting-started/quick-start.md) - Get running in 5 minutes
- [📖 Detailed Setup](docs/onboarding/environment.md) - Comprehensive onboarding
- [🔧 Common Tasks](docs/onboarding/workflows.md) - Development workflows

### Architecture

- [🏗️ System Overview](docs/architecture/overview.md) - Architecture diagrams and design principles
- [🔄 Request Flow](docs/architecture/request-flow.md) - Sequence diagrams for common flows
- [🗄️ Database Schema](docs/onboarding/data-flow.md) - PostGIS spatial database
- [🔐 Authentication](docs/authentication/overview.md) - Auth0 OAuth2/JWT implementation

### Development

- [✅ Testing Guide](docs/development/testing.md) - Writing and running tests
- [⚡ Rate Limiting](docs/operations/rate-limiting.md) - Rate limiting strategy and configuration

### Operations

- [🚀 Deployment](docs/operations/deployment.md) - Production deployment guide
- [📈 Monitoring](docs/operations/monitoring.md) - Logs, metrics, and alerts

## Project Structure

```
.
├── src/
│   ├── app.ts                    # Hono application setup
│   ├── routes/                   # HTTP route handlers
│   │   ├── loos/                # Loo CRUD + search endpoints
│   │   └── areas/               # Area (region) endpoints
│   ├── services/                 # Business logic layer
│   │   ├── loo/                 # LooService
│   │   └── area/                # AreaService
│   ├── middleware/               # HTTP middleware
│   │   ├── cloudflare-rate-limit.ts
│   │   └── rate-limit.ts
│   ├── auth/                     # Authentication
│   │   ├── middleware.ts        # Auth middleware
│   │   ├── session.ts           # Session management
│   │   └── userinfo.ts          # Auth0 userinfo
│   ├── admin/                    # Server-side rendered admin UI
│   │   ├── components/          # JSX components
│   │   └── pages/               # Admin pages
│   └── generated/prisma/         # Generated Prisma client
├── test/
│   ├── integration/              # E2E integration tests
│   └── fixtures/                 # Test data factories
├── supabase/
│   └── migrations/               # Database migrations
├── docs/                         # Documentation
│   ├── getting-started/
│   ├── architecture/
│   └── development/
└── wrangler.toml                 # Cloudflare Workers config
```

## Technology Stack

| Layer              | Technology                         |
| ------------------ | ---------------------------------- |
| **Runtime**        | Cloudflare Workers (V8 isolates)   |
| **Framework**      | Hono 4.x                           |
| **Language**       | TypeScript 5.x (strict mode)       |
| **Database**       | PostgreSQL 15+ with PostGIS 3.x    |
| **ORM**            | Prisma 7.x with Cloudflare adapter |
| **Validation**     | Zod + @hono/zod-validator          |
| **Authentication** | Auth0 (RS256 JWT + OAuth2)         |
| **Testing**        | Vitest with E2E integration tests  |
| **Admin UI**       | Hono JSX (server-side rendering)   |

## API Endpoints

### Public API

| Endpoint                     | Method | Description                   |
| ---------------------------- | ------ | ----------------------------- |
| `/api/loos/:id`              | GET    | Get loo by ID                 |
| `/api/loos?ids=`             | GET    | Get loos by IDs (batch)       |
| `/api/loos/proximity`        | GET    | Search by lat/lng/radius      |
| `/api/loos/geohash/:geohash` | GET    | Search by geohash prefix      |
| `/api/loos/search`           | GET    | Full-text search with filters |
| `/api/loos/:id/reports`      | GET    | Get loo update history        |
| `/api/loos`                  | POST   | Create loo (auth required)    |
| `/api/loos/:id`              | PUT    | Update loo (auth required)    |

### Admin UI

| Endpoint             | Method   | Description     |
| -------------------- | -------- | --------------- |
| `/admin`             | GET      | Admin dashboard |
| `/admin/loos`        | GET      | Loo management  |
| `/admin/loos/create` | GET/POST | Create loo form |
| `/admin/loos/:id`    | GET/POST | Edit loo form   |
| `/admin/users`       | GET      | User management |
| `/admin/login`       | GET      | Login page      |

See [API Documentation](docs/openapi.json) for OpenAPI spec.

## Rate Limiting

The application implements datacenter-level rate limiting via Cloudflare's Rate Limiting API:

| Tier      | Limit       | Scope       | Endpoints          |
| --------- | ----------- | ----------- | ------------------ |
| **Read**  | 100 req/min | Per IP      | Public API reads   |
| **Write** | 20 req/min  | Per User/IP | Create/Update loos |
| **Admin** | 60 req/min  | Per User/IP | Admin operations   |
| **Auth**  | 5 req/min   | Per IP      | Login attempts     |

📚 See [Rate Limiting Documentation](docs/operations/rate-limiting.md) for details.

## Development Commands

| Command                | Description                                            |
| ---------------------- | ------------------------------------------------------ |
| `pnpm dev`             | Full dev stack (Wrangler + Vite + local auth server)   |
| `pnpm dev:api`         | Wrangler + Vite only (use when pointing at real Auth0) |
| `pnpm test:e2e`        | Run integration tests                                  |
| `pnpm typecheck`       | TypeScript type checking                               |
| `pnpm supabase:start`  | Start local PostgreSQL + PostGIS                       |
| `pnpm supabase:stop`   | Stop local database                                    |
| `pnpm prisma:generate` | Regenerate Prisma clients                              |
| `pnpm auth:server`     | Run just the local auth server (port 44555)            |
| `pnpm deploy`          | Deploy to Cloudflare Workers                           |

## Testing

```bash
# Run all integration tests
pnpm test:e2e

# Run specific test file
pnpm vitest run test/integration/loos.read.spec.ts

# Watch mode
pnpm vitest watch
```

Tests use:

- **Vitest** for test runner
- **Local Supabase** for database (PostgreSQL + PostGIS in Docker)
- **Fixtures** for test data creation
- **Full integration** testing (HTTP → Database)

📚 See [Testing Guide](docs/development/testing.md) for details.

## Deployment

### Production Deployment

```bash
# Deploy to Cloudflare Workers
pnpm deploy
```

Deployment checklist:

- [ ] Set `ENVIRONMENT=production` in Cloudflare Workers environment
- [ ] Configure `ALLOWED_ORIGINS` for CORS
- [ ] Set up Auth0 production tenant
- [ ] Configure Cloudflare Rate Limiting bindings
- [ ] Configure `HYPERDRIVE` binding to point to production database (Supabase)
- [ ] Verify custom domain and SSL

### Environment Variables

Required in Cloudflare Workers dashboard. The worker now derives the Auth0 redirect URI from the incoming request origin (so preview deployments Just Work). Keep the legacy `AUTH0_REDIRECT_URI` configured as a fallback/allow-list entry in Auth0.

```bash
ENVIRONMENT=production
ALLOWED_ORIGINS=https://www.toiletmap.org.uk,https://admin.toiletmap.org.uk
AUTH0_ISSUER_BASE_URL=https://your-tenant.auth0.com/
AUTH0_AUDIENCE=https://www.toiletmap.org.uk/api
AUTH0_CLIENT_ID=production_client_id
AUTH0_CLIENT_SECRET=production_client_secret
# Optional fallback; runtime detects the origin automatically
# AUTH0_REDIRECT_URI=https://www.toiletmap.org.uk/admin/callback
AUTH0_SCOPE=openid profile email offline_access roles access:admin
AUTH0_PROFILE_KEY=name
```

📚 See [Deployment Guide](docs/onboarding/workflows.md) for detailed instructions.

## Contributing

We welcome contributions! Please see:

- [Onboarding Guide](docs/onboarding/overview.md) - Comprehensive project overview
- [Architecture Overview](docs/architecture/overview.md) - System architecture
- [Testing Guide](docs/development/testing.md) - How to test changes

## License

MIT License

## Acknowledgments

- Built by [Public Convenience Ltd](https://github.com/public-convenience-ltd)
- Powered by [Cloudflare Workers](https://workers.cloudflare.com/), [PostGIS](https://postgis.net/), and [Auth0](https://auth0.com/)
- Data contributed by the community

## Support

- **Documentation**: [docs/](docs/)
- **Issues**: [GitHub Issues](https://github.com/public-convenience-ltd/toiletmap-server/issues)
- **API Docs**: [OpenAPI Spec](docs/openapi.json)
