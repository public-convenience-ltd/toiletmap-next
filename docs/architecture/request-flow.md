# Request Flow

This document provides detailed sequence diagrams for common request patterns in toiletmap-server.

## Public API Read Request

Flow for unauthenticated public API requests (e.g., `GET /api/loos/proximity`):

```mermaid
sequenceDiagram
    participant Client
    participant CF as Cloudflare Edge
    participant Worker
    participant RateLimit as Rate Limiter
    participant Validator
    participant Service as LooService
    participant Prisma
    participant HD as Hyperdrive
    participant DB as PostgreSQL

    Client->>CF: GET /api/loos/proximity?lat=51.5&lng=-0.1&radius=1000
    CF->>Worker: Route to nearest edge
    Worker->>RateLimit: Check rate limit
    alt Rate limit exceeded
        RateLimit-->>Client: 429 Too Many Requests
    else Within limit
        RateLimit->>Validator: Validate query params
        alt Validation failed
            Validator-->>Client: 400 Bad Request
        else Valid
            Validator->>Service: getByProximity(lat, lng, radius)
            Service->>Prisma: Build query
            Prisma->>HD: Execute via connectionString
            HD->>HD: Check query cache
            alt Cache hit
                HD-->>Prisma: Return cached results
            else Cache miss
                HD->>DB: SELECT * FROM loos WHERE ST_DWithin(...)
                DB-->>HD: Return rows
                HD->>HD: Cache response (60s TTL)
                HD-->>Prisma: Return results
            end
            Prisma-->>Service: Raw result rows
            Service-->>Worker: Transform to DTOs
            Worker-->>CF: 200 OK with JSON
            CF-->>Client: Response
        end
    end
```

## Authenticated Write Request

Flow for authenticated write requests (e.g., `POST /api/loos`):

```mermaid
sequenceDiagram
    participant Client
    participant CF as Cloudflare Edge
    participant Worker
    participant Auth as Auth Middleware
    participant RateLimit as Rate Limiter
    participant Validator
    participant Service as LooService
    participant Prisma
    participant HD as Hyperdrive
    participant DB as PostgreSQL

    Client->>CF: POST /api/loos<br/>Authorization: Bearer {JWT}
    CF->>Worker: Route request
    Worker->>Auth: Extract User (optionalAuth)
    Auth->>Auth: Verify JWT signature (if present)
    Worker->>RateLimit: Check write rate limit (user-based)
    alt Rate limit exceeded
        RateLimit-->>Client: 429 Too Many Requests
    else Within limit
        Worker->>Auth: Enforce Auth (requireAuth)
        alt Not Authenticated
            Auth-->>Client: 401 Unauthorized
        else Authenticated
            Worker->>Validator: Validate request body
            alt Validation failed
                Validator-->>Client: 400 Bad Request
            else Valid
                Validator->>Service: create(data, contributor)
                Service->>Service: Generate loo ID
                Service->>Prisma: INSERT INTO loos (...)
                Prisma->>HD: Execute via connectionString
                Note over HD: Writes are never cached
                HD->>DB: INSERT INTO loos (...)
                DB-->>HD: Return created row
                HD-->>Prisma: Return created row
                Prisma-->>Service: Return created row
                Service-->>Worker: Return loo DTO
                Worker-->>Client: 201 Created
            end
        end
    end
```

## Authentication Flow

OAuth2 authorization code flow for admin login:

```mermaid
sequenceDiagram
    participant User
    participant Browser
    participant Worker as toiletmap-server
    participant Auth0

    User->>Browser: Visit /admin
    Browser->>Worker: GET /admin
    Worker-->>Browser: 302 Redirect to /admin/login
    Browser->>Worker: GET /admin/login
    Worker-->>Browser: Render login page with Auth0 button

    User->>Browser: Click "Login with Auth0"
    Browser->>Auth0: GET /authorize?client_id=...&redirect_uri=...
    Auth0-->>Browser: Show Auth0 Universal Login
    User->>Auth0: Enter credentials
    Auth0-->>Browser: 302 Redirect to /auth/callback?code=...

    Browser->>Worker: GET /auth/callback?code=...
    Worker->>Auth0: POST /oauth/token<br/>{code, client_id, client_secret}
    Auth0-->>Worker: {access_token, id_token}
    Worker->>Worker: Set session cookie
    Worker-->>Browser: 302 Redirect to /admin
    Browser->>Worker: GET /admin<br/>Cookie: session=...
    Worker->>Worker: Verify session JWT
    Worker-->>Browser: 200 OK (admin dashboard)
```

### OAuth Hardening (state + nonce)

Standard OAuth2 flows allow users to log in, but without extra protections, they are vulnerable to specific types of interception attacks. To secure the `/admin` login, we implement the **State** and **Nonce** patterns.

Think of this system like a **Coat Check** at a venue:

1.  **State:** You get a unique ticket. If you lose it, you can't get your coat back (and no one else can claim it).
2.  **Nonce:** The ticket is stamped with today's date. Someone cannot use a ticket they stole from you last week.

We implement these checks using short-lived, secure cookies.

