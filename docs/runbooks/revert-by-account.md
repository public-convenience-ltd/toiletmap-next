# Runbook: revert one account's changes since a time

For a vandal or a broken script that wrote through a signed-in account, before the admin UI
has a "revert all" button. It undoes every toilet change the account made since a time `T`,
using the private `toilets.updated_by_sub` (the Auth0 sub behind each write) as recorded in
the audit history (`audit.record_version`).

SQL: [`sql/revert-by-account.sql`](sql/revert-by-account.sql). Rehearsed by
`apps/toiletmap-server/test/integration/runbooks.spec.ts`; rehearse it on staging before
the first production use.

## What it does

For each toilet the account changed at or after `T`:

| The toilet | Action |
| --- | --- |
| Edited, moved, removed or restored by the account | Every user-editable column (name, notes, facilities, opening times, location, `active`, removal category, reason and duplicate link, `verified_at`) goes back to the row **just before the account's first change since `T`**. |
| Added by the account | Taken off the map (`active=false`, category `other`); never deleted, so it can be restored. |
| Changed by **anyone else** after the account's first change (another account, the legacy app, an operator) | **Skipped** and listed with `edited_by_others = t`. Fix these by hand in `/admin/loos/<id>`: the history there shows each version. A verify ("Yes, it's still here", which sets only `verified_at`) by anyone does not count, so the toilet is still reverted. |

It also rejects the account's pending changes (`pending_change.submitter_sub`). Every revert
bumps `updated_at` (map clients pick it up through `/api/loos/updates`) and is attributed to
`ops:revert-by-account` in `updated_by_sub`.

Limits: changes the legacy app made (no sub) and anonymous changes are not covered: an
anonymous change only reaches the map through a moderator, so reject those in the queue.
Writes made before `toiletmap.updated_by_sub` existed (migration `20261125000000`) carry no
sub either.

## Steps

1. **Contain.** Block the account in the Auth0 dashboard (Users, the user, Block). If the
   damage is still spreading or more accounts are involved, set `write_mode` to `queue` or
   `read-only` first ([kill-switch.md](kill-switch.md)).
2. **Find the sub and `T`.** The sub is in `/admin/pending` (submitter) or in the Auth0
   dashboard (`user_id`, such as `auth0|...` or `google-oauth2|...`). Pick `T` a little
   before the first bad change; to see the account's changes, run in the SQL editor:

   ```sql
   SELECT rv.ts, rv.op, rv.record ->> 'id' AS loo_id
   FROM audit.record_version rv
   WHERE rv.record ->> 'updated_by_sub' = 'auth0|REPLACE_ME'
     AND rv.ts >= now() - interval '7 days'
     AND rv.table_name = 'toilets'
   ORDER BY rv.id;
   ```

3. **Connect.** Use `psql` with the production database's direct connection string
   (Supabase dashboard, Project Settings, Database; the `postgres` role), in a shell that
   does not log it. The script uses `psql` variables, so the Supabase SQL editor cannot run
   it as is.
4. **Dry run.** Nothing is changed (it ends with `ROLLBACK`):

   ```bash
   psql "$DB_URL" -v sub='auth0|REPLACE_ME' -v since='2026-11-24 18:00:00+00' \
     -f docs/runbooks/sql/revert-by-account.sql
   ```

   Read the plan: one row per toilet with its action, and the name, `active` and location
   now and before. Then the three `UPDATE n` lines say how many toilets would be restored,
   how many added toilets would be removed, and how many pending changes rejected. Check a
   few toilets against `/admin/loos/<id>`.
5. **Apply.** The same command with `-v apply=1` (it ends with `COMMIT`). The plan it prints
   is computed again at that moment.
6. **Check.** Open a few reverted toilets on the site and in `/admin/loos/<id>`; fix the
   `edited_by_others` rows by hand; set `write_mode` back to `open` if you changed it.
7. **Record** what happened (sub, `T`, counts, who ran it) in the incident notes.

## Undo a revert

Every revert is itself a version in the history, attributed to `ops:revert-by-account`, so
the same script undoes it: run it with `-v sub='ops:revert-by-account'` and `since` just
before the revert. Dry-run first.
