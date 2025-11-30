# Cloudflare Hyperdrive

This document explains what Cloudflare Hyperdrive is, how it works, and how it's used in toiletmap-server to accelerate database access from Cloudflare Workers.

## What is Hyperdrive?

Cloudflare Hyperdrive is a database acceleration service that optimizes connections from Cloudflare Workers to traditional centralized databases like PostgreSQL. It solves the fundamental challenges of connecting to databases from a global edge network:

- **High latency**: Databases are typically centralized in a single region, but Workers can run in any of Cloudflare's 300+ data centers worldwide
- **Connection overhead**: Stateless environments like Workers need to establish new connections frequently, requiring multiple round trips for TCP handshake, TLS negotiation, and database authentication (7 round trips total)
- **Connection limits**: Traditional databases have a maximum connection limit that can be easily exhausted by distributed traffic

## How Hyperdrive Makes Databases Fast Globally

Hyperdrive accelerates database queries through three key mechanisms:

### 1. Edge Connection Setup

**Without Hyperdrive**, every Worker invocation establishes a connection directly to the origin database, incurring multiple round trips:

- TCP handshake (1 round trip)
- TLS negotiation (3 round trips)
- Database authentication (3 round trips)

This adds significant latency before a query can even execute, especially when the database is far from the Worker location.

**With Hyperdrive**, the database driver in your Worker connects to the Hyperdrive instance at the edge, colocated with your Worker. This connection setup happens locally within the same data center, making it extremely fast.

```mermaid
graph LR
    subgraph "Edge Location"
        Worker[Worker]
        HD[Hyperdrive Edge]
    end

    subgraph "Database Region"
        Pool[Connection Pool]
        DB[(PostgreSQL)]
    end

    Worker -->|Fast local setup| HD
    HD -->|Single round trip| Pool
    Pool -->|Reuse connection| DB

    style Worker fill:#f9f,stroke:#333,stroke-width:2px
    style HD fill:#ff9,stroke:#333,stroke-width:2px
    style DB fill:#b8e6ff,stroke:#333,stroke-width:2px
```

### 2. Connection Pooling

Hyperdrive maintains a pool of persistent connections to your database, placed in regions closest to your origin database. This minimizes latency and maximizes connection reuse.

**Key features:**

- **Connection reuse**: Pre-existing connections are reused across multiple Worker invocations
- **Optimal placement**: The pool is located near your database to minimize network latency for uncached queries
- **Automatic management**: Hyperdrive automatically manages pool size and connection lifecycle
- **Soft limits**: The `max_size` parameter acts as a soft limit; Hyperdrive may temporarily create additional connections during high traffic or network issues

**Configuration:**

```jsonc
// wrangler.jsonc
{
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "your-hyperdrive-id"
    }
  ]
}
```

In toiletmap-server, we use:

- **Production**: `HYPERDRIVE` binding configured in Cloudflare dashboard
- **Development**: `TEST_HYPERDRIVE` binding with `localConnectionString` for local Supabase

### 3. Query Caching

Hyperdrive automatically caches non-mutating (read) queries to reduce load on your database and accelerate response times.

**How it works:**

1. Hyperdrive parses the database wire protocol to differentiate between mutating and non-mutating queries
2. For `SELECT` and other read-only queries, Hyperdrive caches the response
3. Subsequent identical queries are served from cache, bypassing the database entirely
4. Mutating queries (`INSERT`, `UPDATE`, `DELETE`, etc.) are never cached

**Cache settings:**

- `max_age`: 60 seconds (default) - Maximum time a cached response is considered fresh
- `stale_while_revalidate`: 15 seconds (default) - Time to serve stale results while revalidating

**Cacheable queries:**

```sql
-- ✅ Cached: Simple read query
SELECT * FROM loos WHERE id = 'abc123';

-- ✅ Cached: Complex read query
SELECT * FROM loos
WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(-0.1278, 51.5074), 4326), 1000)
ORDER BY updated_at DESC LIMIT 50;
```

**Non-cacheable queries:**