#### 1. The `state` Parameter (Stopping CSRF)

- **The Threat (CSRF):** A **Cross-Site Request Forgery** attack happens when a malicious website tricks a user's browser into sending a request to our server. In an OAuth context, an attacker could trick a user into logging into the _attacker's_ account, allowing the attacker to track the user's activity.
- **The Defense:**
  1.  When the user starts a login, we generate a random string (the `state`).
  2.  We save this in a secure, HTTP-only cookie (`auth_state`).
  3.  We send the same string to Auth0.
  4.  When Auth0 redirects the user back to us, they must bring that `state` back.
  5.  **The Check:** We compare the `state` from Auth0 with the `state` in the cookie. If they don't match, the login request did not originate from us, and we block it.

> **Note on Timing Attacks:** We use _constant-time comparison_ logic to check the state. This ensures that the server takes the exact same amount of time to reject a wrong code, whether the first letter is wrong or the last letter is wrong. This prevents hackers from guessing the code by measuring how long the server takes to respond.

#### 2. The `nonce` Parameter (Stopping Replay Attacks)

- **The Threat (Replay Attack):** If a hacker intercepts the ID Token sent by Auth0 (e.g., over an insecure Wi-Fi), they could try to send that token to our server later to impersonate the user.
- **The Defense:**
  1.  We generate a cryptographically random string (the `nonce`) alongside the state.
  2.  We save this in a cookie (`auth_nonce`) and send it to Auth0.
  3.  Auth0 embeds this `nonce` inside the signed ID Token it generates.
  4.  **The Check:** When the token arrives, we decode it and verify that the `nonce` inside the token matches the one in our cookie.
  5.  Once used, the cookie is destroyed immediately. This ensures the token is "fresh" and hasn't been captured and replayed.

#### 3. Hardening Diagram

This flow illustrates exactly what happens inside the `GET /auth/callback` handler:

```mermaid
flowchart TD
    Start([Callback Received]) --> Cookies{Read Cookies:<br/>auth_state<br/>auth_nonce}

    Cookies -->|Missing?| Block1[🛑 Block: Session Expired/Invalid]
    Cookies -->|Present| Param{Read URL Param:<br/>state}

    Param --> MatchState{Compare:<br/>Cookie State == URL State}
    MatchState -->|No Match| Block2[🛑 Block: CSRF Attempt]
    MatchState -->|Match| Decode[Decode ID Token from Auth0]

    Decode --> MatchNonce{Compare:<br/>Cookie Nonce == Token Nonce}
    MatchNonce -->|No Match| Block3[🛑 Block: Replay Attack]

    MatchNonce -->|Match| Success[✅ Login Successful]

    Success --> Cleanup[Clear Auth Cookies]
    Block1 --> Cleanup
    Block2 --> Cleanup
    Block3 --> Cleanup

    Cleanup --> Finish([End])

    style Block1 fill:#ff6b6b,color:white
    style Block2 fill:#ff6b6b,color:white
    style Block3 fill:#ff6b6b,color:white
    style Success fill:#51cf66,color:white
```

### Auth0 `/userinfo` caching

Workers keep a small in‑memory cache (2‑minute TTL, keyed by a SHA‑256 digest of the access token) for Auth0 `/userinfo` responses. Although isolates are ephemeral, this cache significantly reduces repeated upstream calls during bursts (e.g., multiple admin requests in a short window) and limits the blast radius if Auth0 temporarily rate limits us. If an isolate is recycled the cache naturally evaporates with no persistence.

### Rate limiting fallback rationale

Primary throttling is enforced via Cloudflare’s Rate Limiting API bindings. Each middleware instance also ships with a like‑for‑like in‑memory fallback so that:

- Local development and CI (where bindings are unavailable) still exercise realistic budgets.
- Production gracefully degrades if a binding is misconfigured instead of failing wide open.

The fallback uses the same key derivation (IP or user) and limit window but only protects a single isolate; Cloudflare’s edge limits remain the authoritative protection in production.

## Proximity Search Flow

Detailed flow for geospatial proximity search:

```mermaid
sequenceDiagram
    participant Client
    participant Worker
    participant Validator
    participant Service as LooService
    participant Prisma
    participant HD as Hyperdrive
    participant DB as PostgreSQL<br/>+ PostGIS

    Client->>Worker: GET /api/loos/proximity?lat=51.5074&lng=-0.1278&radius=1000
    Worker->>Validator: Validate query
    Validator->>Validator: Coerce lat/lng to numbers
    Validator->>Validator: Check lat range (-90 to 90)
    Validator->>Validator: Check lng range (-180 to 180)
    Validator->>Validator: Check radius <= 50000m
    Validator->>Service: getByProximity(51.5074, -0.1278, 1000)

    Service->>Prisma: Build query with ST_DWithin
    Note over Service,Prisma: Query: SELECT *, ST_Distance(...) AS distance<br/>FROM loos<br/>WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(-0.1278, 51.5074), 4326), 1000)<br/>ORDER BY distance

    Prisma->>HD: Execute via connectionString
    HD->>HD: Check query cache (60s TTL)
    alt Cache hit
        HD-->>Prisma: Return cached rows
    else Cache miss
        HD->>DB: Execute SQL
        DB->>DB: Use GIST spatial index
        DB->>DB: Filter by bounding box first
        DB->>DB: Calculate exact distances
        DB-->>HD: Return ordered rows
        HD->>HD: Cache results
        HD-->>Prisma: Return ordered rows
    end

    Prisma-->>Service: Raw result rows
    Service->>Service: Transform to DTOs
    Service->>Service: Add distance_meters field
    Service-->>Worker: {data: [...], count: N}
    Worker-->>Client: 200 OK with JSON
```

