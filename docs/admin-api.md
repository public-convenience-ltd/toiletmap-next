# Admin API Documentation

The Admin API provides specialized endpoints for administrative operations that require elevated permissions. All admin endpoints require authentication with an Auth0 token that includes the `access:admin` permission.

## Authentication & Authorization

### Requirements
- **Authentication**: Valid Auth0 JWT token
- **Authorization**: Token must include `access:admin` in the `permissions` array

### Headers
All admin API requests must include:
```
Authorization: Bearer <your-auth0-token>
```

### Error Responses

#### 401 Unauthorized
Returned when no valid authentication token is provided:
```json
{
  "message": "Unauthorized"
}
```

#### 403 Forbidden
Returned when the token is valid but lacks admin permissions:
```json
{
  "message": "Forbidden: Admin role required"
}
```

## Endpoints

### GET /admin/api/stats

Returns comprehensive statistics for the admin dashboard, including toilet counts, contributor metrics, and activity data.

**Response Schema:**
```json
{
  "overview": {
    "totalLoos": 18234,
    "activeLoos": 17856,
    "accessibleLoos": 12450,
    "verifiedLoos": 15200
  },
  "contributors": {
    "total": 3421,
    "topContributors": [
      {
        "name": "Community Mapper",
        "count": 523
      },
      {
        "name": "Accessibility Team",
        "count": 412
      }
    ]
  },
  "activity": {
    "recentUpdates": 18234,
    "updatesLast30Days": 1234,
    "updatesLast7Days": 342
  }
}
```

**Field Descriptions:**

| Field | Type | Description |
|-------|------|-------------|
| `overview.totalLoos` | number | Total number of toilets in the database |
| `overview.activeLoos` | number | Number of active toilets |
| `overview.accessibleLoos` | number | Number of accessible toilets |
| `overview.verifiedLoos` | number | Number of verified toilets |
| `contributors.total` | number | Total unique contributors |
| `contributors.topContributors` | array | Top 10 contributors by edit count |
| `activity.recentUpdates` | number | Total number of toilets with updates |
| `activity.updatesLast30Days` | number | Updates in the last 30 days |
| `activity.updatesLast7Days` | number | Updates in the last 7 days |

**Example Request:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.example.com/admin/api/stats
```

---

### GET /admin/api/loos/map

Returns compressed toilet data optimized for map visualization. This endpoint is designed to handle large datasets efficiently by only returning essential fields needed for map display.

**Query Parameters:**

| Parameter | Type | Values | Description |
|-----------|------|--------|-------------|
| `active` | boolean | `true`, `false` | Filter by active status (optional) |
| `accessible` | boolean | `true`, `false` | Filter by accessibility (optional) |

**Response Schema:**
```json
{
  "data": [
    {
      "id": "abc123def456",
      "location": {
        "lat": 51.5074,
        "lng": -0.1278
      },
      "active": true,
      "accessible": true,
      "babyChange": false,
      "radar": true,
      "noPayment": true,
      "name": "Central Station Toilet",
      "areaName": "Westminster"
    }
  ],
  "count": 1
}
```

**Field Descriptions:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique toilet identifier |
| `location` | object | Geographic coordinates |
| `location.lat` | number | Latitude |
| `location.lng` | number | Longitude |
| `active` | boolean | Whether the toilet is currently active |
| `accessible` | boolean \| null | Whether the toilet is wheelchair accessible |
| `babyChange` | boolean \| null | Whether baby changing facilities are available |
| `radar` | boolean \| null | Whether a RADAR key is required |
| `noPayment` | boolean \| null | Whether the toilet is free to use |
| `name` | string \| null | Name of the toilet |
| `areaName` | string \| null | Name of the associated area |
| `count` | number | Total number of results returned |

**Performance Considerations:**

This endpoint is optimized for large datasets (18k+ toilets) by:
- Returning only essential fields for map visualization
- Using database-level filtering for better performance
- Excluding heavy fields like notes, reports, and removal reasons

**Example Requests:**

Get all toilets with locations:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.example.com/admin/api/loos/map
```

Get only active, accessible toilets:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://api.example.com/admin/api/loos/map?active=true&accessible=true"
```

Get only inactive toilets:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://api.example.com/admin/api/loos/map?active=false"
```

---

## Rate Limiting

Currently, there are no specific rate limits on admin endpoints beyond the standard API rate limits. However, these endpoints are resource-intensive and should not be called excessively.

**Recommendations:**
- Cache statistics data for at least 5 minutes
- Cache map data for at least 1 minute when filters don't change
- Use the filtering parameters to reduce payload size when possible

## Testing

E2E tests for admin endpoints are located in `tests/e2e/admin/admin-api.test.ts`.

Run tests:
```bash
npm run test:e2e -- tests/e2e/admin/admin-api.test.ts
```

## Implementation Details

### Middleware Chain
Admin endpoints use a two-stage middleware chain:

1. **requireAuth**: Validates the Auth0 JWT token
2. **requireAdminRole**: Checks for `access:admin` permission

### Service Layer
Admin logic is implemented in `src/services/admin.service.ts`:
- `getStatistics()`: Aggregates statistical data
- `getMapData()`: Returns compressed map data

### Database Performance
- Statistics queries use Prisma's count aggregations
- Map data uses raw SQL queries for better performance with large datasets
- Contributor statistics use PostgreSQL array functions for efficiency

## Future Enhancements

Potential improvements for admin endpoints:
- Pagination support for map data
- Date range filtering for activity statistics
- More granular contributor analytics
- Export capabilities (CSV, JSON)
- Real-time updates via WebSocket
- Caching layer with Redis
