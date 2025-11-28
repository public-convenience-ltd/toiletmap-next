# Rate Limiting

The application uses a **dual-strategy** system:
1. **Cloudflare Rate Limiting API** (Production): Global, datacenter-level enforcement.
2. **In-Memory Fallback** (Development): Per-isolate enforcement when Cloudflare bindings are missing.

## Limits

| Tier | Limit | Scope | Use Case |
|------|-------|-------|----------|
| **Read** | 100/min | IP | Public API reads |
| **Write** | 20/min | User/IP | Creating/updating loos |
| **Admin** | 60/min | User/IP | Admin panel operations |
| **Auth** | 5/min | IP | Login attempts |

## Configuration

Limits are defined in `wrangler.jsonc`:

```jsonc
[[env.production.unsafe.bindings]]
type = "ratelimit"
namespace_id = "1001"
simple = { limit = 100, period = 60 }
name = "RATE_LIMIT_READ"
```

## Troubleshooting

- **"Rate limiter binding not found"**: Expected in local development; the system fails open.
- **429 Errors**: Increase limits in `wrangler.jsonc` or implement exponential backoff.
