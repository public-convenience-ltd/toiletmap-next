# Monitoring and Observability

This guide covers monitoring toiletmap-server in production using Cloudflare Workers analytics, logs, and custom metrics.

## Overview

The application provides comprehensive observability through:
- **Cloudflare Workers Analytics**: Request metrics, error rates, performance
- **Structured Logging**: JSON logs with contextual metadata
- **Health Checks**: Liveness and readiness endpoints
- **Hyperdrive Metrics**: Database connection and query performance

## Cloudflare Workers Logs

### Accessing Logs

View logs in Cloudflare Dashboard:

1. Navigate to **Workers & Pages** > **toiletmap-server** > **Logs**
2. Use the real-time log stream or historical logs
3. Filter by severity level, time range, or search term

### Log Filtering

Use Cloudflare's filter syntax:

```
# Filter by level
level:error

# Filter by status code
status:500

# Filter by path
path:/api/loos

# Combine filters
level:error AND status:500

# Search in message
message:"Database connection failed"

# Time range
timestamp > "2024-01-01T00:00:00Z"
```

### Structured Log Format

All logs use JSON format with consistent structure:

```json
{
  "level": "error",
  "message": "Database query failed",
  "timestamp": "2024-11-24T12:00:00.000Z",
  "service": "toiletmap-api",
  "context": {
    "requestId": "123e4567-e89b-12d3-a456-426614174000",
    "method": "GET",
    "path": "/api/loos/search",
    "userId": "auth0|123456",
    "error": {
      "name": "PrismaClientKnownRequestError",
      "message": "Connection timeout",
      "stack": "..."
    }
  }
}
```

**Important**: Error details including stack traces are logged server-side for debugging but are NEVER exposed to clients in production/preview environments. Client-facing error responses are sanitized to prevent information leakage.

**Log Levels**:
- `error`: Errors requiring immediate attention
- `warn`: Warning conditions
- `info`: Informational messages
- `debug`: Detailed debugging information (disabled in production)

## Key Metrics

### Request Metrics

Monitor these metrics in Cloudflare Workers Analytics:

| Metric | Healthy Range | Alert Threshold | Action |
|--------|---------------|-----------------|--------|
| **Error Rate** | < 1% | > 5% | Investigate logs, check database |
| **Response Time (P95)** | < 500ms | > 1000ms | Check database performance, Hyperdrive metrics |
| **Request Rate** | Variable | 10x normal | Possible DDoS attack, review WAF |
| **Success Rate** | > 99% | < 95% | Check health endpoints, database |

### Hyperdrive Metrics

Monitor database acceleration in **Cloudflare Dashboard** > **Workers & Pages** > **Hyperdrive** > **Analytics**:

| Metric | Description | Healthy Range |
|--------|-------------|---------------|
| **Query Cache Hit Rate** | % of queries served from cache | > 50% for read-heavy workloads |
| **Connection Pool Utilization** | Active vs. available connections | < 80% |
| **Query Latency (P95)** | Database query response time | < 200ms |
| **Edge Connection Time** | Time to establish connection | < 10ms |

**Low cache hit rate?**
- Increase cache TTL (default 60s)
- Review query patterns for cacheable operations
- Check if queries use volatile functions (e.g., `NOW()`)

**High pool utilization?**
- Hyperdrive scales automatically, but review query patterns
- Check for long-running transactions
- Investigate slow queries

See [Hyperdrive documentation](../architecture/hyperdrive.md) for detailed metrics explanation.

### Performance Breakdown

Typical response times by endpoint:

| Endpoint Type | p50 | p95 | p99 |
|---------------|-----|-----|-----|
| Simple read (GET /api/loos/:id) | 15ms | 35ms | 80ms |
| Proximity search | 45ms | 120ms | 250ms |
| Full-text search | 80ms | 200ms | 400ms |
| Write operation | 60ms | 150ms | 300ms |
| Admin page render | 100ms | 250ms | 500ms |

## Health Checks

### Liveness Endpoint

**Endpoint**: `GET /health/live`

Checks if the worker is running and responsive.

