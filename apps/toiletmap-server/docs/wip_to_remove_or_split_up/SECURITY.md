# Security Guide

## Overview

This document outlines the security measures implemented in the Toilet Map API and provides guidance for maintaining a secure production environment.

## Table of Contents

1. [Security Features](#security-features)
2. [Authentication & Authorization](#authentication--authorization)
3. [Data Protection](#data-protection)
4. [Network Security](#network-security)
5. [Input Validation](#input-validation)
6. [Monitoring & Incident Response](#monitoring--incident-response)
7. [Vulnerability Management](#vulnerability-management)
8. [Compliance](#compliance)

---

## Security Features

### Implemented Security Controls

✅ **Authentication**
- JWT-based authentication via Auth0
- RS256 algorithm for token signing
- JWKS caching for performance
- Session management with httpOnly cookies

✅ **Authorization**
- Role-based access control (RBAC)
- Permission-based endpoint protection
- Admin-only routes protected

✅ **Rate Limiting**
- Configurable per-endpoint limits
- IP-based request throttling
- Protection against DDoS and brute force attacks

✅ **Security Headers**
- CORS with origin whitelisting
- Content Security Policy (CSP)
- X-Frame-Options (clickjacking protection)
- X-Content-Type-Options (MIME sniffing protection)
- Referrer-Policy
- HSTS (HTTP Strict Transport Security)

✅ **Input Validation**
- Zod schema validation for all inputs
- SQL injection prevention (parameterized queries)
- XSS protection through output encoding
- Path traversal protection

✅ **Error Handling**
- No stack traces in production
- Sanitized error messages
- Structured logging with sensitive data filtering

✅ **Database Security**
- Hyperdrive manages connection pooling automatically
- TLS encryption handled by Hyperdrive (reduces connection overhead)
- Least privilege database user
- Row-level security (RLS) policies
- Audit logging for all data changes

✅ **Code Security**
- TypeScript strict mode
- Dependency vulnerability scanning
- CI/CD security checks

---

## Authentication & Authorization

### Auth0 Integration

#### JWT Token Validation

```typescript
// ../../src/auth/verify.ts
- Validates JWT signature using Auth0 JWKS
- Checks token expiration
- Verifies audience and issuer
- Caches JWKS keys for 10 minutes
```

#### Best Practices

1. **Token Expiration**
   - Access tokens: 1 hour (recommended)
   - Refresh tokens: 30 days (recommended)
   - Session cookies: 24 hours

2. **Permission Scopes**
   ```typescript
   const REQUIRED_PERMISSIONS = {
     ADMIN: 'access:admin',
     REPORT_LOO: 'report:loo',
   };
   ```

3. **Secure Token Storage**
   - Never store tokens in localStorage (XSS risk)
   - Use httpOnly cookies for web clients
   - Use secure storage (Keychain/KeyStore) for mobile

### Role-Based Access Control

#### Admin Permission

Protected routes require `access:admin` permission:

```typescript
// ../../src/middleware/require-admin-role.ts
export const requireAdmin = (user?: RequestUser) => {
  const permissions = user?.permissions ?? [];
  return permissions.includes(ADMIN_PERMISSION);
};
```

#### Protected Endpoints

| Endpoint | Permission Required |
|----------|---------------------|
| `POST /api/loos` | `report:loo` or `access:admin` |
| `PUT /api/loos/:id` | `report:loo` or `access:admin` |
| `/admin/*` | `access:admin` |

### Session Management

#### Session Cookie Security

```typescript
// ../../src/auth/session.ts
{
  httpOnly: true,        // Prevent JavaScript access
  secure: true,          // HTTPS only
  sameSite: 'lax',       // CSRF protection
  maxAge: 86400,         // 24 hours
}
```

#### Session Invalidation

- Sessions expire after 24 hours
- Users must re-authenticate
- No server-side session storage (stateless)

---

## Data Protection

### Encryption

#### In Transit
- All traffic over HTTPS/TLS 1.3
- Cloudflare automatic HTTPS redirects
- HSTS header forces HTTPS
- **Hyperdrive TLS optimization**:
  - TLS handshake at edge (fast local connection)
  - Persistent TLS connections to database
  - Reduces TLS negotiation overhead (from 3 round trips to 0 for pooled connections)

#### At Rest
- Database encrypted at rest (provider-managed)
- Sensitive fields should use application-level encryption if needed
- Backups encrypted by storage provider

### Cloudflare Hyperdrive Security Benefits

Hyperdrive provides several security advantages:

1. **Reduced Attack Surface**:
   - Connection credentials managed centrally in Cloudflare dashboard
   - No database credentials stored in Worker code
   - Credentials only accessible via binding

2. **TLS Termination at Edge**:
   - TLS handshake happens at edge (close to Worker)
   - Reduces latency and connection overhead
   - Persistent TLS connections to database from pool

3. **Connection Pooling Security**:
   - Limits total connections to database (prevents exhaustion attacks)
   - Automatic connection lifecycle management
   - Pool placement near database minimizes network exposure

4. **Query Monitoring**:
   - All queries pass through Hyperdrive
   - Enables centralized query logging and monitoring
   - Can detect anomalous query patterns

### Sensitive Data Handling

#### PII (Personally Identifiable Information)

User data stored:
- Email (from Auth0)
- Name/Nickname (from Auth0)
- Auth0 user ID

**Best Practices:**
- Never log PII in production
- Filter PII from error messages
- Mask PII in admin interfaces

```typescript
// Example: Logging with PII filtering
logger.info('User action', {
  userId: user.sub, // OK - pseudonymous ID
  email: '[REDACTED]', // Don't log email
  action: 'create_loo',
});
```

### Data Retention

#### Audit Logs
- Retained indefinitely
- Contains record history for toilets and areas
- Used for data recovery and compliance

#### Application Logs
- Retained for 7 days (Cloudflare free tier)
- Retained for 30 days (Cloudflare paid tier)
- Contains request logs and errors

#### Database Backups
- Daily backups retained for 30 days
- Monthly backups retained for 1 year
- GDPR right to deletion requires backup purging

---

## Network Security

### CORS Configuration

#### Production Settings

```typescript
// ../../wrangler.jsonc environment variables
ALLOWED_ORIGINS=https://www.toiletmap.org,https://toiletmap.org
```

#### Validation

CORS middleware validates:
- Origin header matches whitelist
- Credentials allowed only for whitelisted origins
- Preflight requests handled correctly

**Never use `*` in production!**

### Rate Limiting

Rate limiting is implemented using **Cloudflare's native Rate Limiting API**, providing datacenter-level protection that is more reliable than per-isolate in-memory limiting.

#### Current Limits

| Route Pattern | Limit | Window | Key Strategy |
|---------------|-------|--------|--------------|
| `/admin/login`, `/admin/callback` | 5 requests | 60 seconds | IP-based |
| `/admin/*` (other routes) | 60 requests | 60 seconds | User ID or IP |
| `/api/*` (read) | 100 requests | 60 seconds | IP-based |
| `/api/*` (write) | 20 requests | 60 seconds | User ID or IP |

**Key Strategies:**
- **IP-based**: Rate limit applied per client IP address (public endpoints)
- **User-based**: Rate limit applied per authenticated user ID, falls back to IP if not authenticated (protected endpoints)

This hybrid approach follows Cloudflare's best practices and provides more accurate rate limiting for authenticated users while protecting public endpoints from IP-based abuse.

#### Configuration

Rate limits are configured in [../../wrangler.jsonc](../../wrangler.jsonc):

```jsonc
"ratelimits": [
  {
    "name": "RATE_LIMIT_READ",
    "namespace_id": "1000",
    "simple": { "limit": 100, "period": 60 }
  },
  {
    "name": "RATE_LIMIT_ADMIN",
    "namespace_id": "1002",
    "simple": { "limit": 60, "period": 60 }
  },
  {
    "name": "RATE_LIMIT_AUTH",
    "namespace_id": "1003",
    "simple": { "limit": 5, "period": 60 }
  }
]
```

#### Customization

To adjust rate limits:

1. **Modify limits in wrangler.jsonc**: Change the `limit` value in the ratelimits configuration
2. **Update middleware**: Edit [../../src/middleware/cloudflare-rate-limit.ts](../../src/middleware/cloudflare-rate-limit.ts) to change key generation strategy or add new rate limiters
3. **Redeploy**: Run `pnpm deploy` to apply changes

Example custom rate limiter:

```typescript
export const customRateLimit = cloudflareRateLimit({
  binding: 'RATE_LIMIT_CUSTOM',
  keyGenerator: (c) => `custom:${getClientIp(c)}`,
  message: 'Custom rate limit exceeded',
});
```

#### Behavior

- **Per-datacenter limits**: Rate limits are enforced at each Cloudflare datacenter, not globally
- **Fail-open strategy**: If rate limiting fails, requests are allowed (logged error)
- **No rate limit headers**: Unlike the previous implementation, Cloudflare's API does not provide `X-RateLimit-Remaining` or `X-RateLimit-Reset` headers
- **429 Response**: When rate limit is exceeded, returns HTTP 429 with JSON error message

### DDoS Protection

#### Cloudflare Layer
- Automatic DDoS mitigation
- Challenge pages for suspicious traffic
- IP reputation filtering

#### Application Layer
- Rate limiting per IP
- Request size limits
- Query complexity limits (pagination required)

---

## Input Validation

### Validation Strategy

All user inputs validated using Zod schemas:

```typescript
// ../../src/routes/loos/schemas.ts
export const createLooSchema = z.object({
  name: nullableTrimmed(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  // ... more fields
});
```

### SQL Injection Prevention

#### Parameterized Queries

✅ **Safe (Parameterized)**:
```typescript
Prisma.sql`SELECT * FROM toilets WHERE name = ${userInput}`;
```

❌ **Unsafe (String Interpolation)**:
```typescript
// NEVER DO THIS
Prisma.sql`SELECT * FROM toilets WHERE name = '${userInput}'`;
```

#### Column Whitelisting

```typescript
// ../../src/services/loo/sql.ts
const ALLOWED_LIKE_COLUMNS = {
  'loo.name': Prisma.sql`loo.name`,
  'loo.geohash': Prisma.sql`loo.geohash`,
  // ... whitelisted columns only
} as const;
```

### XSS Prevention

#### Output Encoding

- Admin UI uses JSX which automatically escapes output
- API responses are JSON (not HTML)
- User-generated content should be sanitized before display

#### Content Security Policy

```typescript
// ../../src/middleware/security-headers.ts
contentSecurityPolicy: "default-src 'self'; script-src 'self'"
```

### Path Traversal Prevention

```typescript
// Validate IDs are alphanumeric only
const idSchema = z.string().regex(/^[a-zA-Z0-9]+$/).length(24);
```

---

## Monitoring & Incident Response

### Security Logging

#### What We Log

✅ **Security Events**:
- Failed authentication attempts
- Permission denied (403) responses
- Rate limit violations (429)
- Suspicious request patterns

✅ **All Requests**:
- HTTP method and path
- Response status and duration
- User ID (if authenticated)
- IP address (from Cloudflare)

❌ **Never Log**:
- Passwords or tokens
- Full request/response bodies
- PII (emails, names)

#### Log Format

```json
{
  "level": "warn",
  "message": "Rate limit exceeded",
  "timestamp": "2024-11-24T12:00:00Z",
  "service": "toiletmap-api",
  "context": {
    "requestId": "uuid",
    "method": "POST",
    "path": "/api/loos",
    "status": 429,
    "ip": "1.2.3.4",
    "userId": "auth0|123456"
  }
}
```

### Alerting

#### Critical Alerts (Immediate Response)

- [ ] Error rate > 10%
- [ ] Database connectivity failure
- [ ] Auth0 service outage
- [ ] Unusual spike in 403/401 responses

#### Warning Alerts (Review Within 24h)

- [ ] Error rate > 5%
- [ ] Rate limit exceeded frequently
- [ ] Slow database queries (> 1s)
- [ ] High memory usage

### Incident Response

#### 1. Detection
- Monitor error rates and logs
- Set up automated alerts
- Regular security reviews

#### 2. Containment
```bash
# Block malicious IP in Cloudflare WAF
# Revoke compromised user access in Auth0
# Rotate exposed secrets
```

#### 3. Investigation
- Review application logs
- Check database audit logs
- Analyze attack patterns

#### 4. Recovery
- Apply security patches
- Restore from backups if needed
- Verify system integrity

#### 5. Post-Mortem
- Document incident timeline
- Identify root cause
- Implement preventive measures
- Update runbooks

---

## Vulnerability Management

### Dependency Scanning

#### Automated Scanning

GitHub Actions runs security checks on every push:

```yaml
# .github/workflows/ci.yml
- name: Run security audit
  run: pnpm audit --audit-level moderate
```

#### Manual Scanning

```bash
# Check for vulnerabilities
pnpm audit

# Update dependencies
pnpm update

# Check for outdated packages
pnpm outdated
```

### Security Updates

#### Critical Updates (< 24 hours)
- Authentication/Authorization bugs
- SQL injection vulnerabilities
- XSS vulnerabilities
- RCE (Remote Code Execution)

#### High Priority (< 1 week)
- Dependency vulnerabilities (CVSS > 7.0)
- DoS vulnerabilities
- Information disclosure

#### Medium Priority (< 1 month)
- Dependency vulnerabilities (CVSS 4.0-7.0)
- Configuration issues

### Responsible Disclosure

If you discover a security vulnerability:

1. **Do NOT** open a public GitHub issue
2. Email security@toiletmap.org with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (optional)
3. Allow 90 days for fix before public disclosure
4. Receive credit in SECURITY.md (optional)

---

## Compliance

### GDPR Compliance

#### User Rights

1. **Right to Access**
   - Users can request their data from Auth0
   - Toilet contributions tracked via audit logs

2. **Right to Deletion**
   ```sql
   -- Remove user from contributors array
   UPDATE toilets
   SET contributors = array_remove(contributors, 'user@example.com');
   ```

3. **Right to Rectification**
   - Users can update their Auth0 profile
   - Data changes logged in audit table

4. **Data Portability**
   - User data exportable via API
   - JSON format for easy import elsewhere

### Data Processing

- **Purpose**: Public toilet mapping service
- **Legal Basis**: Legitimate interest
- **Retention**: Indefinite for public data, user data deleted on request
- **Third Parties**: Auth0 (authentication), Cloudflare (hosting), Supabase (database)

### Cookie Policy

#### Essential Cookies

| Cookie | Purpose | Expiry |
|--------|---------|--------|
| `session` | User authentication | 24 hours |

No tracking or marketing cookies used.

---

## Security Checklist

### Pre-Deployment

- [ ] All environment variables set correctly
- [ ] CORS configured with specific origins (not `*`)
- [ ] Rate limiting enabled
- [ ] Database password rotated from default
- [ ] SSL/TLS certificates valid
- [ ] Security headers configured
- [ ] Error messages sanitized
- [ ] Logging configured (no PII)
- [ ] Dependencies up to date
- [ ] Security audit passed

### Post-Deployment

- [ ] Health checks passing
- [ ] Authentication working
- [ ] CORS tested from allowed origins
- [ ] Rate limiting tested
- [ ] Security headers present
- [ ] Error handling tested
- [ ] Monitoring and alerts configured
- [ ] Backups configured and tested
- [ ] Incident response plan documented
- [ ] Team trained on security procedures

### Monthly Review

- [ ] Review access logs for suspicious activity
- [ ] Check for dependency vulnerabilities
- [ ] Verify backup integrity
- [ ] Review and rotate secrets
- [ ] Update security documentation
- [ ] Test incident response procedures
- [ ] Review rate limit effectiveness
- [ ] Audit user permissions

---

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)
- [Cloudflare Security Best Practices](https://developers.cloudflare.com/workers/examples/security-headers/)
- [Auth0 Security Best Practices](https://auth0.com/docs/secure)
- [PostgreSQL Security](https://www.postgresql.org/docs/current/security.html)

---

**Last Updated**: 2024-11-24
**Version**: 1.0.0
**Security Contact**: security@toiletmap.org
