# Rate Limiting

The application uses the **Cloudflare Rate Limiting API** for global, datacenter-level enforcement.


## Limits

| Tier | Limit | Scope | Use Case |
|------|-------|-------|----------|
| **Read** | 400/min | IP | Public API reads (including every `GET /api/geocode`) |
| **Write** | 20/min | User/IP | Creating/updating loos |
| **Feedback** | 20/min | IP | `POST /api/feedback` (shares the write binding under a `feedback:` key; the key is never logged) |
| **Geocode** | 20/min | IP | Explicit place searches (`GET /api/geocode` without `mode=suggest`, the ones that may reach Nominatim). Shares the write binding under a `geocode:` key, on top of the read limit; the key is never logged. Typing (`mode=suggest`) never reaches Nominatim and has only the read limit. |
| **Admin** | 60/min | User/IP | Admin panel operations |
| **Nominatim budget** | 60/min | Location | Every Nominatim request takes a token from the admin binding under the one constant key `nominatim`, so all isolates in a Cloudflare location share it (with 1 request/s per isolate, and at most one queued, on top). Out of tokens: 503 `geocoder_busy`. Workers rate limits are per location, so this bounds Nominatim per location, not worldwide. |
| **Auth** | 5/min | IP | Login attempts |

The geocode route's edge cache does nothing on `workers.dev` (there is no zone cache there),
so until the custom-domain cutover only the in-isolate memory cache and these limits keep
Nominatim traffic down.

## Configuration

Limits are defined per environment in `wrangler.jsonc` (`env.production.ratelimits`,
`env.preview.ratelimits`):

```jsonc
"ratelimits": [
  {
    "name": "RATE_LIMIT_READ",
    "namespace_id": "1000",
    "simple": { "limit": 400, "period": 60 }
  }
]
```

| Binding | Production namespace | Preview namespace |
|---------|----------------------|-------------------|
| `RATE_LIMIT_READ` | 1000 | 2000 |
| `RATE_LIMIT_WRITE` | 1001 | 2001 |
| `RATE_LIMIT_ADMIN` (and the Nominatim budget) | 1002 | 2002 |
| `RATE_LIMIT_AUTH` | 1003 | 2003 |
| `RATE_LIMIT_ANON_WRITE` | 1004 | 2004 |

Counters are shared by every worker bound to the same namespace id, so previews have their own
ids: a preview's traffic never uses up production's limits or its Nominatim budget. All
previews share the preview namespaces. Never reuse a production id in another environment;
`test/unit/wrangler-config.test.ts` checks this.

Because the Nominatim budget (60 per 60 s on `RATE_LIMIT_ADMIN`) now exists once for production
and once for all previews, the account as a whole can send Nominatim up to about 2 requests a
second, while its usage policy allows 1 per application. Counters are also per Cloudflare
location, so the budget was never strictly global. On previews, per-IP keys see the client
worker's address rather than the visitor's (the preview client calls the server over
`PUBLIC_API_URL`), so all visitors of a preview share one bucket.

## Troubleshooting

- **"Rate limiter binding not found"**: Expected in local development if bindings are not configured; the system fails open (allows requests).
- **429 Errors**: Increase limits in `wrangler.jsonc` or implement exponential backoff.
