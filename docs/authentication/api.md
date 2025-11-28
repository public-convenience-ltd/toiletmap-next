# API Authentication

Only write endpoints (`POST /api/loos`, `PUT /api/loos/:id`) and privileged data (e.g., contributor names in audit reports) require authentication. All other `GET /api/*` routes are public but will attach user context when valid credentials are supplied.

## Shared Middleware

`src/auth/middleware.ts` exports three middleware variants:

- `optionalAuth` – attaches `c.user` when credentials are provided, otherwise continues anonymously.
- `requireAuth` – enforces authentication for API routes and responds with `401` when missing/invalid.
- `requireAdminAuth` – same as `requireAuth` but redirects browsers to `/admin/login`.

Read endpoints such as `/api/loos/:id/reports` use `optionalAuth` so anonymous users can access the data while admins who provide tokens gain additional fields (e.g., contributor names).

Each middleware relies on `src/auth/auth-context.ts` which:

1. Looks for an `Authorization: Bearer` header before falling back to `access_token`/`id_token` cookies.
2. Verifies JWTs via the cached Auth0 JWKS client (`src/auth/verify.ts`).
3. Fetches Auth0 `/userinfo` (or uses the `user_info` cookie) so fields such as `name`, `email`, and `nickname` are always present on `c.get('user')` and mirrored under `user.profile`.

## Authentication Methods

### Method 1: Bearer Token (Recommended for Clients)

Clients (mobile apps, third-party integrations) should use a Bearer token.

**Request Header:**
```http
Authorization: Bearer <YOUR_ACCESS_TOKEN>
```

### Method 2: Session Cookie (Browser/Admin)

If you are logged into the Admin Interface in the same browser, the API will automatically use your session cookies. This is useful for:
- The Admin Interface itself making API calls.
- Developers testing API endpoints in the browser after logging into the Admin UI.

## Obtaining an Access Token

### For Development/Testing

1. **Via Admin Login**:
   - Navigate to `/admin/login`.
   - Log in with your credentials.
   - You are now authenticated. You can inspect your browser cookies to see the `access_token`.
   - You can also visit `/api/loos` directly in the browser.

2. **Via Auth0 (Machine-to-Machine)**:
   - If you have a Machine-to-Machine application set up in Auth0, you can request a token using the Client Credentials Flow:
     ```bash
     curl --request POST \
       --url 'https://YOUR_DOMAIN/oauth/token' \
       --header 'content-type: application/json' \
       --data '{"client_id":"YOUR_CLIENT_ID","client_secret":"YOUR_CLIENT_SECRET","audience":"YOUR_AUDIENCE","grant_type":"client_credentials"}'
     ```
