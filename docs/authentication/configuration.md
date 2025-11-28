# Configuration

Authentication is configured differently for local development and production.

## Local Development (Test Auth Server)

By default, local development uses a **test auth server** that provides JWKS endpoints and valid JWT tokens without requiring Auth0 credentials.

**Default configuration** (from `wrangler.jsonc`):
- `AUTH0_ISSUER_BASE_URL`: `http://127.0.0.1:44555/`
- `AUTH0_AUDIENCE`: `https://toiletmap.org.uk`
- `AUTH0_CLIENT_ID`: `test_client_id`
- `AUTH0_CLIENT_SECRET`: `test_client_secret`

`pnpm dev` automatically starts the worker, asset watcher, and auth server. Open a second terminal to run CLI utilities such as `pnpm token:issue`. Start the auth server separately only if you're running the worker without `pnpm dev` (for example against production Auth0).

When the admin UI redirects to `/authorize` you’ll now see a lightweight login portal: click “Continue as Test User” to approve the request just like Auth0’s hosted page. Automated tools can still auto-approve by adding `auto=1` to the `/authorize` URL (the CLI token generator already does this).

**Generating test tokens:**
```bash
# Terminal 1: start the dev stack (includes auth server)
pnpm dev

# Terminal 2: generate a test JWT token
pnpm token:issue

# Add --admin for admin permissions
pnpm token:issue --admin

# Generate with custom claims
pnpm token:issue --name="Developer" --email="dev@example.com"
```

**Starting the test auth server:**
```bash
pnpm dev          # Wrangler + Vite + auth server (default dev workflow)
# or
pnpm auth:server  # Auth server only (pair with pnpm dev:api or remote worker)
```

## Production (Real Auth0)

Production uses real Auth0 credentials configured via environment variables:

- `AUTH0_ISSUER_BASE_URL`: The Auth0 domain (e.g., `https://your-tenant.auth0.com/`).
- `AUTH0_AUDIENCE`: The API Identifier.
- `AUTH0_CLIENT_ID`: Client ID for the application.
- `AUTH0_CLIENT_SECRET`: Client Secret (stored as Cloudflare secret).
- `AUTH0_REDIRECT_URI`: Callback URL (e.g., `https://www.toiletmap.org.uk/admin/callback`).
- `AUTH0_SCOPE`: OAuth scopes requested.
- `AUTH0_PROFILE_KEY`: Path to extract contributor name from JWT claims (optional).

## Testing Against Production Auth0 Locally

To override the test auth server and use production Auth0 locally, create a `.env` file:

```bash
AUTH0_ISSUER_BASE_URL=https://your-tenant.auth0.com/
AUTH0_AUDIENCE=https://www.toiletmap.org.uk/api
AUTH0_CLIENT_ID=your_client_id
AUTH0_CLIENT_SECRET=your_client_secret
AUTH0_REDIRECT_URI=http://localhost:8787/admin/callback
AUTH0_SCOPE=openid profile email offline_access roles access:admin
```

These values will override the defaults in `wrangler.jsonc`.

When using production Auth0 locally, run `pnpm dev:api` to avoid starting the bundled auth server, and keep `pnpm auth:server` stopped unless you explicitly need it.