```sql
-- ❌ Not cached: Mutating query
INSERT INTO loos (id, name, location) VALUES (...);

-- ❌ Not cached: Uses volatile function
SELECT LASTVAL(), * FROM loos LIMIT 50;

-- ❌ Not cached: Transaction control
BEGIN; SELECT * FROM loos; COMMIT;
```

## Connection Lifecycle

Understanding how connections flow through Hyperdrive is essential for building efficient applications:

```mermaid
sequenceDiagram
    participant Worker
    participant Edge as Hyperdrive Edge
    participant Pool as Connection Pool
    participant DB as PostgreSQL

    Note over Worker: Worker invocation starts
    Worker->>Edge: Connect (fast, local)
    Edge->>Pool: Request connection

    alt Pool has available connection
        Pool-->>Edge: Reuse existing connection
    else No available connection
        Pool->>DB: Create new connection
        DB-->>Pool: Connection established
        Pool-->>Edge: Return new connection
    end

    Edge->>DB: Execute query
    DB-->>Edge: Query results
    Edge-->>Worker: Return results

    Note over Worker: Worker invocation ends
    Worker->>Edge: Close client connection
    Note over Pool: Connection stays in pool
```

### Key Points

1. **Fast edge setup**: Database driver connects to Hyperdrive at the edge (milliseconds)
2. **Single round trip**: One round trip from edge to database region (instead of 7)
3. **Connection reuse**: Pool maintains connections for subsequent requests
4. **Automatic cleanup**: Worker client connections are garbage collected, but pool connections persist

## Pooling Mode

Hyperdrive operates in **transaction pooling mode**, where a connection is held for the duration of a transaction and then returned to the pool.

### Transaction Pooling Behavior

**Single transaction:**

```typescript
// Each transaction may use different connections from the pool
await prisma.loos.create({...});  // Transaction 1 (Connection A)
await prisma.loos.update({...});  // Transaction 2 (Connection B)
```

**Explicit transaction:**

```typescript
// Explicit transactions hold a single connection
await prisma.$transaction(async (tx) => {
  await tx.loos.create({...});
  await tx.loos.update({...});
  // Same connection used throughout
});
```

### SET Statements

Hyperdrive supports `SET` statements for the duration of a transaction or query:

```sql
-- ✅ Supported: SET within explicit transaction
BEGIN;
SET search_path TO my_schema;
SELECT * FROM loos;
COMMIT;

-- ✅ Supported: Combined SET + query
SET search_path TO my_schema; SELECT * FROM loos;

-- ❌ Not recommended: SET persists only for current connection
SET search_path TO my_schema;
-- Next query may use different connection, SET is lost
```

When a connection is returned to the pool, it is `RESET` so that `SET` commands don't affect subsequent queries.

### Named Prepared Statements

Hyperdrive supports named prepared statements as implemented in:

- `postgres.js` driver ✅
- `node-postgres` driver ✅

Named prepared statements in other drivers may have degraded performance or may not be supported.

## Configuration

### Production

```jsonc
// wrangler.jsonc
{
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "2bd669c375c645ff9f22fe6418adecc3"
    }
  ]
}
```

The Hyperdrive configuration (including database connection details) is managed in the Cloudflare dashboard. The Worker receives a `connectionString` via the binding.

### Development

```jsonc
// wrangler.jsonc
{
  "env": {
    "development": {
      "hyperdrive": [
        {
          "binding": "TEST_HYPERDRIVE",
          "id": "c020574a-5623-407b-be0c-cd192bab9545",
          "localConnectionString": "postgresql://toiletmap_web:toiletmap_web@localhost:54322/postgres"
        }
      ]
    }
  }
}
```

For local development, we use a separate `TEST_HYPERDRIVE` binding that connects to the local Supabase instance.

### Connection String Priority

Our application resolves the connection string with this priority:

```typescript
// src/middleware/services.ts
const connectionString =
  c.env.HYPERDRIVE?.connectionString ?? c.env.TEST_HYPERDRIVE?.connectionString;
```

