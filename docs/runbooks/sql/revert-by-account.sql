-- Revert one account's toilet changes since a time (runbook: ../revert-by-account.md).
--
-- Dry run (the default; prints the plan and what would change, then ROLLBACK):
--   psql "$DB_URL" -v sub='auth0|0123456789abcdef' -v since='2026-11-24 18:00:00+00' \
--     -f docs/runbooks/sql/revert-by-account.sql
-- Apply (same, plus -v apply=1, which COMMITs):
--   psql "$DB_URL" -v sub='...' -v since='...' -v apply=1 -f docs/runbooks/sql/revert-by-account.sql
--
-- For every toilet the account (`toilets.updated_by_sub`, as recorded in
-- audit.record_version) changed at or after `since`:
-- - edited: restored to the row as it was just before the account's first
--   change in the window (all user-editable columns, location included);
-- - added by the account: taken off the map (category `other`), never deleted;
-- - changed by anyone else (another account, an anonymous verify, the legacy
--   app or an operator) after the account's first change: SKIPPED, listed
--   with edited_by_others = true for a moderator to fix by hand.
-- The account's pending changes are rejected. Every write here bumps
-- updated_at, so map clients pick the reverts up through /api/loos/updates,
-- and is attributed to `ops:revert-by-account` in updated_by_sub.
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE revert_plan ON COMMIT DROP AS
WITH account_rows AS (
  SELECT rv.id, rv.op, rv.record ->> 'id' AS loo_id, rv.old_record
  FROM audit.record_version rv
  WHERE rv.record ->> 'updated_by_sub' = :'sub'
    AND rv.ts >= :'since'::timestamptz
    AND rv.table_name = 'toilets'
    AND rv.op IN ('INSERT', 'UPDATE')
),
first_change AS (
  -- record_version ids follow commit order; ts is each transaction's start.
  SELECT DISTINCT ON (loo_id)
    loo_id, id AS first_version_id, op AS first_op, old_record AS restore_to
  FROM account_rows
  ORDER BY loo_id, id
),
later_by_others AS (
  SELECT DISTINCT f.loo_id
  FROM first_change f
  JOIN audit.record_version rv
    ON rv.record ->> 'id' = f.loo_id
   AND rv.id > f.first_version_id
   AND rv.ts >= :'since'::timestamptz - interval '1 hour'
   AND rv.table_name = 'toilets'
  WHERE rv.record ->> 'updated_by_sub' IS DISTINCT FROM :'sub'
)
SELECT f.loo_id, f.first_version_id, f.first_op, f.restore_to,
       (o.loo_id IS NOT NULL) AS edited_by_others
FROM first_change f
LEFT JOIN later_by_others o USING (loo_id);

-- The plan: every toilet the account touched, and what it goes back to.
SELECT p.loo_id,
       p.first_op,
       p.edited_by_others,
       CASE
         WHEN p.edited_by_others THEN 'SKIP: changed by someone else since; fix by hand'
         WHEN p.first_op = 'INSERT' THEN 'remove from the map (added by this account)'
         ELSE 'restore to the version before the account''s first change'
       END AS action,
       t.name AS name_now, p.restore_to ->> 'name' AS name_before,
       t.active AS active_now, (p.restore_to ->> 'active')::boolean AS active_before,
       t.location AS location_now, p.restore_to -> 'location' AS location_before
FROM revert_plan p
JOIN public.toilets t ON t.id = p.loo_id
ORDER BY p.edited_by_others DESC, p.first_op, p.loo_id;

SELECT set_config('toiletmap.actor_sub', 'ops:revert-by-account', true) AS attributed_to;

-- Edited by the account: put every user-editable column back.
UPDATE public.toilets t
SET name = o.name,
    notes = o.notes,
    payment_details = o.payment_details,
    accessible = o.accessible,
    active = o.active,
    attended = o.attended,
    automatic = o.automatic,
    baby_change = o.baby_change,
    men = o.men,
    women = o.women,
    no_payment = o.no_payment,
    radar = o.radar,
    urinal_only = o.urinal_only,
    all_gender = o.all_gender,
    children = o.children,
    opening_times = o.opening_times,
    geography = o.geography,
    removal_reason = o.removal_reason,
    removal_category = o.removal_category,
    duplicate_of = o.duplicate_of,
    verified_at = o.verified_at,
    updated_at = now()
FROM revert_plan p
CROSS JOIN LATERAL jsonb_populate_record(NULL::public.toilets, p.restore_to) o
WHERE t.id = p.loo_id
  AND p.first_op = 'UPDATE'
  AND NOT p.edited_by_others;

-- Added by the account: take it off the map (kept, so it can be restored).
UPDATE public.toilets t
SET active = false,
    removal_category = 'other',
    removal_reason = 'Removed when the changes of the account that added it were reverted.',
    updated_at = now()
FROM revert_plan p
WHERE t.id = p.loo_id
  AND p.first_op = 'INSERT'
  AND NOT p.edited_by_others
  AND t.active IS TRUE;

-- The account's changes still waiting for a moderator.
UPDATE public.pending_change
SET status = 'rejected',
    reviewed_by = 'ops:revert-by-account',
    reviewed_at = now()
WHERE submitter_sub = :'sub'
  AND status = 'pending';

\if :{?apply}
COMMIT;
\else
ROLLBACK;
\echo 'Dry run: nothing was changed. Re-run with -v apply=1 to apply.'
\endif
