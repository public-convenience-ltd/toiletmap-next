# Rate Limiting

The application uses the **Cloudflare Rate Limiting API** for global, datacenter-level enforcement.


## Limits

| Tier | Limit | Scope | Use Case |
|------|-------|-------|----------|
| **Read** | 400/min | IP | Public API reads (including every `GET /api/geocode`) |
| **Write** | 20/min | User/IP | Creating/updating loos |
| **Feedback** | 20/min | IP | `POST /api/feedback` (shares the write binding under a `feedback:` key; the key is never logged) |
| **Geocode** | 20/min | IP | Explicit place searches (`GET /api/geocode` without `mode=suggest`, the ones that may reach Nominatim). Shares the write binding under a `geocode:` key, on top of the read limit; the key is never logged. Typing (`mode=suggest`) never reaches Nominatim and has only the read limit. |
| **Heavy read** | 20/min | IP | Heavy public reads, on top of the read limit: `GET /api/loos/dump?rich=true`, `/search`, `/metrics`, `/proximity` with `radius` over 5000 m, `/geohash/:geohash` with a 4-character prefix, and wide legacy GraphQL queries (`loos`, `statistics`, `fullLoosByGeohash`, a geohash prefix under 4 characters, `loosByProximity` beyond 5000 m). Shares the write binding under a `heavy:` key; cache hits count too. Admins skip it on the REST routes (the token's `access:admin` must be confirmed by the Auth0 Management API, as for `/admin`); on GraphQL the key is never logged. The website (100-150 m proximity, plain dump) and the Flutter app (proximity up to 5000 m) never hit it. |
| **Admin** | 60/min | User/IP | Admin panel operations |
| **Nominatim budget** | 60/min | Location | Every Nominatim request takes a token from the admin binding under the one constant key `nominatim`, so all isolates in a Cloudflare location share it (with 1 request/s per isolate, and at most one queued, on top). Out of tokens: 503 `geocoder_busy`. Workers rate limits are per location, so this bounds Nominatim per location, not worldwide. |
| **Auth** | 5/min | IP | Login attempts |

The geocode route's edge cache does nothing on `workers.dev` (there is no zone cache there),
so until the custom-domain cutover only the in-isolate memory cache and these limits keep
Nominatim traffic down.

## Configuration

Limits are defined in `wrangler.jsonc`:

```jsonc
[[env.production.unsafe.bindings]]
type = "ratelimit"
namespace_id = "1001"
simple = { limit = 400, period = 60 }
name = "RATE_LIMIT_READ"
```

## Troubleshooting

- **"Rate limiter binding not found"**: Expected in local development if bindings are not configured; the system fails open (allows requests).
- **429 Errors**: Increase limits in `wrangler.jsonc` or implement exponential backoff.
