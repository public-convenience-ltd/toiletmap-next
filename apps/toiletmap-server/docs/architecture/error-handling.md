# Error Handling and Sanitization

This guide explains how toiletmap-server handles errors and prevents sensitive information leakage in production environments.

## Overview

The application uses a multi-layered error handling system that:
- **Catches and logs all errors** with full details for debugging
- **Sanitizes error responses** in production/preview to prevent information disclosure
- **Maintains observability** through structured logging
- **Preserves developer experience** in development with detailed error messages

## Architecture

### Error Handling Layers

```
┌─────────────────────────────────────────┐
│  Client Request                         │
└─────────────────┬───────────────────────┘
                  │
        ┌─────────▼──────────┐
        │ Request Logger     │ ◄── Logs all requests/responses
        └─────────┬──────────┘
                  │
        ┌─────────▼──────────┐
        │ Route Handlers     │ ◄── Validation errors (400)
        └─────────┬──────────┘
                  │
        ┌─────────▼──────────┐
        │ Business Logic     │ ◄── Service/database errors
        └─────────┬──────────┘
                  │
        ┌─────────▼──────────┐
        │ Error Sanitizer    │ ◄── Sanitizes based on environment
        └─────────┬──────────┘
                  │
        ┌─────────▼──────────┐
        │ Global Error       │ ◄── Catches unhandled errors
        │ Handler            │
        └─────────┬──────────┘
                  │
        ┌─────────▼──────────┐
        │ Client Response    │ ◄── Generic or detailed errors
        └────────────────────┘
```

### Key Components

#### 1. Environment Detection (`src/utils/environment.ts`)

Determines whether to sanitize errors based on the `ENVIRONMENT` variable:

```typescript
isPublicEnvironment(env: Env): boolean
```

- Returns `true` for `production` and `preview` → Sanitize errors
- Returns `false` for `development` → Show detailed errors
- **Safe by default**: If `ENVIRONMENT` is unset, treats it as public (sanitizes errors)

#### 2. Error Sanitizer (`src/utils/error-sanitizer.ts`)

Provides sanitization functions for different contexts:

**For Health Checks:**
```typescript
sanitizeHealthCheckError(
  env: Env,
  checkName: string,
  error: unknown,
  responseTime?: number
): SanitizedHealthCheckError
```

- Public environments: Returns `"database check failed"` (generic)
- Development: Returns actual error message for debugging

**For API Endpoints:**
```typescript
sanitizeApiError(
  env: Env,
  error: unknown,
  fallbackMessage?: string
): SanitizedApiError
```

- Public environments: Returns generic message, no stack trace
- Development: Returns error details and stack trace

#### 3. Global Error Handler (`src/app.ts`)

Catches all unhandled exceptions and errors that bubble up from routes:

```typescript
app.onError((err, c) => {
  // Always log full error details server-side
  logger.error('Unhandled error', {
    method: c.req.method,
    path: c.req.path,
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
    },
    userId: c.get('user')?.sub,
  });

  // Return sanitized response in public environments
  if (isPublic) {
    return c.json({
      message: 'Internal Server Error',
      error: 'An unexpected error occurred. Please try again later.',
    }, 500);
  }

  // Development: include full details
  return c.json({
    message: 'Internal Server Error',
    error: String(err),
    stack: err.stack,
  }, 500);
});
```

## Environment Configuration

### Setting the ENVIRONMENT Variable

Configure in `wrangler.jsonc`:

**Production:**
```jsonc
"env": {
  "production": {
    "vars": {
      "ENVIRONMENT": "production"
    }
  }
}
```

**Preview:**
```jsonc
"env": {
  "preview": {
    "vars": {
      "ENVIRONMENT": "preview"
    }
  }
}
```

**Development:**
The `ENVIRONMENT` variable is not set, defaulting to development mode.

### Environment Effects

| Feature | Production/Preview | Development |
|---------|-------------------|-------------|
| Error messages | Generic, sanitized | Detailed, specific |
| Stack traces | Never exposed | Included in responses |
| Validation errors | Sanitized field details | Full Zod error output |
| Health check errors | Generic "check failed" | Actual error message |
| Server-side logging | Full details | Full details |
| HSTS headers | Enabled | Disabled |
| CORS | Whitelist only | Allow all (`*`) |

## Error Types and Handling

### 1. Validation Errors (400)

**Source**: Zod schema validation in route handlers