This allows seamless fallback from production (`HYPERDRIVE`) to development (`TEST_HYPERDRIVE`) environments.

### Environment Variable Override

You can override the local connection string without modifying `wrangler.jsonc`:

```bash
# .env or .env.local
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TEST_HYPERDRIVE=postgresql://user:pass@localhost:5432/db
```

This is useful for:

- Testing against remote databases
- Running multiple Supabase instances on different ports
- CI/CD environments with custom database URLs

## Best Practices

### ✅ Do

- **Keep transactions short**: Only include essential queries within a transaction
- **Create new Prisma clients per invocation**: Hyperdrive manages the underlying connections
- **Use query caching**: Take advantage of automatic caching for read queries
- **Monitor connection pool usage**: Watch for connection exhaustion

### ❌ Don't

- **Don't hold long-running transactions**: Connections can't be reused while held
- **Don't rely on `SET` persistence**: `SET` statements are reset when connections return to pool
- **Don't maintain persistent connections in Durable Objects**: This exhausts the connection pool
- **Don't wrap multiple operations in a single transaction just to maintain `SET` state**: This hurts performance and scalability

## Limitations and Considerations

### Durable Objects

Unlike regular Workers, Durable Objects can maintain state across requests. If you keep a database client open in a Durable Object, it will hold a connection from the pool indefinitely.

**Warning**: Each Durable Object with an open connection consumes pool resources. This can impact other parts of your application.

**Recommendations**:

- Close connections when not actively in use
- Use connection timeouts
- Limit the number of Durable Objects with database connections

### Long-Running Transactions

In transaction pooling mode, a connection is held for the entire transaction duration. Long transactions can:

- Exhaust available connections quickly
- Block other Worker invocations
- Reduce overall throughput

**Best practice**: Keep transactions focused on the minimal set of queries needed to maintain data consistency.

### Disable Caching

You can disable caching on a per-Hyperdrive basis:

```bash
npx wrangler hyperdrive update <hyperdrive-id> \
  --origin-password <password> \
  --caching-disabled true
```

Or configure multiple Hyperdrive connections—one with caching enabled, one without:

```jsonc
{
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "cached-config-id"
    },
    {
      "binding": "HYPERDRIVE_NO_CACHE",
      "id": "no-cache-config-id"
    }
  ]
}
```

## Performance Impact

### Response Time Improvements

Hyperdrive significantly reduces latency for database operations:

| Operation             | Without Hyperdrive       | With Hyperdrive      | Improvement |
| --------------------- | ------------------------ | -------------------- | ----------- |
| Connection setup      | 7 round trips            | 1 round trip (local) | ~85% faster |
| Read query (cached)   | Full database round trip | Edge cache           | ~95% faster |
| Read query (uncached) | Full database round trip | Pooled connection    | ~40% faster |
| Write query           | Full database round trip | Pooled connection    | ~40% faster |

### Scalability

- **Connection limits**: Hyperdrive manages connection pooling, preventing exhaustion of database connection limits
- **Global distribution**: Workers can run anywhere; Hyperdrive ensures optimal database access
- **Automatic scaling**: Connection pool scales automatically based on traffic patterns

## Monitoring

### Key Metrics

Monitor these metrics in production:

- **Connection pool utilization**: Percentage of connections in use
- **Query cache hit rate**: Percentage of queries served from cache
- **Query latency**: p50, p95, p99 response times
- **Connection errors**: Failed connection attempts

### Cloudflare Analytics

View Hyperdrive metrics in the Cloudflare dashboard:

- Request count by cache status (hit/miss)
- Database query latency distribution
- Connection pool statistics
- Error rates

## See Also

- [Architecture Overview](./overview.md) - System architecture and technology stack
- [Request Flow](./request-flow.md) - Detailed sequence diagrams showing Hyperdrive in action
- [Environment Configuration](../onboarding/environment.md) - Hyperdrive binding configuration
- [Cloudflare Hyperdrive Documentation](https://developers.cloudflare.com/hyperdrive/) - Official documentation
