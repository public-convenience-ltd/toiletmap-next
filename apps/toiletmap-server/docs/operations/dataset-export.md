# Dataset export

Every day the server worker publishes the open dataset (every active toilet, CC BY 4.0) as JSON
and CSV to an R2 bucket. The client worker serves the files at `/dataset/latest/*` and
`/dataset/archive/*`, and the `/dataset` page links them. This replaces the legacy Vercel cron
(`toiletmap/src/pages/api/cron/daily_export.page.ts`) and its Vercel Blob files.

## How it works

| | |
| --- | --- |
| Code | `src/services/export/` (format, manifest, job, `scheduled()` glue); data from `LooService.getAllForExport()` |
| Schedule | `17 0 * * *` (00:17 UTC daily), `env.production.triggers.crons` in `wrangler.jsonc` |
| Bucket | `toiletmap-exports`, binding `EXPORTS`, in `env.production` of both workers (server writes, client reads) |
| Limits | Workers Paid defaults: 30 s CPU, 128 MB memory per isolate. No `limits` block (see [Cost and limits](#cost-and-limits)) |
| Admin | "Regenerate dataset now" on `/admin/loos` (the dataset explorer), `POST /admin/dataset/regenerate` |

Preview and local workers have no bucket and no cron. There the job skips with "not configured",
the admin button is disabled, and the client's `/dataset` page says downloads are only on the live
site (the file routes answer `503`).

### Objects

```
latest/toilets.json   latest/toilets.csv     today's files, overwritten daily
latest/manifest.json                         describes the latest files; written last
archive/YYYY-MM-DD/toilets.{json,csv}        one copy per UTC day, never deleted
archive/YYYY-MM-DD/manifest.json             that day's manifest
_state/run.json                              run bookkeeping for the guards; never served
```

The manifest holds `generatedAt`, `date`, `rowCount`, `licence`, every file's `key`,
`archiveKey`, `contentType`, `size` and `sha256`, and `archives` (the archived days, newest first).

### Order of writes and guards

1. Read the latest manifest and the run state. Skip if:
   - cron: today's dataset is already published (idempotent per UTC day), or a run started in the
     last 5 minutes and has not finished;
   - admin: a run started or finished in the last 5 minutes.
2. Record the run as started, then read every active toilet.
3. **Sanity guard.** Refuse to publish if there are no rows, or the count dropped by more than 20%
   against the previous manifest. No data files or manifests are written (only the private
   `_state/run.json`, which records the outcome); the previous files stay published. The cron run
   then throws, so it shows as failed in the Cron Events log, and an error is logged with both
   counts.
4. Write the archive files, then the archive manifest, then the latest files, and the latest
   manifest last. Nothing is ever deleted (legacy deleted the old files first). If a write fails,
   or the run is killed part-way (CPU or memory limit, a deploy), the previous manifest stays in
   place; only the bytes behind `latest/` can be newer than the manifest until the next successful
   run, and `_state/run.json` stays unfinished (it then blocks the cron for at most 5 minutes). The
   admin button hands its run to `waitUntil`, so closing the tab does not cut it off.

To publish a genuine drop of more than 20% (say a bulk removal), delete the latest manifest
(`pnpm exec wrangler r2 object delete toiletmap-exports/latest/manifest.json --remote`) and press
the admin button: with no previous manifest only the empty check applies. The archives keep the
history.

Two runs that start between one run's read of `_state/run.json` and its write of it (well under
a second) could both pass the guard (R2 has no lock here). They would write the same data, so
this is accepted.

## File format (unchanged from legacy)

Same columns, order, snake_case names and encoding as the legacy files, checked byte for byte
against the first records of the live legacy files (`test/fixtures/dataset-export/`). Active toilets
only, ordered by id. JSON is one array, no whitespace. CSV has an unquoted header row, then every
data cell quoted (`"` doubled), `\n` between rows and no trailing newline; null is an empty cell; `opening_times`,
`location` and `areas` are JSON text; `longitude` and `latitude` (from `location`) are the last two
columns. `contributors` and `removal_reason` are never published; the query selects an allowlist of
columns, so a new column stays private until someone adds it there.

Deliberate differences from legacy:

- **Formula neutralising in the CSV.** A text cell starting with `=`, `+`, `-`, `@`, a tab or a
  carriage return (or their full-width forms) gets a leading `'`, so Excel, LibreOffice and Google
  Sheets show it as text instead of running it (CSV injection: `name`, `notes` and
  `payment_details` are contributor free text). Legacy wrote such cells as they were. The JSON is
  unchanged, and `longitude`/`latitude` keep their `-`. No live record started with one of these
  characters when this was written.
- `Content-Type` now carries `charset=utf-8`.
- Stable URLs (`/dataset/latest/toilets.csv` and friends) instead of a new Blob URL every day, a
  manifest with checksums, and a daily archive.
- The new columns `removal_category` and `duplicate_of` are not added: they are only set on removed
  toilets, which the export leaves out, and adding columns could break consumers that read by
  position.
- No redirects for the files: the legacy files lived at
  `*.public.blob.vercel-storage.com/exports/toilets-<timestamp>-<random>.{json,csv}`, a new URL every
  day (the old ones deleted). The page URL `/dataset` is unchanged.
- **The page links relative, stable URLs** (`/dataset/latest/toilets.json`, `.csv`) instead of
  absolute Blob URLs with `?download=1`. Anyone who scraped `/dataset` for the Blob link should
  fetch `https://www.toiletmap.org.uk/dataset/latest/toilets.{json,csv}` directly, or read
  `/dataset/latest/manifest.json`.
- **Schedule:** 00:17 UTC instead of 00:00 UTC.
- **"Last updated"** on the page is the time the data was read (`generatedAt`), not the upload time
  of the file (a second or two later).
- **File names:** downloads send `Content-Disposition: attachment; filename="toilets-YYYY-MM-DD.ext"`
  (legacy: the Blob path's `toilets-<timestamp>-<random>.ext`).
- **The manifest carries the licence** (`licence`, `licenceUrl`, the `attribution` credit line and
  `source`), since the files themselves cannot.

## Serving (client worker)

`apps/toiletmap-client/src/pages/dataset/[...path].ts` and `src/utils/dataset.ts`. Only `toilets.json`,
`toilets.csv` and `manifest.json` under `latest/` or `archive/YYYY-MM-DD/` are served; anything else
(including `_state/`) is `404`.
`ETag` and `Last-Modified` come from R2, and `If-None-Match` / `If-Modified-Since` answer `304`; a
failed `If-Match` / `If-Unmodified-Since` answers `412`. A single byte `Range` answers `206` (with
`If-Range`), so interrupted downloads resume; any other range gets the whole file.
`Cache-Control` is `public, max-age=300` for `latest/*`, `public, max-age=31536000, immutable` for
past archive days, and an hour for today's archive (an admin can still regenerate it). Downloads
get `Content-Disposition: attachment; filename="toilets-YYYY-MM-DD.csv"`; the manifest is inline.
`Access-Control-Allow-Origin: *`, like the legacy Blob files. If the manifest cannot be read (an R2
error or a broken manifest), the page says downloads are temporarily unavailable; with no manifest
at all it says the data has not been published yet.

## Owner setup (once)

The account must be on Workers Paid: the Free plan's 10 ms CPU limit would kill the run. Create the
bucket **before deploying either worker to production** (both bind it; Cloudflare rejects a deploy
whose bucket is missing, so a client `pnpm run deploy` carrying unrelated fixes would fail too):

```bash
pnpm exec wrangler r2 bucket create toiletmap-exports
```

Then deploy the server and the client as usual. The first files appear after the next 00:17 UTC
run, or at once with the admin button. Dry-runs (`wrangler deploy --dry-run --env production`, also
run in CI) do not need the bucket.

## First production run and pre-cutover comparison

Before cutover `www.toiletmap.org.uk` still serves the legacy site, so check the new worker on its
`workers.dev` hosts.

1. **Run it.** Press "Regenerate dataset now" at
   https://toiletmap-server.gbtoiletmap.workers.dev/admin/loos, or wait for 00:17 UTC. The panel
   should then say "Dataset regenerated and published" with the row count and sizes.
2. **Check the run.** In the dashboard, toiletmap-server's Settings > Triggers > Cron Triggers lists
   past Cron Events with each scheduled run's outcome, and Workers Logs (or
   `pnpm exec wrangler tail toiletmap-server --env production` while pressing the button) shows
   `Dataset export published` with `rowCount`, `sizes` and `duration`. Note the CPU time of the run
   from the cron event, for the [Cost and limits](#cost-and-limits) table.
3. **Check the bucket.**

   ```bash
   pnpm exec wrangler r2 object get toiletmap-exports/latest/manifest.json --remote --pipe
   ```

   `date` is today (UTC), `rowCount` is close to the number of active toilets, and the two files
   are about 11 MB (JSON) and 8 MB (CSV).
4. **Check the downloads.**

   ```bash
   curl -sI https://toiletmap-client.gbtoiletmap.workers.dev/dataset/latest/toilets.csv
   ```

   Expect `200`, `text/csv; charset=utf-8`, `attachment; filename="toilets-<today>.csv"` and an
   `ETag`. Open https://toiletmap-client.gbtoiletmap.workers.dev/dataset and check the sizes, row
   count and date.
5. **Compare with legacy.** Download both pairs of files: the legacy ones from the links on
   https://www.toiletmap.org.uk/dataset, and the new ones from
   `https://toiletmap-client.gbtoiletmap.workers.dev/dataset/latest/toilets.{json,csv}`. Then:

   ```bash
   head -1 legacy.csv | cmp - <(head -1 new.csv)          # header identical
   jq length legacy.json new.json                          # row counts
   comm -3 <(jq -r '.[].id' legacy.json | sort) <(jq -r '.[].id' new.json | sort)   # id sets
   # per-id field differences
   jq -n --slurpfile a legacy.json --slurpfile b new.json '
     ($a[0] | INDEX(.id)) as $old | $b[0][] | select($old[.id] != null and $old[.id] != .) |
     .id as $id | {id: $id, fields: [keys[] as $k | select($old[$id][$k] != .[$k]) | $k]}'
   ```

   **Pass:** identical headers and key order; the id sets and fields differ only for toilets
   edited, added or removed between 00:00 UTC (legacy run) and the new run (compare their
   `updated_at`), or between the two databases if legacy still writes to a different one; CSV
   cells differ only where the formula neutralising above applies. Anything else (a missing
   column, a whole field differing on every row, a large id-set difference) blocks cutover.

## Cutover

1. Once the new files have passed the comparison and the site has cut over to the new client,
   remove the legacy cron (`crons` in the legacy repo's `vercel.json`: `0 0 * * *` ->
   `/api/cron/daily_export`) so the two exports stop running side by side.
2. The legacy Blob files under `exports/` stay reachable at their old URLs. Delete them (Vercel
   dashboard > Storage > Blob, prefix `exports/`) once they are a couple of weeks stale; nothing
   links them after cutover.
3. **Rollback:** the legacy site and its cron keep working until step 1, so rolling the client back
   to legacy brings the legacy page and files back. The new export needs no rollback of its own:
   if a run is bad, fix it and press the button (the archive keeps every earlier day).

## Monitoring and failures

- A **refused** run (empty, or a drop of more than 20%) or a **failed** one (database or R2 error)
  logs `Dataset export refused` / `Dataset export failed` at error level, and the cron event shows
  as an exception. The previous files stay published.
- A run **killed by the platform** logs nothing of its own: the cron event shows `exceededCpu` or
  `exceededMemory`, the manifest keeps the previous day's `date`, and `_state/run.json` has a
  `startedAt` with no `finishedAt`. Cron runs are not retried; press the button after fixing the
  cause.
- After a day without a successful run the page keeps showing the previous day's files and date.
  A quick daily check is `date` in `latest/manifest.json` (step 3 above).

## Cost and limits

| | Per run | Other |
| --- | --- | --- |
| R2 Class A (writes, lists) | about 9: run state x2, archive list, 2 archive files, archive manifest, 2 latest files, latest manifest | none |
| R2 Class B (reads) | 2 (latest manifest, run state) | 1 per `/dataset` page view (not cached), per download or `HEAD`, and per `/admin/loos` view |
| Storage | about 19 MB a day (11.4 MB JSON + 7.9 MB CSV, plus a small manifest) | about 7 GB a year |
| CPU | building the files takes about 0.2 s for 16k rows locally; the full run, Prisma included, a few seconds at most | Paid default limit 30 s |
| Memory | about 40 MB live for 16k rows: the records (about 17 MB) plus the encoded files (about 24 MB), measured in Node | 128 MB per isolate, not configurable |

That is about 270 Class A operations a month against 1 million free, and Class B far inside the
10 million free. Storage passes the 10 GB free tier after about 17 months, then costs
$0.015 per GB-month (about $0.06 a month at 14 GB); egress is free. Add an R2 lifecycle rule on
`archive/` if that ever matters.

Memory is the limit that would bite first as the dataset grows. The job loads rows in pages of
4000, maps them in place and encodes each file straight to bytes a few hundred rows at a time,
instead of holding the full JSON and CSV strings (the first version peaked around 100 MB in the
same measurement). Local `wrangler dev` does not enforce the 128 MB cap, so local runs prove
nothing here: watch for `exceededMemory` on the first production runs.

## Running it locally

The dev config has no bucket, so run the production env locally (R2 is simulated on disk; nothing
remote is touched) and point its Hyperdrive binding at the local database:

```bash
cd apps/toiletmap-server
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://toiletmap_web:toiletmap_web@localhost:54322/postgres \
  pnpm exec wrangler dev --env production --test-scheduled --persist-to .wrangler/state
# in another shell
curl "http://localhost:8787/__scheduled?cron=17+0+*+*+*"
```

The log shows `Dataset export published` with the row count and sizes; a second call shows
`skipped` (`already-published-today`). To serve the files, build the client for production and run
it against the same local state:

```bash
cd apps/toiletmap-client
pnpm build:production
pnpm exec wrangler dev -c dist/server/wrangler.json --port 4322 --persist-to ../toiletmap-server/.wrangler/state
curl -I http://localhost:4322/dataset/latest/toilets.csv
```

Tests use an in-memory R2 fake (`test/integration/utils/r2-fake.ts`):
`test/unit/dataset-export-format.test.ts`, `test/unit/dataset-export-job.test.ts`,
`test/integration/dataset-export.spec.ts` (DB query and `scheduled()`) and
`test/admin/dataset-export.spec.ts` (button, auth, guard).
