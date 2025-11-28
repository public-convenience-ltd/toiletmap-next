# Testing Guide

toiletmap-server uses Vitest for fast, comprehensive testing with E2E integration tests that verify the full stack.

## Test Architecture

```
test/
├── integration/           # E2E integration tests
│   ├── loos.read.spec.ts # Read endpoint tests
│   ├── loos.write.spec.ts # Write endpoint tests
│   ├── areas.spec.ts      # Area endpoint tests
│   └── admin.spec.ts      # Admin UI tests
├── fixtures/              # Test data factories
│   ├── loo.ts
│   └── area.ts
└── support/               # Test utilities
    ├── test-app.ts        # Test app factory
    ├── test-app.ts        # Test app factory
    └── auth.ts            # Auth helpers

`tests/e2e/context.ts` exposes a lightweight `testClient` that calls `createApp().fetch` directly, bypassing the HTTP server for faster execution.

## Running Tests

### All Integration Tests

```bash
pnpm test:e2e
```

### Specific Test File

```bash
pnpm vitest run test/integration/loos.read.spec.ts
```

### Watch Mode

```bash
pnpm vitest watch test/integration/loos.read.spec.ts
```

### With Coverage

```bash
pnpm test:e2e --coverage
```

### Keep Database Running

To avoid restarting Supabase between test runs (faster iteration):

```bash
KEEP_SUPABASE=1 pnpm vitest run tests/e2e/loos/mutation.test.ts
```

## Writing Integration Tests

### Basic Structure

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp } from '../support/test-app';
import { fixtures } from '../fixtures';

describe('Loo read endpoints', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.cleanup();
  });

  it('returns a loo by ID', async () => {
    // Arrange: Create test data
    const loo = await fixtures.loos.create({ name: 'Test Toilet' });

    // Act: Make request
    const response = await app.request(`/api/loos/${loo.id}`);

    // Assert: Verify response
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(loo.id);
    expect(body.name).toBe('Test Toilet');
  });
});
```

### Authenticated Requests

```typescript
import { authHeaders } from '../support/auth';

it('creates a loo when authenticated', async () => {
  const response = await app.request('/api/loos', {
    method: 'POST',
    headers: authHeaders(), // Adds Authorization header
    body: JSON.stringify({
      name: 'New Toilet',
      location: { lat: 51.5, lng: -0.1 }
    })
  });

  expect(response.status).toBe(201);
});
```

### Admin Role Tests

```typescript
import { authHeaders } from '../support/auth';

it('allows admin users to view contributor details', async () => {
  const response = await app.request('/api/loos/123/reports', {
    headers: authHeaders({ role: 'admin' })
  });

  const body = await response.json();
  expect(body.data[0].contributor).toBeDefined();
});
```

### Using Fixtures

```typescript
import { fixtures } from '../fixtures';

// Create a loo
const loo = await fixtures.loos.create({
  name: 'Test Toilet',
  accessible: true,
  active: true,
});

// Create multiple loos
const loos = await Promise.all([
  fixtures.loos.create({ name: 'Toilet 1' }),
  fixtures.loos.create({ name: 'Toilet 2' }),
  fixtures.loos.create({ name: 'Toilet 3' }),
]);

// Update a loo
await fixtures.loos.upsert(loo.id, { name: 'Updated Name' });
```

## Test Patterns

### Testing Validation

```typescript
it('rejects invalid latitude', async () => {
  const response = await app.request('/api/loos/proximity?lat=999&lng=0&radius=1000');

  expect(response.status).toBe(400);
  const body = await response.json();
  expect(body.message).toBe('Invalid proximity query');
  expect(body.issues).toBeDefined();
  expect(body.issues[0].path).toContain('lat');
});
```

### Testing Rate Limiting

```typescript
it('enforces rate limits', async () => {
  const requests = Array.from({ length: 101 }, (_, i) =>
    app.request('/api/loos/search')
  );

  const responses = await Promise.all(requests);
  const rateLimited = responses.filter(r => r.status === 429);

  expect(rateLimited.length).toBeGreaterThan(0);
});
```

### Testing Geospatial Queries

