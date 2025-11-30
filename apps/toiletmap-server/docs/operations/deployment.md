# Production Deployment

This guide covers deploying toiletmap-server to Cloudflare Workers in production.

## Quick Deploy

```bash
pnpm deploy
```

Cloudflare Workers handle zero-downtime deployments automatically. New versions deploy alongside the old version, traffic gradually shifts, and in-flight requests complete on the old version.

## Pre-Deployment Checklist

### Environment Configuration

- [ ] Set `ENVIRONMENT=production` in Cloudflare Workers environment variables
- [ ] Configure `ALLOWED_ORIGINS` with production domains (comma-separated):
  ```bash
  ALLOWED_ORIGINS=https://www.toiletmap.org,https://toiletmap.org
  ```
- [ ] Verify all Auth0 environment variables:
  - `AUTH0_ISSUER_BASE_URL`
  - `AUTH0_AUDIENCE`
  - `AUTH0_CLIENT_ID`
  - `AUTH0_CLIENT_SECRET`
  - `AUTH0_REDIRECT_URI` (fallback; runtime uses the current request origin)
  - `AUTH0_SCOPE`

### Database Configuration

- [ ] Configure `HYPERDRIVE` binding in Cloudflare dashboard
- [ ] Test database connectivity via Hyperdrive
- [ ] Database migrations are automatically deployed via GitHub Actions (see [Database Migration Deployment](#database-migration-deployment) below)
- [ ] Verify database backup schedule is configured
- [ ] Confirm connection pooling is properly configured

See [Hyperdrive architecture docs](../architecture/hyperdrive.md) for details on connection pooling and query caching.

### Security

- [ ] Rotate database password from default development password
- [ ] Verify CORS origins are properly whitelisted (not using `*`)
- [ ] Confirm rate limiting is enabled
- [ ] Verify SSL/TLS certificates are valid
- [ ] Configure Auth0 production tenant with MFA enabled

### Code Quality

- [ ] All tests pass: `pnpm test:e2e`
- [ ] TypeScript compilation succeeds: `pnpm typecheck`
- [ ] Prisma schema is valid: `pnpm prisma validate`
- [ ] Client build succeeds: `pnpm build:client`
- [ ] Wrangler dry-run succeeds: `pnpm wrangler deploy --dry-run`

### CI/CD (if using GitHub Actions)

- [ ] GitHub Actions workflows configured
- [ ] Cloudflare API tokens set in GitHub Secrets:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- [ ] Supabase secrets configured in GitHub Secrets:
  - `SUPABASE_ACCESS_TOKEN`
  - `SUPABASE_STAGE_DB_PASSWORD`
  - `SUPABASE_PRODUCTION_DB_PASSWORD`
- [ ] Deployment workflow tested in staging
- [ ] Database migration workflows tested (see [Database Migration Deployment](#database-migration-deployment))

## Deployment Options

### Option 1: Automated Deployment (Recommended)

#### Via GitHub Actions

1. **Merge to main branch**:
   ```bash
   git checkout main
   git merge your-feature-branch
   git push origin main
   ```

2. **Monitor deployment**:
   - Visit GitHub Actions tab
   - Watch "Deploy to Production" workflow
   - Verify all steps complete successfully

3. **Manual trigger** (if needed):
   - Go to Actions > Deploy to Production
   - Click "Run workflow"
   - Select "production" environment
   - Click "Run workflow"

### Option 2: Manual Deployment

1. **Build the application**:
   ```bash
   # Install dependencies
   pnpm install --frozen-lockfile

   # Generate Prisma client
   pnpm prisma:generate

   # Build client assets
   pnpm build:client
   ```

2. **Deploy to Cloudflare**:
   ```bash
   # Deploy to production
   pnpm wrangler deploy --env production
   ```

3. **Verify deployment**:
   ```bash
   curl https://your-worker.workers.dev/health/ready
   ```

## Database Migration Deployment

Database migrations are automatically deployed to Supabase environments via GitHub Actions:

### Staging Environment

Migrations are automatically deployed to the staging database when code is pushed to the `postgres-staging` branch:

1. **Workflow**: [`.github/workflows/supabase-migrations-stage.yml`](../../.github/workflows/supabase-migrations-stage.yml)
2. **Trigger**: Push to `postgres-staging` branch or manual workflow dispatch
3. **Target**: Staging Supabase project
4. **Process**:
   - Checks out repository
   - Installs Supabase CLI
   - Links to staging project
   - Runs `supabase db push` to apply migrations

### Production Environment

Migrations are automatically deployed to the production database when code is merged to `main`:

1. **Workflow**: [`.github/workflows/supabase-migrations-prod.yml`](../../.github/workflows/supabase-migrations-prod.yml)
2. **Trigger**: Push to `main` branch or manual workflow dispatch
3. **Target**: Production Supabase project
4. **Process**:
   - Checks out repository
   - Installs Supabase CLI
   - Links to production project
   - Runs `supabase db push` to apply migrations

### Required GitHub Secrets

The migration workflows require the following secrets to be configured in GitHub repository settings:

- `SUPABASE_ACCESS_TOKEN` - Personal access token for Supabase CLI authentication
- `SUPABASE_STAGE_DB_PASSWORD` - Database password for staging environment
- `SUPABASE_PRODUCTION_DB_PASSWORD` - Database password for production environment

### Manual Migration Trigger

If you need to manually trigger a migration deployment:

1. Go to GitHub Actions tab in your repository
2. Select the appropriate workflow:
   - "Deploy Staging Supabase Migrations" for staging
   - "Deploy Production Supabase Migrations" for production
3. Click "Run workflow"
4. Select the branch containing your migrations
5. Click "Run workflow" button

### Monitoring Migration Deployments

After pushing to `postgres-staging` or `main`:

1. Navigate to the GitHub Actions tab
2. Find the running workflow (e.g., "Deploy Production Supabase Migrations")
3. Click on the workflow run to see detailed logs
4. Verify that `supabase db push` completed successfully

## Post-Deployment Verification

### Health Checks

1. **Liveness check**:
   ```bash
   curl https://your-worker.workers.dev/health/live
   # Expected: {"status":"ok", ...}
   ```

2. **Readiness check**:
   ```bash
   curl https://your-worker.workers.dev/health/ready
   # Expected: {"status":"ok", "checks": [...]}
   ```

   Verify:
   - Database check shows `"status": "ok"`
   - Response time < 500ms

### Functional Testing

1. **Test public API**:
   ```bash
   # Search for toilets
   curl "https://your-worker.workers.dev/api/loos/search?limit=10"

   # Get toilet by proximity
   curl "https://your-worker.workers.dev/api/loos/proximity?lat=51.5074&lng=-0.1278&radius=1000"
   ```

2. **Test authentication**:
   ```bash
   # Should require authentication
   curl -X POST "https://your-worker.workers.dev/api/loos" \
     -H "Content-Type: application/json" \
     -d '{"name":"Test Toilet"}'
   # Expected: 401 Unauthorized
   ```

3. **Test admin interface**:
   - Visit `https://your-worker.workers.dev/admin`
   - Log in with admin credentials
   - Verify dashboard loads correctly

### Security Verification

1. **Test CORS**:
   ```bash
   curl -H "Origin: https://evil.com" \
     -H "Access-Control-Request-Method: POST" \
     -X OPTIONS \
     https://your-worker.workers.dev/api/loos
   # Expected: No Access-Control-Allow-Origin header (blocked)
   ```

2. **Test rate limiting**:
   ```bash
   # Test read rate limit (100 req/min)
   for i in {1..110}; do
     curl -s https://your-worker.workers.dev/api/areas > /dev/null
   done
   curl -v https://your-worker.workers.dev/api/areas
   # Expected: HTTP 429 after 100 requests
   ```

3. **Test security headers**:
   ```bash
   curl -I https://your-worker.workers.dev/
   # Verify headers include:
   # - X-Frame-Options: DENY
   # - X-Content-Type-Options: nosniff
   # - Content-Security-Policy: ...
   ```

## Environment Variables

Required in Cloudflare Workers dashboard. The worker derives the Auth0 redirect URI from the request origin at runtime (covering preview + alias URLs), so keep the fallback variable below primarily for Auth0’s allow-list.

```bash
ENVIRONMENT=production
ALLOWED_ORIGINS=https://www.toiletmap.org.uk,https://admin.toiletmap.org.uk
AUTH0_ISSUER_BASE_URL=https://your-tenant.auth0.com/
AUTH0_AUDIENCE=https://www.toiletmap.org.uk/api
AUTH0_CLIENT_ID=production_client_id
AUTH0_CLIENT_SECRET=production_client_secret
# Optional fallback; runtime detects the origin
# AUTH0_REDIRECT_URI=https://www.toiletmap.org.uk/admin/callback
AUTH0_SCOPE=openid profile email offline_access roles access:admin
AUTH0_PROFILE_KEY=name
```

## Cloudflare Hyperdrive Configuration

### What is Hyperdrive?

Hyperdrive accelerates database queries by providing:
- **Edge connection setup**: Reduces 7 round trips to 1
- **Connection pooling**: Maintains pooled connections near your database
- **Query caching**: Automatically caches read queries (60s default TTL)

### Configure Production Hyperdrive

1. **Create Hyperdrive configuration** in Cloudflare dashboard:
   - Navigate to Workers & Pages > Hyperdrive
   - Click "Create a Hyperdrive"
   - Enter PostgreSQL connection details:
     - Host: `your-database-host.com`
     - Port: `5432`
     - Database: `postgres`
     - Username: `toiletmap_web`
     - Password: `<your-strong-password>`
   - Note the Hyperdrive ID

2. **Update wrangler.toml**:
   ```toml
   [[hyperdrive]]
   binding = "HYPERDRIVE"
   id = "your-hyperdrive-id-here"
   ```

3. **Connection pooling**:
   - Hyperdrive manages pool size automatically (starts at 5, scales based on traffic)
   - Pool placed near origin database for optimal performance
   - No manual configuration needed

See [Hyperdrive documentation](../architecture/hyperdrive.md) for comprehensive details.

## Rollback Procedures

### Quick Rollback

If deployment causes issues:

```bash
# View recent deployments
pnpm wrangler deployments list

# Rollback to previous version
pnpm wrangler rollback

# Verify rollback
curl https://your-worker.workers.dev/health/ready
```

**Rollback time**: < 2 minutes

### Rollback Considerations

- **Database migrations**: May need to be reverted separately
- **Configuration changes**: May persist after rollback
- **Data changes**: Not affected by code rollback

### Database Migration Rollback

If a database migration needs to be rolled back:

1. **Create rollback migration**:
   ```bash
   # Create a new migration that reverses the problematic changes
   pnpm supabase migration new rollback_previous_migration
   ```

   ```sql
   -- supabase/migrations/YYYYMMDD_HHMMSS_rollback_previous_migration.sql
   -- Reverse the changes from previous migration
   DROP TABLE IF EXISTS new_table;
   ALTER TABLE old_table ADD COLUMN removed_column TEXT;
   ```

2. **Apply rollback via GitHub Actions**:
   - **For staging**: Push/merge the rollback migration to `postgres-staging` branch
   - **For production**: Push/merge the rollback migration to `main` branch
   - The GitHub Actions workflow will automatically deploy the rollback migration

3. **Manual rollback** (if immediate action needed):
   ```bash
   # Connect to the database directly
   supabase link --project-ref <project-id>

   # Push the rollback migration manually
   supabase db push
   ```

### Post-Rollback Actions

- [ ] Verify health checks pass
- [ ] Test critical API endpoints
- [ ] Check error rates in logs
- [ ] Notify team of rollback
- [ ] Create incident report
- [ ] Fix issues in feature branch
- [ ] Re-test before next deployment

## Troubleshooting

### Health check returns 503

**Symptoms**:
```json
{
  "status": "degraded",
  "checks": [
    {"name": "database", "status": "error", "message": "Connection failed"}
  ]
}
```

**Solutions**:
1. Check database is running
2. Verify Hyperdrive configuration in Cloudflare dashboard
3. Check firewall rules allow Cloudflare Workers
4. Verify database user has permissions

### CORS errors in browser

**Symptoms**:
```
Access to fetch at 'https://worker.dev/api/loos' from origin
'https://yoursite.com' has been blocked by CORS policy
```

**Solutions**:
1. Add origin to `ALLOWED_ORIGINS` environment variable:
   ```bash
   wrangler secret put ALLOWED_ORIGINS
   # Enter: https://yoursite.com,https://www.yoursite.com
   ```
2. Redeploy worker
3. Clear browser cache

### Authentication failures

**Symptoms**:
- Users can't log in
- JWT validation fails
- "Invalid token" errors

**Solutions**:
1. Verify Auth0 configuration:
   - Check `AUTH0_ISSUER_BASE_URL`
   - Verify `AUTH0_AUDIENCE`
   - Confirm `AUTH0_CLIENT_ID` and `AUTH0_CLIENT_SECRET`
2. Check Auth0 status: https://status.auth0.com/
3. Review Auth0 logs for specific errors
4. Verify clock sync (JWT validation is time-sensitive)

## See Also

- [Monitoring Guide](./monitoring.md) - Logs, metrics, and alerts
- [Rate Limiting](./rate-limiting.md) - Rate limiting configuration
- [Hyperdrive](../architecture/hyperdrive.md) - Database acceleration
- [Authentication](../authentication/overview.md) - Auth0 setup
