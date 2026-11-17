# Client end-to-end tests (Playwright)

Browser tests for the Astro client, run against the real local stack:

| Piece | Where | Started by |
| --- | --- | --- |
| Postgres + PostGIS (Supabase) | `127.0.0.1:54322` | **you** (never started by Playwright) |
| Mock Auth0 (`scripts/start-auth-server.ts`) | `http://127.0.0.1:44555` | Playwright (`pnpm --filter toiletmap-server auth:server`) |
| toiletmap-server (wrangler dev) | `http://localhost:8787` | Playwright (`build:client`, then `dev:server`, in `toiletmap-server`) |
| Client (`astro dev`) | `http://localhost:4321` | Playwright, configured by `e2e/wrangler.e2e.jsonc` |

## Run locally

Prerequisites (once):

```bash
pnpm install
pnpm --filter toiletmap-server prisma:generate
cd apps/toiletmap-client && pnpm exec playwright install chromium webkit
```

Start the database if it is not already running (Docker must be running):

```bash
cd apps/toiletmap-server && pnpm supabase:start   # applies migrations + seed.sql
```

Then, from `apps/toiletmap-client`:

```bash
pnpm exec playwright test                          # all projects
pnpm exec playwright test --project=desktop-chromium
pnpm exec playwright test edit.spec.ts --headed
pnpm exec playwright show-report                   # after a run
```