```typescript
it('returns loos within proximity radius', async () => {
  // Create loos at known coordinates
  const nearLoo = await fixtures.loos.create({
    location: { lat: 51.5074, lng: -0.1278 } // London
  });

  const farLoo = await fixtures.loos.create({
    location: { lat: 52.4862, lng: -1.8904 } // Birmingham
  });

  // Search near London (1000m radius)
  const response = await app.request(
    '/api/loos/proximity?lat=51.5074&lng=-0.1278&radius=1000'
  );

  const body = await response.json();
  const ids = body.data.map(loo => loo.id);

  expect(ids).toContain(nearLoo.id);
  expect(ids).not.toContain(farLoo.id);
});
```

### Testing Admin Pages (SSR)

```typescript
it('renders admin dashboard with loo list', async () => {
  await fixtures.loos.create({ name: 'Test Toilet' });

  const response = await app.request('/admin/loos', {
    headers: authHeaders({ role: 'admin' })
  });

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/html');

  const html = await response.text();
  expect(html).toContain('Test Toilet');
  expect(html).toContain('<table');
});
```

## Test Database

### Database Configuration

E2E tests require database access via the TEST_DB Hyperdrive binding.

**CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TEST_DB**
- Matches production-like Hyperdrive setup
- Mirrors the TEST_DB binding used in development
- Example: `postgresql://postgres:postgres@localhost:54322/postgres`

```bash
# In .env or .env.local
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TEST_DB=postgresql://postgres:postgres@localhost:54322/postgres
```

**Default Connection:**
If not set, tests will use the default local Supabase connection:
`postgresql://postgres:postgres@localhost:54322/postgres`

### Database Lifecycle

Each test run:

1. **Starts Supabase** (if not running): `pnpm supabase:start`
2. **Runs migrations**: Applies all migrations from `supabase/migrations/`
3. **Runs tests**: Each test creates/cleans up its own data
4. **Optional cleanup**: `pnpm supabase:stop` to stop database

### Database Isolation

Tests use transactions for isolation:

```typescript
// Each test runs in a transaction
beforeEach(async () => {
  await db.transaction(async (tx) => {
    // Test runs here
  });
  // Transaction rolls back after test
});
```

### Cleaning Up Test Data

Use fixtures cleanup:

```typescript
afterEach(async () => {
  await fixtures.cleanup();
});
```

## Debugging Tests

### Verbose Logging

```bash
# Enable all logs
DEBUG=* pnpm test:e2e

# Enable specific logs
DEBUG=app:* pnpm test:e2e
```

### Inspecting Requests

```typescript
it('debugs a request', async () => {
  const response = await app.request('/api/loos/123');

  console.log('Status:', response.status);
  console.log('Headers:', Object.fromEntries(response.headers));
  console.log('Body:', await response.text());
});
```

### Database Inspection

```bash
# Connect to test database
psql postgresql://postgres:postgres@localhost:54322/postgres

# Query test data
SELECT * FROM loos WHERE name LIKE '%Test%';
```

## Continuous Integration

Tests run on every push via GitHub Actions:

```yaml
# .github/workflows/test.yml
- name: Run tests
  run: pnpm test:e2e
  env:
    AUTH0_ISSUER_BASE_URL: http://127.0.0.1:44555/
```

## Common Issues

### Supabase not running

**Error**: `Error: connect ECONNREFUSED ::1:54322`

**Solution**:
```bash
pnpm supabase:start
```

### Port conflicts

**Error**: `Error: Port 54322 is already allocated`

**Solution**:
```bash
pnpm supabase:stop
pnpm supabase:start
```

### Stale Prisma client

**Error**: `Cannot find module '@prisma/client'`

**Solution**:
```bash
pnpm prisma:generate
```

### Test timeouts

**Error**: `Test timed out after 5000ms`

**Solution**: Increase timeout for slow tests
```typescript
it('slow operation', async () => {
  // ...
}, 30000); // 30 second timeout
```

## Best Practices

### ✅ Do

- Use fixtures for test data creation
- Clean up test data after each test
- Test both success and error cases
- Use descriptive test names
- Test edge cases (empty arrays, null values, boundary conditions)
- Verify error messages and status codes

### ❌ Don't

- Share state between tests
- Hard-code IDs or dates
- Test implementation details
- Leave database in dirty state
- Skip error case testing

## See Also

- [Architecture Overview](../architecture/overview.md) - System architecture
- [Request Flow](../architecture/request-flow.md) - Sequence diagrams
