# Troubleshooting

Common issues encountered during development and their solutions.

## Database Issues

### Connection Refused (`ECONNREFUSED`)

**Error**: `Error: connect ECONNREFUSED ::1:54322`

**Cause**: The local Supabase database is not running or is unreachable.

**Solution**:
Restart the local database stack:
```bash
pnpm supabase:stop
pnpm supabase:start
```

### Prisma Client Errors

**Error**: `Cannot find module '@prisma/client'` or type errors.

**Cause**: The Prisma client has not been generated or is out of sync with the schema.

**Solution**:
Regenerate the client:
```bash
pnpm prisma:generate
```

## Server Issues

### Port Already in Use

**Error**: `Error: listen EADDRINUSE: address already in use 127.0.0.1:8787`

**Cause**: Another instance of the server or a zombie process is occupying the port.

**Solution**:
Find and kill the process:
```bash
# Find the process ID
lsof -ti:8787

# Kill the process
lsof -ti:8787 | xargs kill -9
```

## Authentication Issues

### Token Validation Failed

**Error**: `Invalid token` or 401 Unauthorized.

**Cause**: The token might be expired, from the wrong issuer, or the auth server is not running.

**Solution**:
1. Ensure the auth server is running (via `pnpm dev` or `pnpm auth:server`)
2. Generate a fresh token: `pnpm token:issue`
3. Check that your `.env` file is not overriding the test auth server settings with production credentials (unless intended).