## Admin Page Render Flow

Server-side rendering flow for admin pages:

```mermaid
sequenceDiagram
    participant Browser
    participant Worker
    participant Auth as requireAdminAuth
    participant Service as LooService
    participant DB

    Browser->>Worker: GET /admin/loos<br/>Cookie: session=...
    Worker->>Auth: Check authentication
    Auth->>Auth: Verify JWT from session cookie
    alt Not authenticated
        Auth-->>Browser: 302 Redirect to /admin/login
    else Has admin role
        Auth->>Worker: Set user in context
        Worker->>Service: search(params)
        Service->>DB: SELECT * FROM loos WHERE ...
        DB-->>Service: Return rows
        Service-->>Worker: Transform to DTOs
        Worker->>Worker: Render JSX template
        Note over Worker: Server-side rendering<br/>with Hono JSX<br/>(NOT React)
        Worker-->>Browser: 200 OK with HTML
    else Authenticated but not admin
        Auth-->>Browser: 403 Forbidden
    end
```

## Error Handling Flow

How errors are handled and logged:

```mermaid
sequenceDiagram
    participant Client
    participant Worker
    participant Handler as handleRoute
    participant Service
    participant DB
    participant Logger

    Client->>Worker: POST /api/loos
    Worker->>Handler: Execute route handler
    Handler->>Service: create(data)
    Service->>DB: INSERT INTO loos
    alt Database error
        DB-->>Service: Error: Unique constraint violation
        Service-->>Handler: Throw error
        Handler->>Logger: logError(error, context)
        Logger->>Logger: Structured JSON log
        Handler-->>Worker: 500 Internal Server Error
        Worker-->>Client: {message: "Database error", requestId: "..."}
    else Success
        DB-->>Service: Created row
        Service-->>Handler: Return loo DTO
        Handler->>Logger: info("Request completed")
        Handler-->>Worker: 201 Created
        Worker-->>Client: {id: "...", name: "..."}
    end
```

## Rate Limiting Decision Flow

How rate limiting decisions are made:

```mermaid
flowchart TD
    A[Incoming Request] --> B{Cloudflare Rate<br/>Limiter Binding<br/>Available?}

    B -->|Yes| C[Generate Rate Limit Key]
    B -->|No| D[Log Error:<br/>Binding Not Found]

    C --> E{Key Strategy}
    E -->|IP-based| F[key = read:cf-connecting-ip]
    E -->|User-based| G{User<br/>Authenticated?}

    G -->|Yes| H[key = write:user:sub]
    G -->|No| I[key = write:ip:cf-connecting-ip]

    F --> J[Call rateLimiter.limit]
    H --> J
    I --> J

    J --> K{Success?}

    K -->|Yes| L[Process Request]
    K -->|No| M[Log Warning:<br/>Rate Limit Exceeded]

    D --> N[Fail Open:<br/>Allow Request]

    M --> O[Return 429<br/>Too Many Requests]
    L --> P[Continue to<br/>Next Middleware]
    N --> P

    style O fill:#ff6b6b
    style P fill:#51cf66
    style D fill:#ffd43b
```

## Performance Characteristics

### Typical Response Times

| Endpoint Type                   | p50   | p95   | p99   |
| ------------------------------- | ----- | ----- | ----- |
| Simple read (GET /api/loos/:id) | 15ms  | 35ms  | 80ms  |
| Proximity search                | 45ms  | 120ms | 250ms |
| Full-text search                | 80ms  | 200ms | 400ms |
| Write operation                 | 60ms  | 150ms | 300ms |
| Admin page render               | 100ms | 250ms | 500ms |

### Bottlenecks

- **Database queries**: PostGIS spatial operations can be expensive
- **JWKS fetching**: First JWT verification requires Auth0 request
- **Connection pool**: Hyperdrive manages connection pooling automatically

### Optimization Strategies

- **Spatial indexes**: GIST indexes on `location` column
- **Connection pooling**: Hyperdrive connection pooling for efficient database access
- **Query caching**: Hyperdrive automatic caching for read queries (60s TTL)
- **Query optimization**: `EXPLAIN ANALYZE` for slow queries
- **JWKS caching**: JWKS keys cached for 1 hour

## See Also

- [Architecture Overview](./overview.md) - System architecture
- [Hyperdrive](./hyperdrive.md) - Database acceleration with Hyperdrive
- [Authentication](../authentication/overview.md) - Auth details
- [Rate Limiting](../operations/rate-limiting.md) - Rate limiting configuration
