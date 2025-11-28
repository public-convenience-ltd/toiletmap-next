# Supabase & Data Flow

## Supabase Configuration

The repository vendors the Supabase configuration from the wider monorepo:

- `supabase/` contains migrations and deterministic seed data referenced by tests.
- `pnpm supabase:start` stands up the Docker stack. `supabase:reset` applies migrations + seed data again.
- The E2E suite automatically starts Supabase if it is not already running. Set `KEEP_SUPABASE=1` to leave the containers up between runs.

## Audit Trail

When the API mutates loos it writes audit entries into `record_version`. Snapshots are shaped via `src/services/loo/mappers.ts#mapAuditRecordToReport`, so consult that function before adjusting audit semantics.