**Development Response:**
```json
{
  "message": "Invalid request",
  "issues": {
    "_errors": [],
    "geohash": {
      "_errors": ["String must contain at least 1 character(s)"]
    }
  }
}
```

**Production Response:**
```json
{
  "message": "Invalid request",
  "issues": {
    "_errors": [],
    "geohash": {
      "_errors": ["String must contain at least 1 character(s)"]
    }
  }
}
```

**Note**: Validation errors show field-level issues in all environments since they don't expose implementation details.

### 2. Authentication Errors (401)

**Source**: Auth middleware, token validation

**Response (all environments):**
```json
{
  "message": "Unauthorized"
}
```

**Server-side log:**
```json
{
  "level": "error",
  "message": "Token verification failed",
  "context": {
    "error": {
      "name": "TokenExpiredError",
      "message": "jwt expired",
      "expiredAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

### 3. Database Errors (500)

**Source**: Prisma queries, database connection issues

**Development Response:**
```json
{
  "message": "Internal Server Error",
  "error": "DriverAdapterError: Server connection attempt failed: e=Wrong password",
  "stack": "DriverAdapterError: Server connection attempt failed...\n    at PrismaPgAdapter.onError (index.js:27679:11)\n    ..."
}
```

**Production Response:**
```json
{
  "message": "Internal Server Error",
  "error": "An unexpected error occurred. Please try again later."
}
```

### 4. Health Check Errors (503)

**Source**: Health check endpoints when dependencies fail

**Development Response:**
```json
{
  "status": "degraded",
  "checks": [{
    "name": "database",
    "status": "error",
    "message": "Invalid `prisma.$queryRaw()` invocation: Connection refused",
    "responseTime": 5000
  }]
}
```

**Production Response:**
```json
{
  "status": "degraded",
  "checks": [{
    "name": "database",
    "status": "error",
    "message": "database check failed",
    "responseTime": 5000
  }]
}
```

### 5. Rate Limit Errors (429)

**Source**: Rate limiting middleware

**Response (all environments):**
```json
{
  "message": "Too many requests, please try again later",
  "error": "rate_limit_exceeded"
}
```

## Security Considerations

### Information Disclosure Prevention

Error messages in production/preview NEVER expose:

❌ **Database credentials**
```
Wrong: "Server connection attempt failed: e=Wrong password"
Right: "database check failed"
```

❌ **Connection strings**
```
Wrong: "Failed to connect to postgresql://user:pass@host:5432/db"
Right: "An unexpected error occurred"
```

❌ **Stack traces**
```
Wrong: "at PrismaPgAdapter.onError (index.js:27679:11)"
Right: No stack trace in response
```

❌ **Implementation details**
```
Wrong: "DriverAdapterError: Invalid Prisma query"
Right: "An unexpected error occurred"
```

❌ **Internal paths**
```
Wrong: "/var/app/src/services/loo.service.ts:123"
Right: No file paths in response
```

### Attack Surface Reduction

Generic error messages prevent attackers from:
1. **Fingerprinting the stack**: Can't determine which libraries/versions are used
2. **Reconnaissance**: Can't discover database structure or internal architecture
3. **Timing attacks**: Error response times are consistent
4. **Credential probing**: Can't distinguish "wrong password" from other errors

## Logging and Observability

### What Gets Logged

**All errors are logged server-side with full context:**

```json
{
  "level": "error",
  "message": "Unhandled error",
  "timestamp": "2024-11-30T12:00:00.000Z",
  "service": "toiletmap-server",
  "context": {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "method": "POST",
    "path": "/api/loos",
    "userId": "auth0|123456",
    "error": {
      "name": "PrismaClientKnownRequestError",
      "message": "Unique constraint failed on the fields: (`id`)",
      "stack": "PrismaClientKnownRequestError: ...\n    at ...",
      "code": "P2002",
      "meta": {
        "target": ["id"]
      }
    },
    "duration": 245
  }
}
```

### Accessing Error Logs

**Cloudflare Dashboard:**
1. Navigate to Workers & Pages > toiletmap-server > Logs
2. Filter by `level:error`
3. Search for specific error patterns

**Common Queries:**
```
# All database errors
level:error AND (message:"Database" OR message:"Prisma")

# Specific user's errors
context.userId:"auth0|123456"

# Slow requests with errors
level:error AND context.duration > 1000

# Authentication failures
level:error AND status:401
```

## Development Workflow

### Local Development

In development, you get detailed errors to speed up debugging:

```bash
# Start dev server
pnpm dev

