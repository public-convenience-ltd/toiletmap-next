# Authentication Overview

The Toilet Map API and Admin Interface use [Auth0](https://auth0.com/) for authentication. JWT verification is centralised in the `@toiletmap/auth` shared package (`packages/auth`).

## Core Mechanisms

- **Admin Interface**: Uses the Authorization Code Flow (server-side). Redirects to Auth0, then sets HTTP-only session cookies (`access_token`, `id_token`, `user_info`) upon successful callback.

- **Client Worker (public site)**: Uses the Authorization Code Flow with PKCE (`/auth/login` → `/auth/callback`). On callback the client worker exchanges the code for tokens, verifies the id token, and sets the same three HTTP-only cookies. Logout clears all three cookies.

- **API mutations**: `POST /api/loos` and `PUT /api/loos/:id` accept either a Bearer token or a session cookie. If no valid credential is present the request is accepted as an **anonymous submission** — it is rate-limited and queued in `pending_change` for admin review rather than written directly to the database. Approved changes are applied by an admin via `POST /admin/pending/:id/approve`.

- **Read endpoints**: Fully public, no authentication required.

## Token Verification

Both the server and client worker import `authenticateToken` from `@toiletmap/auth`:

```ts
import { authenticateToken } from "@toiletmap/auth";

const user = await authenticateToken(token, env, audience);
```

JWKS keys are fetched from `${AUTH0_ISSUER_BASE_URL}/.well-known/jwks.json` and cached. The function validates the `iss` and `aud` claims and normalises the resulting user object.

## Session Cookie Shape

| Cookie | `httpOnly` | Content |
|--------|-----------|---------|
| `id_token` | ✅ | Signed JWT (audience = `AUTH0_CLIENT_ID`) |
| `access_token` | ✅ | Signed JWT (audience = `AUTH0_AUDIENCE`) carrying `permissions` |
| `user_info` | ❌ | Base64-encoded JSON `{ sub, email, name, nickname }` readable by the browser |

## Environment Variables

| Variable | Required by | Purpose |
|----------|-------------|---------|
| `AUTH0_ISSUER_BASE_URL` | Both | e.g. `https://your-tenant.auth0.com` |
| `AUTH0_AUDIENCE` | Both | API identifier in Auth0 |
| `AUTH0_CLIENT_ID` | Both | Application client ID |
| `AUTH0_CLIENT_SECRET` | Client worker | Used in PKCE token exchange |

See `.dev.vars.example` in each app for the full variable list.