```bash
curl https://your-worker.workers.dev/health/live
```

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2024-11-24T12:00:00.000Z"
}
```

**Use for**: Kubernetes liveness probes, uptime monitoring

### Readiness Endpoint

**Endpoint**: `GET /health/ready`

Checks if the worker can serve traffic (database connectivity, dependencies).

```bash
curl https://your-worker.workers.dev/health/ready
```

**Response** (healthy):
```json
{
  "status": "ok",
  "checks": [
    {
      "name": "database",
      "status": "ok",
      "responseTime": 45
    }
  ],
  "timestamp": "2024-11-24T12:00:00.000Z"
}
```

**Response** (degraded):
```json
{
  "status": "degraded",
  "checks": [
    {
      "name": "database",
      "status": "error",
      "message": "database check failed",
      "responseTime": 5000
    }
  ],
  "timestamp": "2024-11-24T12:00:00.000Z"
}
```

**Note**: Error messages in health checks are sanitized in production/preview environments. The generic message "database check failed" is returned instead of specific error details to prevent information leakage. Full error details are logged server-side in Cloudflare Workers logs.

**Use for**: Load balancer health checks, readiness probes

### Error Message Sanitization

Health check endpoints follow environment-specific error handling:

| Environment | Error Message Behavior | Example Message |
|-------------|----------------------|-----------------|
| **Production** | Generic, sanitized | `"database check failed"` |
| **Preview** | Generic, sanitized | `"database check failed"` |
| **Development** | Detailed for debugging | `"Invalid \`prisma.$queryRaw()\` invocation: Server connection attempt failed: e=Wrong password"` |

**Security Note**: In production and preview environments, error messages never expose:
- Database credentials or passwords
- Connection strings or internal URLs
- Stack traces
- Implementation details (e.g., Prisma errors, driver names)

**Debugging**: To investigate health check failures in production:
1. Check Cloudflare Workers logs for full error details
2. Review Hyperdrive metrics for database connectivity issues
3. Verify database status with your database provider

## Setting Up Alerts

### Cloudflare Notifications

Configure alerts in **Cloudflare Dashboard** > **Notifications**:

1. **Error Rate Alert**:
   - Type: Worker error rate
   - Threshold: > 5% errors over 5 minutes
   - Delivery: Email, Webhook, PagerDuty

2. **Request Spike Alert**:
   - Type: Worker requests
   - Threshold: > 1000 req/min (adjust for your traffic)
   - Delivery: Email, Slack

3. **Health Check Failure**:
   - Type: Health check monitoring
   - Endpoint: `/health/ready`
   - Frequency: Every 1 minute
   - Threshold: 3 consecutive failures
   - Delivery: Email, PagerDuty

### Recommended Alert Configuration

```yaml
# Example webhook payload for alerts
{
  "alert_type": "worker_error_rate",
  "threshold": "5%",
  "current_value": "7.2%",
  "worker_name": "toiletmap-server",
  "timestamp": "2024-11-24T12:00:00Z",
  "dashboard_url": "https://dash.cloudflare.com/..."
}
```

## Common Monitoring Scenarios

### Investigating High Error Rate

1. **Check Cloudflare logs**:
   ```
   level:error AND timestamp > "2024-01-01T00:00:00Z"
   ```

2. **Filter by status code**:
   ```
   status:500
   ```

3. **Look for patterns**:
   - Same error message repeated?
   - Specific endpoint failing?
   - Database connection errors?

4. **Review health checks**:
   ```bash
   curl https://your-worker.workers.dev/health/ready
   ```

5. **Check Hyperdrive metrics**:
   - High connection pool utilization?
   - Low cache hit rate?
   - Slow query latency?

### Investigating Slow Response Times

1. **Check Hyperdrive query latency**:
   - Navigate to Hyperdrive Analytics
   - Review P95/P99 query times
   - Identify slow queries

2. **Review database performance**:
   ```sql
   -- Connect to database
   SELECT query, mean_exec_time, calls
   FROM pg_stat_statements
   ORDER BY mean_exec_time DESC
   LIMIT 10;
   ```

3. **Check for missing indexes**:
   ```sql
   SELECT schemaname, tablename, indexname
   FROM pg_indexes
   WHERE schemaname = 'public';
   ```

4. **Review Hyperdrive cache hit rate**:
   - Low cache hit rate means more database queries
   - Consider increasing cache TTL if appropriate

### Investigating Failed Deployments

1. **Check deployment logs**:
   ```bash
   pnpm wrangler deployments list
   ```

2. **Review last deployment**:
   - Check Cloudflare dashboard for deployment errors
   - Review GitHub Actions logs if using CI/CD

3. **Test health checks**:
   ```bash
   curl https://your-worker.workers.dev/health/ready
   ```

4. **Rollback if needed**:
   ```bash
   pnpm wrangler rollback
   ```

## Log Querying Examples

### Find All Database Errors

```
level:error AND message:"Database" OR message:"Prisma"
```

### Track Specific User Activity

```
context.userId:"auth0|123456"
```

### Monitor Rate Limiting

```
status:429
```

### Track Authentication Failures

```
status:401 OR status:403
```

### Monitor Slow Requests

```
context.duration > 1000
```

## Dashboard Recommendations

### Custom Cloudflare Dashboard

Create a custom dashboard with:

1. **Request Overview**:
   - Total requests (last 24h)
   - Success rate
   - Error rate
   - P95 response time

2. **Database Performance**:
   - Hyperdrive query latency
   - Cache hit rate
   - Connection pool utilization

3. **Security Metrics**:
   - Rate limit hits (429 errors)
   - Authentication failures (401/403)
   - CORS errors

4. **Health Status**:
   - Health check status
   - Database connectivity
   - Recent deployments

### Third-Party Monitoring (Optional)

Consider integrating with:

- **Sentry**: Error tracking and performance monitoring
- **Datadog**: Comprehensive observability platform
- **New Relic**: APM and infrastructure monitoring
- **Grafana**: Custom dashboards with metrics

## Incident Response Checklist

When an alert fires:

1. [ ] Check Cloudflare Workers dashboard for error rate
2. [ ] Review recent logs for error patterns
3. [ ] Test health check endpoints
4. [ ] Check Hyperdrive metrics for database issues
5. [ ] Verify no recent deployments or configuration changes
6. [ ] Check Auth0 status (if auth errors)
7. [ ] Review database status (if database errors)
8. [ ] Escalate to on-call if needed
9. [ ] Document incident in runbook
10. [ ] Create post-mortem if major incident

## Runbook: Common Issues

### Database Connection Failures

**Symptoms**: Health check failing, 503 errors, "Connection refused" in logs

**Actions**:
1. Check Hyperdrive configuration in Cloudflare dashboard
2. Verify database is running (check database provider status)
3. Check firewall rules allow Cloudflare IP ranges
4. Review database connection string in Hyperdrive config
5. Check database user permissions

### High CPU Usage

**Symptoms**: Slow response times, high CPU time in Worker analytics

**Actions**:
1. Review slow queries in database
2. Check for inefficient PostGIS operations
3. Review Prisma query patterns
4. Consider adding database indexes
5. Check for infinite loops or excessive computation

### Memory Issues

**Symptoms**: Workers crashing, "Out of memory" errors

**Actions**:
1. Review payload sizes (large JSON responses)
2. Check for memory leaks in code
3. Optimize Prisma queries (select only needed fields)
4. Paginate large result sets
5. Review image uploads (if applicable)

### Rate Limiting Issues

**Symptoms**: Legitimate users getting 429 errors

**Actions**:
1. Check if traffic spike is legitimate
2. Review rate limit configuration in wrangler.toml
3. Consider increasing limits temporarily
4. Implement request caching on client side
5. Check for bot traffic or attacks

## See Also

- [Deployment Guide](./deployment.md) - Production deployment procedures
- [Rate Limiting](./rate-limiting.md) - Rate limiting configuration
- [Hyperdrive](../architecture/hyperdrive.md) - Database performance monitoring
- [Architecture Overview](../architecture/overview.md) - System architecture
