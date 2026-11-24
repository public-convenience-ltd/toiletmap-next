# Production deployment

Production deploys automatically on every push to `main` (a merged pull request), via
[`.github/workflows/deploy-production.yml`](../.github/workflows/deploy-production.yml)
("Deploy Production"). It can also be run by hand: Actions, Deploy Production, Run workflow.

## What runs on merge, in order

```
changes ─┐
migrate ─┴─> deploy-server ─> deploy-client ─> smoke
```

| Job | What it does | When it runs |
| --- | --- | --- |
| `changes` | Compares the pushed commit with the commit of the last **successful** run of this workflow on `main` (looked up with the Actions API) to decide which workers changed. | Always. |
| `migrate` | `supabase db push` against the production Supabase project (the commands the old `supabase-migrations-prod.yml` ran). A no-op when no migration is pending. | Always, first, but only from `main`. This is the **only** place production migrations run. |
| `deploy-server` | `pnpm prisma:generate`, `pnpm build:client` (admin UI), then `pnpm run deploy` (`wrangler deploy --env production`) in `apps/toiletmap-server`. | After `migrate` succeeds, when server code changed. |
| `deploy-client` | `pnpm build:production` (`CLOUDFLARE_ENV=production astro build`), the built-asset check, then `wrangler deploy --env production` in `apps/toiletmap-client`. | After `migrate` succeeds and the server deploy succeeded or was skipped, when client code changed. |
| `smoke` | `curl`s the client home page, the server's `/health/ready`, the proximity API through the client (`/api/loos/proximity?lat=51.5072&lng=-0.1276`) and the Flutter app's legacy GraphQL URL through the client (`/api/?query={loosByProximity(...)}`), retrying for about a minute. Fails unless each returns 200, the two API bodies have the expected shape, and the GraphQL response has no `errors`. Not in the `production` environment (it uses no secrets). | After either worker was deployed. |

"Server code changed" means anything under `apps/toiletmap-server/`; "client code changed"
anything under `apps/toiletmap-client/` (blog posts and other Markdown content under its
`src/` and `public/` count). Changes to `packages/`, `apps/toiletmap-design-system/`, the root
`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` or the workflow itself deploy both.
Docs (`docs/`, `apps/*/docs/`), other Markdown, e2e/integration tests and `*.test.ts(x)`
deploy nothing (the migrate job still runs). A manual run, a re-run, or a push that can't be
compared (no earlier successful run, or a force-push that dropped its commit) deploys both
workers.

`migrate`, `deploy-server` and `deploy-client` also check `github.ref == 'refs/heads/main'`, so
"Run workflow" started from another branch deploys nothing. The `production` environment's
main-only deployment branch rule is the hard control; the job conditions are a second one.

Comparing with the last successful run rather than the previous push matters when a run
deployed nothing: one that failed (say the server deploy), or one GitHub cancelled while it
was queued (see below). Its changes are still pending, so the next run picks them up, even
if that next push only touched docs or the other worker.

Why this order: migrations are written to be additive, so the database is migrated before
any code that needs the new schema goes live, and the old code keeps working against it in
between. The server goes before the client because the client calls it. Nothing deploys if
the migration fails, and the client doesn't deploy if the server deploy failed.

Runs are serialised (`concurrency: production`, never cancelled part-way). GitHub keeps
at most one run *waiting* behind the running one: a second merge waits for the first deploy
to finish, but a third merge arriving while the second is still waiting replaces it (the
waiting run is cancelled before it starts). Nothing is lost, because the run that does go
ahead compares with the last successful deploy, so it deploys everything the cancelled run
would have.

**The deploy does not wait for CI.** CI (`ci.yml`) runs on the same push, in parallel. Keep
`main` protected so pull requests can only merge once CI has passed.

### Deploying by hand (what the workflow mirrors)

```bash
make deploy-server   # pnpm --filter toiletmap-server run deploy (wrangler deploy --env production)
make deploy-client   # pnpm --filter toiletmap-client run deploy (build:production + wrangler deploy --env production)
```