Playwright starts the mock auth server, the server and the client and stops
them afterwards. The server's `pnpm dev` script runs all of the server pieces
under `concurrently`, which carries on when wrangler exits, so Playwright runs
them separately instead (see [Logs and restarts](#logs-and-restarts)). Whatever is already running
is reused, each piece on its own (a `pnpm --filter toiletmap-server dev` you
started covers the first two), with one caveat that the global setup checks for
and explains:

- the client must use `e2e/wrangler.e2e.jsonc`. A plain `pnpm dev` / `astro dev`
  reads `wrangler.jsonc` + your `.dev.vars` and may point at real Auth0. Stop it
  (`pnpm exec astro dev stop`), or start it the way the config does:

  ```bash
  CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH=e2e/wrangler.e2e.jsonc ASTRO_DEV_BACKGROUND=1 \
    ASTRO_DEV_TOOLBAR=off pnpm exec astro dev --port 4321
  ```

The server must start before the client. Both use the workerd inspector on
port 9229: wrangler fails if that port is taken, while the client's Vite plugin
falls back to another port. Playwright starts them in that order.

`ASTRO_DEV_BACKGROUND=1` stops Astro 7 from detaching `astro dev` into the
background, which it does when it detects an AI coding agent. `ASTRO_DEV_TOOLBAR=off`
(read by `astro.config.mjs`) hides Astro's dev toolbar, which would otherwise sit over
the map's details sheet at the bottom of phone-sized screens and take its taps.

Environment overrides: `E2E_DATABASE_URL` (default
`postgresql://postgres:postgres@127.0.0.1:54322/postgres`), `E2E_CLIENT_URL`,
`E2E_SERVER_URL`, `E2E_AUTH_URL`.

## Run in CI

The job needs the same pieces. The equivalent steps are:

```yaml
- uses: supabase/setup-cli@v1
  with: { version: 2.122.1 }
- run: supabase start --exclude gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
  working-directory: apps/toiletmap-server
- run: pnpm install --frozen-lockfile
- run: pnpm --filter toiletmap-server prisma:generate
- run: pnpm exec playwright install --with-deps chromium webkit
  working-directory: apps/toiletmap-client
- run: pnpm exec playwright test
  working-directory: apps/toiletmap-client
  env: { CI: "true" }
- uses: actions/upload-artifact@v4
  if: always() # also after a failure, cancellation or timeout
  with:
    name: playwright-report
    path: |
      apps/toiletmap-client/playwright-report
      apps/toiletmap-client/test-results
      apps/toiletmap-client/e2e/.logs
    include-hidden-files: true # e2e/.logs is a dot folder
    if-no-files-found: ignore
```

The `e2e` job in `.github/workflows/ci.yml` does this, and also caches
`~/.cache/ms-playwright` keyed on the installed `@playwright/test` version
(running only `playwright install-deps` on a cache hit).

With `CI` set, Playwright never reuses running servers. It also uses 2 workers
and 1 retry, records traces on retry, and adds the GitHub annotations reporter.
The whole run is capped at 20 minutes (`globalTimeout`), so a hung run stops and
writes its report before the job's 30-minute `timeout-minutes` kills it; the
upload step runs `if: always()`, so the report and logs are uploaded either way.

## Logs and restarts

Playwright runs each web server through `e2e/support/log-web-server.ts`, which
writes its stdout and stderr, with a timestamp on each line, to
`e2e/.logs/auth.log`, `e2e/.logs/server.log` and `e2e/.logs/client.log` (stderr
is also printed). Wrangler's own debug-level logs (server, and the client's
Cloudflare Vite plugin) go to `e2e/.logs/wrangler/` via `WRANGLER_LOG_PATH`, one
file per start; when wrangler dev dies it names the file in `server.log`. The
`.log` files are overwritten by each run, the wrangler files accumulate locally
(delete the folder whenever you like), and nothing is written for servers that
Playwright reuses.

The same wrapper restarts a server that exits mid-run without being asked to
stop: wrangler dev 4.120 occasionally exits ("ProxyController ... Network
connection lost") and would otherwise fail every later test. It waits 1s, 2s, …
before restart 1, 2, …, gives up after 5 restarts, and first kills whatever the
dead process left behind in its process group (workerd keeps holding :8787 when
wrangler is killed). Each restart is written to the log and printed as
`[log-web-server] exited unexpectedly (…); restart n of 5 …`. Tests that run
during the few seconds of a restart can fail; in CI their retry normally passes.
This is why the auth server runs separately from wrangler: it makes new signing
keys on every start, so restarting it would sign every worker out. CI uploads them with the report, also when the run passed,
so a server that dropped out in an attempt that was then retried can still be
investigated.

## Projects

| Project | Device | Specs |
| --- | --- | --- |
| `desktop-chromium` | Desktop Chrome 1280×720 | all |
| `mobile-chromium` | Pixel 7 | `map`, `edit`, `layout`, `freshness`, `picker`, `report`, `panel` |
| `mobile-webkit` | iPhone 13 | `map`, `edit`, `layout`, `freshness`, `picker`, `report`, `panel` |
| `mobile-landscape` | Pixel 7 landscape (863×360) | `panel`, `layout` |

## How the tests work

**Signing in.** `authedTest` (in `support/fixtures.ts`) signs in once per worker
and reuses the cookies.

- On Chromium it uses the real flow: `/auth/login` → the mock Auth0 login page →
  "Continue as Test User" → `/auth/callback`.
- WebKit refuses `Secure` cookies on `http://localhost`, so the real flow cannot
  finish there: the `auth_state` cookie is dropped and the callback returns 400.
  Instead, the WebKit projects inject the same `access_token` (httpOnly) and
  `user_info` cookies, built from a token issued by the mock server, without
  `Secure`.

**Who writes directly.** The server applies a write (edit, add, report, restore)
straight away only for tokens with `report:loo` or `access:admin`; everyone else
is queued as a `pending_change` (202). The mock "Test User" has both, so
`authedTest` and the `loos` fixture write directly. `untrustedTest` signs in as
`UNTRUSTED_USER` (`support/api.ts`, no permissions) by injecting its cookies, so
its writes are queued like an anonymous user's; plain `test` is signed out.

**Forms.** Every save goes through the review sheet ("Confirm and save"):
`looForm(page).submit()` clicks both. The location picker has no lat/lng boxes:
`enterCoordinates` (in `support/form.ts`) types into its "Enter coordinates"
box and confirms with "Use this location".

**Test data.** Tests never modify seed rows; the map tests only read the London
seed rows shown in the default view.

- Every test that writes creates its own toilets through the API, as the mock
  "Test User", using the `loos` fixture. These toilets are named `[e2e <run id>] …`
  and placed at random spots in the Midlands, away from the default map view.
- The fixture deletes those toilets after each test, together with their
  `pending_change` and audit rows, by connecting to the database directly
  (`apps/toiletmap-server/scripts/e2e-db.ts`).
- The global setup also sweeps `[e2e …]` rows left behind by aborted runs
  (`db-sweep.spec.ts` covers it). Several runs may share the database, so it
  skips the current run's rows (`E2E_RUN_ID`) and rows of any run that started
  less than an hour ago (decoded from the base-36 run id in the name, or the
  row's timestamp when there is none); a recently aborted run is cleaned up by
  the first run an hour later. To sweep by hand (`--all` also removes recent
  rows; use it only when no run is in progress):

  ```bash
  pnpm --filter toiletmap-server exec tsx scripts/e2e-db.ts sweep [--all]
  ```

**Map tiles.** OpenStreetMap tile requests are stubbed with a blank PNG.

**Map data freshness.** `freshness.spec.ts` covers the Phase 2 caching: the
`?saved=1` banner after a save, a second browser with a warm IndexedDB cache
picking up an edit or a deactivation, the cached map when syncing fails, and
Back/Forward with the details panel. Instead of waiting for the 60s poll it
triggers a sync the way returning to the tab does (a `visibilitychange`
event, `triggerMapSync` in `support/map.ts`), and reads the cache record
(`loos-cache-v2`) straight from IndexedDB (`readMapCache`). After a signed-in
save, use `waitForSaved` (`support/form.ts`): it waits for the redirect to
`/loos/<id>?saved=1`, the banner, and the param being stripped.

**Details panel and phone layout.** `panel.spec.ts` covers the Phase 4 panel on
every project: a marker tap or deep link opens the summary (at most 30% of a
phone screen, with the map still draggable around it), Details expands it (at
most 60% of the map on phones, scrolling inside; a card of at most 400px on the
left on desktop), Escape and Close collapse then close, focus moves to the
heading and back to the marker, and the selected marker's box never touches the
panel or a floating control (`[data-map-control]`). Deep links open the
summary, so tests that use the verify / edit / report actions call
`expandDetails` (`support/map.ts`) first. On a phone in landscape
(`mobile-landscape`: wide enough for the card, but short) a toilet with notices
keeps Directions reachable by scrolling the card, its marker clear of the card,
and the page free of horizontal overflow. `layout.spec.ts` checks that the
floating controls don't overlap at 360px and 430px, that map pages hide the
footer below 768px (its links are in the menu drawer), that Escape in that
menu closes the menu but not an open toilet, and the viewport meta. Its "page
shell" tests check the computed body / main overflow and height (map pages fill
the viewport and never scroll; form pages scroll the document), and its
safe-area tests stub `--safe-top` / `--safe-bottom` to check the map's floating
controls don't add an inset the header or footer already pads.

## Known failures

Known app bugs are kept as `test.fixme` with the reason. Search the specs for
`fixme` to find them.
