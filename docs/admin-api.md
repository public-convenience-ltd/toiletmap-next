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

### GET /admin/api/suspicious-activity

Returns suspicious activity across multiple categories to help identify potential data quality issues or malicious behavior.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `hoursWindow` | number | 24 | Time window in hours to analyze |
| `minRapidUpdates` | number | 5 | Minimum updates to flag as rapid |
| `minLocationChangeMeters` | number | 1000 | Minimum distance (meters) to flag location change |
| `minMassDeactivations` | number | 5 | Minimum deactivations to flag as mass |

**Response Schema:**
```json
{
  "rapidUpdates": [
    {
      "looId": "abc123",
      "looName": "Central Station Toilet",
      "updateCount": 8,
      "contributors": ["user1", "user2"],
      "firstUpdate": "2025-11-15T10:00:00Z",
      "lastUpdate": "2025-11-15T12:30:00Z",
      "timeSpanMinutes": 150
    }
  ],
  "conflictingEdits": [
    {
      "looId": "def456",
      "looName": "Park Toilet",
      "field": "accessible",
      "contributors": [
        {
          "name": "user1",
          "value": true,
          "timestamp": "2025-11-15T11:00:00Z"
        },
        {
          "name": "user2",
          "value": false,
          "timestamp": "2025-11-15T11:05:00Z"
        }
      ],
      "conflictCount": 2
    }
  ],
  "locationChanges": [
    {
      "looId": "ghi789",
      "looName": "Shopping Centre Toilet",
      "contributor": "user3",
      "timestamp": "2025-11-15T14:00:00Z",
      "oldLocation": { "lat": 51.5074, "lng": -0.1278 },
      "newLocation": { "lat": 51.5274, "lng": -0.1478 },
      "distanceMeters": 2834
    }
  ],
  "massDeactivations": [
    {
      "contributor": "user4",
      "deactivationCount": 12,
      "looIds": ["jkl012", "mno345", "..."],
      "firstDeactivation": "2025-11-15T09:00:00Z",
      "lastDeactivation": "2025-11-15T09:15:00Z",
      "timeSpanMinutes": 15
    }
  ]
}
```

**Categories:**

- **Rapid Updates**: Multiple edits to the same toilet in a short time
- **Conflicting Edits**: Different contributors changing the same field to different values
- **Location Changes**: Significant moves in toilet location (>1km by default)
- **Mass Deactivations**: One contributor deactivating many toilets quickly

**Example Requests:**

Default 24-hour window:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.example.com/admin/api/suspicious-activity
```

Custom 48-hour window with stricter thresholds:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://api.example.com/admin/api/suspicious-activity?hoursWindow=48&minRapidUpdates=10&minLocationChangeMeters=5000"
```

---

### GET /admin/api/contributors/leaderboard

Returns contributor leaderboard with rankings, statistics, and recent activity.

**Response Schema:**
```json
{
  "topContributors": [
    {
      "name": "Community Mapper",
      "totalEdits": 523,
      "looseEdited": 412,
      "rank": 1
    },
    {
      "name": "Accessibility Team",
      "totalEdits": 412,
      "looseEdited": 289,
      "rank": 2
    }
  ],
  "recentContributors": [
    {
      "name": "New Volunteer",
      "edits": 15,
      "since": "2025-11-14T08:00:00Z"
    }
  ],
  "stats": {
    "totalContributors": 3421,
    "activeContributors7d": 84,
    "activeContributors30d": 256
  }
}
```

**Field Descriptions:**

| Field | Type | Description |
|-------|------|-------------|
| `topContributors` | array | Top 20 contributors ranked by total edits |
| `recentContributors` | array | Top 10 contributors from last 7 days |
| `stats.totalContributors` | number | Total unique contributors all-time |
| `stats.activeContributors7d` | number | Contributors active in last 7 days |
| `stats.activeContributors30d` | number | Contributors active in last 30 days |

**Example Request:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.example.com/admin/api/contributors/leaderboard
```

---

### GET /admin/api/contributors/:contributorId

Returns detailed statistics for a specific contributor.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `contributorId` | string | The contributor's identifier (URL-encoded) |

**Response Schema:**
```json
{
  "contributorId": "Community Mapper",
  "totalEdits": 523,
  "looseEdited": 412,
  "firstEdit": "2023-05-12T14:30:00Z",
  "lastEdit": "2025-11-15T10:00:00Z",
  "recentActivity": {
    "last7Days": 12,
    "last30Days": 45
  },
  "editTypes": {
    "creates": 89,
    "updates": 434
  },
  "topFields": [
    { "field": "accessible", "count": 156 },
    { "field": "babyChange", "count": 134 },
    { "field": "name", "count": 98 }
  ]
}
```

**Field Descriptions:**

| Field | Type | Description |
|-------|------|-------------|
| `contributorId` | string | The contributor's identifier |
| `totalEdits` | number | Total number of edits made |
| `looseEdited` | number | Number of unique toilets edited |
| `firstEdit` | string | ISO 8601 timestamp of first edit |
| `lastEdit` | string | ISO 8601 timestamp of most recent edit |
| `recentActivity.last7Days` | number | Edits in last 7 days |
| `recentActivity.last30Days` | number | Edits in last 30 days |
| `editTypes.creates` | number | Number of new toilets created |
| `editTypes.updates` | number | Number of toilet updates |
| `topFields` | array | Top 10 most frequently edited fields |

**Error Responses:**

#### 404 Not Found
Returned when the contributor doesn't exist or has no activity:
```json
{
  "error": "Contributor not found or has no activity"
}
```

**Example Requests:**

Get stats for a contributor:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.example.com/admin/api/contributors/Community%20Mapper
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
- `getSuspiciousActivity()`: Detects suspicious editing patterns
- `getContributorLeaderboard()`: Returns contributor rankings and stats
- `getContributorStats()`: Returns detailed stats for a specific contributor

### Database Performance
- Statistics queries use Prisma's count aggregations
- Map data uses raw SQL queries for better performance with large datasets
- Contributor statistics use PostgreSQL array functions for efficiency
- Suspicious activity detection uses the audit.record_version table for historical analysis
- PostGIS functions calculate geographic distances for location change detection

## Future Enhancements

Potential improvements for admin endpoints:
- Pagination support for map data
- Date range filtering for activity statistics
- Export capabilities (CSV, JSON)
- Real-time updates via WebSocket
- Caching layer with Redis
- Automated alerts for suspicious activity
- Machine learning-based anomaly detection
- Contributor reputation scoring