`make deploy-server` assumes `pnpm prisma:generate` and `pnpm build:client` have been run in
`apps/toiletmap-server`. Migrations are not part of either: run the workflow, or
`supabase db push` (see [ONBOARDING.md](../ONBOARDING.md#migrations)), first.

## Where secrets live

GitHub (Settings, Secrets and variables, Actions), used only by the steps that need them:

| Secret | Used by |
| --- | --- |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | the two `wrangler deploy` steps (also the preview workflows) |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PRODUCTION_DB_PASSWORD` | the `migrate` step |

They are repository secrets today. Every job that uses them (migrate, deploy-server,
deploy-client) declares `environment: production`, so they can be moved into a protected
**production** environment (Settings, Environments) without editing the workflow: create the
environment, add the four secrets there, delete the repository copies (the preview workflows
still need the Cloudflare ones at repository level), and restrict the environment's deployment
branches to `main`. If you add required reviewers, note that GitHub asks for approval once per
job (migrate, deploy-server, deploy-client). `smoke` has no environment.

Worker secrets (`AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, and the server's Auth0 management
secrets) live on the workers in Cloudflare (`wrangler secret put`). Deploys don't touch them.
Plain vars live in each app's `wrangler.jsonc` (`env.production.vars`); a deploy replaces
any var set in the Cloudflare dashboard with the file's, so change vars in the file.

Both workers' production config binds the dataset export's R2 bucket (`toiletmap-exports`,
`EXPORTS`). Cloudflare rejects a deploy whose bucket doesn't exist, so deploy-server and
deploy-client fail until the owner has created it once:
`pnpm exec wrangler r2 bucket create toiletmap-exports`
(see [the dataset export runbook](../apps/toiletmap-server/docs/operations/dataset-export.md#owner-setup-once)).

Optional **repository** variables (not environment variables: `smoke` has no environment):
`PRODUCTION_CLIENT_URL` and `PRODUCTION_SERVER_URL` override
the smoke check's URLs (defaults: `https://toiletmap-client.gbtoiletmap.workers.dev` and
`https://toiletmap-server.gbtoiletmap.workers.dev`), e.g. once the site moves to its own
domain.

## Rolling back

**Code** (both workers keep their previous versions in Cloudflare):

```bash
# Client first (it depends on the server), then the server if needed.
cd apps/toiletmap-client
pnpm exec wrangler deployments list --name toiletmap-client
pnpm exec wrangler rollback --name toiletmap-client            # or: rollback <version-id>

cd ../toiletmap-server
pnpm exec wrangler deployments list --env production
pnpm exec wrangler rollback --env production                   # or: rollback <version-id>
```

Or use the worker's Deployments tab in the Cloudflare dashboard. A rollback lasts until that
worker is next deployed: the next push to `main` that changes the worker (or a manual run,
which deploys both) deploys `main` again. A push that only touches docs or the other worker
leaves the rollback in place. So also revert the bad commit on `main` (a revert PR); the
revert changes the worker, so it redeploys the fixed code through the normal pipeline.

**Database:** migrations are not rolled back automatically, and rolling back code does not
undo them. Fix forward with a new migration that reverses the change, merged to `main` like
any other. Additive migrations (new tables, columns, indexes) normally need no rollback for
the old code to keep working. For data loss, use Supabase's backups / point-in-time recovery.

## Switching to manual deploys

Edit `.github/workflows/deploy-production.yml` and delete the `push:` trigger, leaving:

```yaml
on:
  workflow_dispatch:
```

Then deploy (migrations included, same order) from Actions, Deploy Production, Run
workflow, with `main` selected. A manual run always deploys both workers. To deploy
without the workflow at all, use `make deploy-server` / `make deploy-client` as above,
running migrations first.

To keep automatic deploys but gate them on CI instead, replace the `push:` trigger with a
`workflow_run` trigger on "CI Checks" (`types: [completed]`, `branches: [main]`) and add
`if: github.event.workflow_run.conclusion == 'success'` to the jobs; the `changes` job
would then also accept `workflow_run` events and diff the last successful deploy against
`github.event.workflow_run.head_sha` instead of `GITHUB_SHA`.

## Previews

`deploy-preview.yml` deploys every pushed branch (except `main` and `postgres-staging`) as
`<branch>-toiletmap-server` and `<branch>-toiletmap-client` (`wrangler deploy --env preview
--name ...`), sets each worker's `AUTH0_CLIENT_ID` and `AUTH0_CLIENT_SECRET` with
`wrangler secret put` (stdin, never `--var`), and comments the URLs on the branch's PR. Secrets
are in the deploy steps only, and only the comment job can write to pull requests. Runs are
serialised per branch (`concurrency: preview-<branch>`, a newer push cancels the older run).

The preview server uses its own rate-limit namespaces (2000-2004, production uses 1000-1004),
so previews never spend production's limits or its Nominatim budget. All previews share them.

`teardown-preview.yml` deletes both preview workers when a pull request from this repository
closes (merged or not, into any base) and when a branch is deleted. It is in the same
concurrency group as the branch's deploys, so it waits for one already running. A worker that
is already gone counts as success; any other `wrangler delete` error fails the run. Workers
left from before this ran on every close (orphans) have to be deleted by hand:
`pnpm exec wrangler delete --name <branch>-toiletmap-server` (and `-client`).

There is no `deploy:preview` script: `wrangler versions upload --env preview` would have
uploaded to the production worker names. Production sets `preview_urls: false`; its
`workers.dev` URLs stay on until the custom-domain cutover.

## Checking the workflows

Every third-party action is pinned to a full commit SHA with its version in a comment
(`uses: actions/checkout@<sha> # v4.4.0`); Renovate keeps the pins and comments up to date
(`pinDigests: true`). CI is read-only (`contents: read`); the other workflows default to no
permissions and each job asks for what it needs. The `Workflow Lint` CI job runs both linters; locally:

```bash
docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.12
docker run --rm -v "$PWD:/repo:ro" --workdir /repo ghcr.io/zizmorcore/zizmor:1.32.0 --offline .github/workflows
```