# Errors show full details:
curl http://localhost:8787/api/loos/invalid-id
{
  "message": "Internal Server Error",
  "error": "PrismaClientValidationError: Invalid value for...",
  "stack": "PrismaClientValidationError...\n    at ..."
}
```

### Testing Error Handling

Run integration tests to verify error sanitization:

```bash
pnpm test:e2e

# Tests verify:
# - No sensitive info in production responses
# - Full details logged server-side
# - Proper HTTP status codes
# - Generic messages in public environments
```

### Debugging Production Issues

1. **Never** rely on client-facing error messages in production
2. **Always** check Cloudflare Workers logs for details
3. **Use** request IDs to correlate errors with logs
4. **Monitor** error rates in Cloudflare Analytics

## Best Practices

### For Developers

✅ **DO:**
- Always use the sanitizer utilities for custom error handling
- Log full error context for debugging
- Return appropriate HTTP status codes (400, 401, 403, 404, 500, 503)
- Test both success and error paths

❌ **DON'T:**
- Return raw error messages to clients
- Include stack traces in error responses
- Expose database details in errors
- Use console.log in production code (use structured logger)

### Adding New Error Handling

When adding new endpoints or features:

1. **Validation errors** → Use Zod validator, returns 400
2. **Business logic errors** → Throw errors, let global handler catch them
3. **Custom error messages** → Use `sanitizeApiError()` utility
4. **Health checks** → Use `sanitizeHealthCheckError()` utility

**Example:**

```typescript
// Good: Uses sanitizer
async someEndpoint(c: AppContext) {
  try {
    const result = await someOperation();
    return c.json(result);
  } catch (error) {
    // Log full details
    logger.error('Operation failed', { error });

    // Return sanitized error
    const sanitized = sanitizeApiError(
      c.env,
      error,
      'Failed to complete operation'
    );

    return c.json(sanitized, 500);
  }
}

// Bad: Exposes raw error
async someEndpoint(c: AppContext) {
  try {
    const result = await someOperation();
    return c.json(result);
  } catch (error) {
    // ❌ Exposes implementation details
    return c.json({
      error: error.message,
      stack: error.stack
    }, 500);
  }
}
```

## Testing

### Unit Tests

Test the sanitization utilities:

```typescript
import { sanitizeHealthCheckError } from '../utils/error-sanitizer';

describe('Error sanitization', () => {
  it('sanitizes errors in production', () => {
    const env = { ENVIRONMENT: 'production' as const };
    const error = new Error('Database connection failed: password incorrect');

    const result = sanitizeHealthCheckError(env, 'database', error, 100);

    expect(result.message).toBe('database check failed');
    expect(result.message).not.toContain('password');
  });

  it('shows details in development', () => {
    const env = { ENVIRONMENT: 'development' as const };
    const error = new Error('Connection failed');

    const result = sanitizeHealthCheckError(env, 'database', error, 100);

    expect(result.message).toBe('Connection failed');
  });
});
```

### Integration Tests

Verify end-to-end error handling:

```typescript
describe('Health check error handling', () => {
  it('does not expose sensitive information', async () => {
    const response = await callApi('/health/ready');
    const body = await response.json();
    const bodyStr = JSON.stringify(body);

    // Verify no sensitive data
    expect(bodyStr).not.toContain('password');
    expect(bodyStr).not.toContain('Wrong password');
    expect(bodyStr).not.toContain('postgresql://');
    expect(bodyStr).not.toContain('stack');
  });
});
```

## Troubleshooting

### "Why am I seeing generic errors in preview?"

Preview environments are treated as public to prevent accidental information disclosure. Check Cloudflare logs for detailed error information.

### "How do I debug errors in production?"

1. Check Cloudflare Workers logs for full error details
2. Use request IDs to correlate client errors with server logs
3. Set up alerts for high error rates
4. Review recent deployments if error rate spikes

### "Can I temporarily enable detailed errors in production?"

No. This is a security feature. Instead:
1. Replicate the issue in a local or preview environment
2. Use Cloudflare logs to see full error details
3. Set up proper monitoring and alerting

## See Also

- [Deployment Guide](../operations/deployment.md) - Environment configuration
- [Monitoring Guide](../operations/monitoring.md) - Log access and alerting
- [Architecture Overview](./overview.md) - System design
- [Testing Guide](../development/testing.md) - Testing strategies
