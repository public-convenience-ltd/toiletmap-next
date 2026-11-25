# API Authentication

Only write endpoints (`POST /api/loos`, `PUT /api/loos/:id`) and privileged data (e.g., contributor names in audit reports) require authentication. All other `GET /api/*` routes are public but will attach user context when valid credentials are supplied.

## Shared Middleware

`src/auth/middleware.ts` exports three middleware variants:

- `optionalAuth` – attaches `c.user` when credentials are provided, otherwise continues anonymously.
- `requireAuth` – enforces authentication for API routes and responds with `401` when missing/invalid.
- `requireAdminAuth` – same as `requireAuth` but redirects browsers to `/admin/login`.

Read endpoints such as `/api/loos/:id/reports` use `optionalAuth` so anonymous users can access the data while admins who provide tokens gain additional fields (e.g., contributor names). The token must claim `access:admin` and the Auth0 Management API must confirm it and that the user is not blocked (`isConfirmedAdmin`), so a revocation takes effect within a minute.

Each middleware relies on `src/auth/auth-context.ts` which:

1. Looks for an `Authorization: Bearer` header before falling back to the `access_token` cookie (the `id_token` cookie is never a credential).
2. Verifies JWTs via the cached Auth0 JWKS (`src/auth/verify.ts`). If the JWKS cannot be fetched, `optionalAuth` continues as anonymous.
3. Takes `name`, `email` and `nickname` from the verified `id_token` cookie (same `sub`) or Auth0 `/userinfo`, so they are present on `c.get('user')` and mirrored under `user.profile`.

Cookie-authenticated state-changing requests must be same-origin (see `src/middleware/csrf.ts`); send a Bearer token from scripts and other clients.

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
   - A client-credentials token belongs to an application, not a user, so it cannot be blocked in Auth0. Its loo writes (create, edit, report, restore) go live directly only when the token carries `access:admin`; otherwise they are queued for moderation like an anonymous submission.
