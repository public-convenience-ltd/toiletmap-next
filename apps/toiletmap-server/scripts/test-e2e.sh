#!/usr/bin/env bash
# Runs the server test suite (unit, admin and integration) once, non-watch.
#
# Requires the local Supabase stack (`pnpm supabase:start`) on port 54322, or
# CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TEST_HYPERDRIVE pointing at a
# migrated database. Extra arguments are passed to vitest, e.g.
#   pnpm test:e2e test/integration/loos.read.spec.ts
set -euo pipefail

cd "$(dirname "$0")/.."

# Use the lockfile-pinned binaries rather than whatever npx resolves.
pnpm exec prisma generate --schema prisma/schema.prisma
pnpm exec vitest run "$@"
