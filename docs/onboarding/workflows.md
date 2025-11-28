# Common Workflows

- **Inspecting queries**: Complex read concerns are isolated in `src/services/loo/sql.ts`. The raw SQL returned from helpers is Prisma-safe (`Prisma.sql`).
- **Adding new Prisma entities**:
    1. Create a new Supabase migration: `pnpm supabase migration new <name>`
    2. Add your SQL changes to the generated file in `supabase/migrations/`
    3. Apply changes to local DB: `pnpm supabase db reset`
    4. Update `prisma/schema.prisma` to match the new schema
    5. Generate Prisma client: `pnpm prisma:generate`
    > **Note**: We do NOT use Prisma Migrate. We use Supabase for migrations and Prisma for the client.
- **Regenerating OpenAPI**: `pnpm docs:generate` writes `docs/openapi.json` using the schema definitions in `src/docs/openapi.ts`.

## Database Management

- **Start Database**: `pnpm supabase:start` (Starts PostgreSQL + PostGIS in Docker)
- **Stop Database**: `pnpm supabase:stop`
- **Reset Database**: `pnpm supabase:reset` (Wipes data and reapplies migrations + seeds)
- **Studio UI**: `http://localhost:54323` (Supabase Studio for viewing data)
