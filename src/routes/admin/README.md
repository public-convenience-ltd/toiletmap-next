# Admin Routes

This directory contains routes for the admin panel and admin-only API endpoints.

## Structure

- **UI Routes**: Serve the admin frontend application
  - `GET /admin` - Admin dashboard UI
  - `GET /admin/*` - SPA fallback routing

- **API Routes**: Admin-only data endpoints (requires `access:admin` permission)
  - `GET /admin/api/stats` - Comprehensive statistics
  - `GET /admin/api/loos/map` - Compressed map data

## Security

All `/admin/api/*` endpoints are protected by:
1. **Authentication** (`requireAuth` middleware) - Validates Auth0 JWT
2. **Authorization** (`requireAdminRole` middleware) - Checks for `access:admin` permission

## Frontend Integration

The admin frontend ([/admin-explorer/index.html](../../../admin-explorer/index.html)) consumes these API endpoints through the `ApiService` class:

```javascript
// Statistics
const stats = await apiService.getAdminStats();

// Map data
const mapData = await apiService.getAdminMapData({
  active: 'true',
  accessible: 'true'
});
```

## Performance Optimizations

### Statistics Endpoint
- Uses database-level aggregations for counting
- Fetches contributor data with a single optimized query
- Returns pre-calculated metrics for fast dashboard loading

### Map Data Endpoint
- Returns only essential fields (id, location, status flags)
- Excludes heavy fields (notes, reports, full history)
- Uses raw SQL for better performance with 18k+ records
- Supports filtering to reduce payload size

## Testing

E2E tests validate:
- Authentication requirements
- Permission enforcement
- Response structure
- Data filtering
- Performance characteristics

Run tests:
```bash
npm run test:e2e -- tests/e2e/admin/admin-api.test.ts
```

## Documentation

See [docs/admin-api.md](../../../docs/admin-api.md) for full API documentation.
