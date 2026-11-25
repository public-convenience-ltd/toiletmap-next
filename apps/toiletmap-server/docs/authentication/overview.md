# Authentication Overview

The Toilet Map API and Admin Interface use [Auth0](https://auth0.com/) for authentication. JWT verification is centralised in the `@toiletmap/auth` shared package (`packages/auth`).

## Core Mechanisms

- **Admin Interface**: Uses the Authorization Code Flow (server-side). Redirects to Auth0, then, once both tokens verify, sets HTTP-only session cookies (`access_token`, `id_token`) that last no longer than the tokens. The profile (name, email) is read from the verified `id_token` on each request, never from a cookie the browser could edit. Cookie-authenticated POST/PUT/DELETE requests under `/admin` and `/api` must be same-origin (`Origin` or `Sec-Fetch-Site`), else 403.

- **Client Worker (public site)**: Uses the Authorization Code Flow with PKCE (`/auth/login` → `/auth/callback`). On callback the client worker exchanges the code for tokens, verifies the id token, and sets the httpOnly `access_token` and `id_token` cookies plus a value-less `signed_in=1` flag (not httpOnly) that the header reads to show "Sign out". Logout clears them (and the legacy `user_info` cookie).

- **API mutations**: `POST /api/loos` and `PUT /api/loos/:id` accept either a Bearer token or a session cookie. If no valid credential is present the request is accepted as an **anonymous submission** — it is rate-limited and queued in `pending_change` for admin review rather than written directly to the database. Approved changes are applied by an admin via `POST /admin/pending/:id/approve`. A signed-in caller writes directly (no permission needed) unless they are blocked in Auth0; blocked users and users whose block status the Auth0 Management API cannot confirm (including any environment other than `development` without Management credentials, so previews queue signed-in writes) are queued like anonymous submissions, limited to one queued change a minute; a session whose access token no longer verifies is anonymous (the `id_token` is never a credential). The same rule applies to `POST /api/loos/:id/report` and `/restore`. Whoever writes, only a confirmed admin may set `active`, `removalReason` or `location: null`, choose a new loo's `id`, create a loo with `PUT`, or place a loo outside the GB / NI / Isle of Man / Channel Islands box; a non-admin move of more than 50 m is queued even when the caller could write directly (see `src/routes/loos/write-guards.ts`). Every write records the caller's Auth0 `sub` privately in `toilets.updated_by_sub` (a queued change keeps it in `pending_change.submitter_sub`, and approval stores the submitter's, not the moderator's). A non-admin account's removals and moves are capped at `ACCOUNT_DAILY_CAP` (default 10) a day, after which they are queued (`reason: "daily_cap"`, `src/services/write-caps.ts`). The write kill switch (`write_mode` in the `SETTINGS` KV namespace: `open`, `queue` or `read-only`) can queue every non-admin write or refuse every write with a 503; see `docs/runbooks/kill-switch.md` at the repository root.

- **Read endpoints**: Fully public, no authentication required.

## Token Verification

Both the server and client worker import `authenticateToken` from `@toiletmap/auth`:

```ts
import { authenticateToken } from "@toiletmap/auth";

const user = await authenticateToken(token, env, audience);
```

JWKS keys are fetched from `${AUTH0_ISSUER_BASE_URL}/.well-known/jwks.json` and cached for 10 minutes (refetched for an unknown `kid` at most every 30 s). The function requires `exp`, the configured `iss`, and an `aud` that is exactly the expected audience or an array containing it (delimited strings are one audience; an empty expected audience rejects every token), and normalises the resulting user object. A JWKS fetch failure throws `JwksUnavailableError`; optional-auth routes then treat the caller as anonymous.

## Session Cookie Shape

| Cookie | `httpOnly` | Content |
|--------|-----------|---------|
| `id_token` | ✅ | Signed JWT (audience = `AUTH0_CLIENT_ID`); profile claims only, never a credential |
| `access_token` | ✅ | Signed JWT (audience = `AUTH0_AUDIENCE`) carrying `permissions`; the credential |
| `signed_in` | ❌ | Client worker only: always `1`, no data; drives the header's Sign in / Sign out |

## Environment Variables

| Variable | Required by | Purpose |
|----------|-------------|---------|
| `AUTH0_ISSUER_BASE_URL` | Both | e.g. `https://your-tenant.auth0.com` |
| `AUTH0_AUDIENCE` | Both | API identifier in Auth0 |
| `AUTH0_CLIENT_ID` | Both | Application client ID |
| `AUTH0_CLIENT_SECRET` | Client worker | Used in PKCE token exchange |

See `.dev.vars.example` in each app for the full variable list.
