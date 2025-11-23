# Auth0 Audience and Cookie Authentication Update

## Changes

### 1. Login Flow Update
Updated `src/admin/auth.ts` to include `audience` in the Auth0 authorization URL. This ensures that the `access_token` returned by Auth0 is a valid JWT for the API.

### 2. Middleware Update
Enhanced `src/middleware/require-auth.ts` to support authentication via both `access_token` and `id_token` stored in cookies.
- **Access Token**: Verified against `AUTH0_AUDIENCE` (API identifier).
- **ID Token**: Verified against `AUTH0_CLIENT_ID` (Client identifier).

This ensures that if the `access_token` is missing or invalid (e.g. opaque token from old session), the system falls back to verifying the `id_token`.

### 3. Verification Logic
Updated `src/auth/verify.ts` to allow `authenticateToken` to accept an optional `audience` parameter, enabling verification of tokens intended for different audiences (API vs Client).

### 4. Testing
- Updated `test/integration/utils/auth-server.ts` to allow overriding the audience when issuing tokens.
- Updated `test/integration/setup.ts` to include `AUTH0_CLIENT_ID` in the test environment.
- Created `test/integration/auth-cookies.spec.ts` to verify:
    - Authentication with valid `id_token` in cookie.
    - Authentication with valid `access_token` in cookie.
    - Rejection of invalid tokens.

## Verification Results

Ran all integration tests, including the new cookie authentication tests.

```bash
npx vitest run
```

Output:
```
 Test Files  7 passed (7)
      Tests  36 passed (36)
   Start at  12:02:38     
   Duration  4.23s
Exit code: 0
```
