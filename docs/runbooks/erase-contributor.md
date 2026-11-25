# Runbook: erase (pseudonymise) one contributor

For a right-to-erasure request from someone who contributed under a handle, before the admin
UI has an erase action. The person's handle is replaced with a pseudonym everywhere the app
stores contributor names, and their Auth0 sub is cleared. The toilet data they contributed
stays (it is about public facilities, not about them); only who contributed it is erased.

SQL: [`sql/erase-contributor.sql`](sql/erase-contributor.sql). Rehearsed by
`apps/toiletmap-server/test/integration/runbooks.spec.ts`; rehearse it on staging before
the first production use.

## Deadlines (UK GDPR, Articles 12 and 17)

- Answer **without undue delay and within one month** of receiving the request. You may
  extend by up to two further months for a complex request, but must tell the person
  within the first month, with the reason.
- Check who is asking (for example, a reply from the email on their Auth0 account) before
  erasing anything, and do not ask for more information than that needs.
- Record the request, the date received, what was erased and when, and the reply. Keep that
  record without the erased handle (use the pseudonym).
- Backups: Supabase backups (and point-in-time recovery, if enabled) still hold the old rows
  until they age out. Tell the person how long that is, keep the backups "beyond use" (never
  restore them to answer queries), and re-run this runbook after any restore.

Legal advice is outside this runbook: if a request is disputed, or covers more than
contributions (feedback messages, emails), ask the data protection lead before acting.

## What it changes

| Where | Change |
| --- | --- |
| `toilets.contributors` | `handle` replaced by `pseudonym`. |
| `toilets.updated_by_sub` | Cleared where it is the person's sub; every other toilet keeps the sub of its latest write. |
| `audit.record_version` (history) | `handle` replaced in the `contributors` arrays of every snapshot (`record` and `old_record`); the person's sub set to null in `updated_by_sub`. |
| `pending_change` | `submitted_by` = `handle` becomes `pseudonym`; `submitter_sub` = the person's sub becomes null. |

It does not change `updated_at`, so map clients are not asked to re-download anything (the
map never shows contributors). The rewrite of `toilets` adds history rows of its own; they
are scrubbed in the same transaction.

Not covered, check by hand (step 4): free text that names the person (notes, removal
reasons, pending payloads), the `feedback` table (emails and messages), `reviewed_by` if the
person was a moderator, and anything outside this database (Auth0, Slack, email).

## Steps

1. **Find the handle and sub.** The handle is the name shown as contributor in
   `/admin/loos/<id>` history or `/admin/users/statistics`. The sub is the Auth0 `user_id`
   (Auth0 dashboard, Users). If there is no Auth0 account (a legacy-only contributor), pass
   `-v sub=''`.
2. **Pick a pseudonym**, unique and meaningless, for example:

   ```bash
   echo "erased-$(openssl rand -hex 4)"
   ```

3. **Connect** with `psql` and the production database's direct connection string
   (`postgres` role), in a shell that does not log it.
4. **Look for free text** that names the person, and decide with the requester what to do
   with it (edit those toilets in `/admin/loos/<id>` afterwards):

   ```sql
   SELECT id, name, notes, removal_reason FROM public.toilets
   WHERE notes ILIKE '%Their Name%' OR removal_reason ILIKE '%Their Name%';
   SELECT id, submitted_at FROM public.pending_change WHERE payload::text ILIKE '%Their Name%';
   SELECT id, created_at FROM public.feedback
   WHERE email ILIKE '%their@email%' OR feedback_text ILIKE '%Their Name%';
   ```

5. **Dry run.** Nothing is changed (it ends with `ROLLBACK`):

   ```bash
   psql "$DB_URL" -v handle='Their Name' -v pseudonym='erased-1a2b3c4d' \
     -v sub='auth0|REPLACE_ME' -f docs/runbooks/sql/erase-contributor.sql
   ```

   The first table counts what matches; the last one counts what would remain, and must be
   all zeros. A handle is matched exactly (case and spaces included): check the count is
   what you expect, and that the handle is not shared with someone else (a common name, or
   a legacy contributor).
6. **Apply** with the same command plus `-v apply=1` (it ends with `COMMIT`).
7. **Outside the database:** delete the user in Auth0 (Users, the user, Delete), delete
   their feedback in `/admin/feedback` if it is in scope, and remove any Slack or email
   threads that name them.
8. **Reply** to the person and record the erasure (see Deadlines).
