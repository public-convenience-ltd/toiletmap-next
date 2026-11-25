# Runbook: the write kill switch (`write_mode`)

Stops or holds every change made **through this API** (the new site, the app and admins) in
about a minute, without a deploy. Use it when an account or a script is damaging the map
faster than moderators can undo it, during a database incident, or, together with the steps
under [What it does not stop](#what-it-does-not-stop), to freeze the data for a migration or
the cutover.

Code: `apps/toiletmap-server/src/services/write-mode.ts` (the setting) and
`src/middleware/write-mode.ts` (where it is enforced).

## Modes

| `write_mode` | Loo writes (`POST`/`PUT` under `/api/loos`: add, edit, report, restore, verify) | Admins | Moderation queue (`/admin/pending`) |
| --- | --- | --- | --- |
| `open` (or no key, or no binding) | Normal trust rules: signed-in, unblocked users write directly; others are queued. | Write directly. | Works. |
| `queue` | **Every** non-admin write is queued for moderation: `202 {queued: true, id, reason: "queue_mode"}`. Verify still applies (it only sets `verified_at`), under the 1/min queued-write limit. | Write directly. | Works: moderators approve what is good. |
| `read-only` | **Every** write is refused: `503 {error: "read_only", message}` with `Retry-After: 300`. Nothing is written or queued. | Refused too. | Approve and reject are refused (the page says "Editing is paused"). |

In every mode:

- Reads (the map, `/api/loos/*` GETs, legacy GraphQL, the dataset export) are unaffected; KV
  is only read for state-changing requests.
- `POST /api/feedback` stays open, so people can still tell us about problems.
- Other admin actions stay open: permission changes in `/admin/users/admin` (you may need to
  remove someone's `access:admin` during an incident), feedback deletion (erasure) and
  regenerating the dataset export.
- The website shows "Editing is paused" on the add/edit form (keeping what was typed), the
  report flow, restore and "Yes, it's still here" when the server answers `read_only`.

## What it does not stop

The switch lives in this worker, so it only holds writes that reach this worker:

- **The legacy Next.js app, until the cutover.** It writes to the same production tables
  (as the `toiletmap_web` role, through its own GraphQL mutations) and never reads
  `write_mode`, so edits, removals and feedback from www.toiletmap.org.uk keep landing in
  every mode. To freeze the data, stop writes there too, with the legacy app's own controls
  (for example by taking its mutations offline or putting it into maintenance). Do **not**
  revoke grants from `toiletmap_web`: both apps use that role, so this worker would stop
  reading as well.
- **Direct SQL** (Supabase SQL editor, psql, the runbooks in this folder) and the
  scheduled dataset export, which only reads.

Check with `SELECT max(ts) FROM audit.record_version WHERE table_name = 'toilets'` that no
new audit rows arrive once everything is frozen.

Spellings accepted: `open`, `queue`, `read-only` (also `readonly`, `read_only`), any case.
**Any other value is treated as `read-only`** (fails closed) and logged as an error, so a
typo never reopens writes. An empty value or a deleted key is `open`.

## Before the first use (owner, once)

Production has no KV namespace yet, so `write_mode` is always `open` there. To create it:

```bash
cd apps/toiletmap-server
pnpm exec wrangler kv namespace create toiletmap-server-settings
```

Add the printed id to `env.production` in `apps/toiletmap-server/wrangler.jsonc` (replacing
the TODO there) and merge it:

```jsonc
"kv_namespaces": [{ "binding": "SETTINGS", "id": "<printed id>" }],
```

Bindings are not inherited from the top level, so `env.production` needs its own entry. Keep
the binding in `wrangler.jsonc` (never only in the dashboard): `wrangler deploy` replaces the
dashboard's bindings with the file's on every merge. Preview workers deliberately have no
binding; to rehearse there, create a separate namespace (never production's).

## Change the mode (production)

Run from `apps/toiletmap-server` with a Cloudflare login (`pnpm exec wrangler login`) that
can edit the account's Workers KV. `--remote` matters: without it Wrangler writes to the
local development store.

```bash
# Hold every non-admin change for review
pnpm exec wrangler kv key put --binding SETTINGS --env production --remote write_mode queue

# Stop all changes made through this API (not the legacy app: see above)
pnpm exec wrangler kv key put --binding SETTINGS --env production --remote write_mode read-only

# Back to normal
pnpm exec wrangler kv key put --binding SETTINGS --env production --remote write_mode open

# What is set now (no output, or an error that the key is missing, means open)
pnpm exec wrangler kv key get --binding SETTINGS --env production --remote write_mode
```

If `--binding` cannot resolve the namespace (for example before the binding is merged), use
`--namespace-id <id>` in place of `--binding SETTINGS --env production`. The Cloudflare
dashboard works too: Storage & Databases, KV, `toiletmap-server-settings`, key `write_mode`.

**How fast:** each worker isolate caches the value for 10 seconds, and KV itself can serve a
cached value for up to about 60 seconds after a write, so allow a minute. If KV cannot be
read, an isolate keeps the last value it read (or `open` if it never read one) and logs
`Could not read write_mode from SETTINGS`.

## Check it took effect

```bash
# read-only: expect HTTP 503 and {"error":"read_only",...}
curl -s -o /dev/stderr -w '%{http_code}\n' -X POST \
  https://toiletmap-server.gbtoiletmap.workers.dev/api/loos/000000000000000000000000/verify

# queue: an edit from a normal account answers 202 with "reason":"queue_mode"
# open: the same verify answers 404 (no such toilet), not 503
```

Also watch `/admin/pending` (queue mode fills it) and the worker logs.

## It survives deploys

The value lives in KV, not in a var or a secret, so `wrangler deploy` (every merge to
`main`) leaves it alone. After an unrelated deploy while in `read-only`, re-run the `curl`
above: it must still answer 503. Two things do reset it: deleting the key (back to `open`)
and removing the `kv_namespaces` entry from `env.production` (no binding means `open`).
Never remove that entry during an incident.

## Local development and tests

`wrangler dev` binds a local `SETTINGS` store (top level of `wrangler.jsonc`):

```bash
pnpm exec wrangler kv key put --binding SETTINGS --local write_mode read-only
pnpm exec wrangler kv key delete --binding SETTINGS --local write_mode
```

The integration tests drive the mode through an in-memory KV
(`test/integration/loos.write-mode.spec.ts`).

## Related

- Per-account daily caps and the removal alert: `src/services/write-caps.ts`,
  `ACCOUNT_DAILY_CAP` in `wrangler.jsonc` (default 10 removals and moves a day; admins
  exempt; past it, `202 reason: "daily_cap"`).
- Undo one account's changes: [revert-by-account.md](revert-by-account.md).
- Block the account in the Auth0 dashboard first: its changes are then queued in any mode.
