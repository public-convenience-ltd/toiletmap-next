-- Pseudonymise one contributor (runbook: ../erase-contributor.md).
--
-- Dry run (the default; prints what matches and what would remain, then ROLLBACK):
--   psql "$DB_URL" -v handle='Their Name' -v pseudonym='erased-1a2b3c4d' -v sub='auth0|0123456789abcdef' \
--     -f docs/runbooks/sql/erase-contributor.sql
-- Apply (same, plus -v apply=1, which COMMITs). Pass -v sub='' when the
-- Auth0 account is unknown (only the handle is then replaced).
--
-- Replaces the contributor name `handle` with `pseudonym` in:
-- - toilets.contributors;
-- - audit.record_version (record and old_record `contributors` arrays);
-- - pending_change.submitted_by;
-- and, when `sub` is given, clears that Auth0 sub from toilets.updated_by_sub,
-- the record_version snapshots (`updated_by_sub` becomes null) and
-- pending_change.submitter_sub. Each toilet keeps the updated_by_sub of its
-- latest write unless that is the erased sub. updated_at is not changed (the
-- map does not show contributors). Free text (notes, removal reasons,
-- pending payloads, feedback) is not searched here: see the runbook.
\set ON_ERROR_STOP on

BEGIN;

SELECT set_config('runbook.handle', :'handle', true) AS handle,
       set_config('runbook.pseudonym', :'pseudonym', true) AS pseudonym,
       set_config('runbook.sub', :'sub', true) AS sub;

DO $$
BEGIN
  IF btrim(current_setting('runbook.handle')) = '' THEN
    RAISE EXCEPTION 'handle is empty';
  END IF;
  IF btrim(current_setting('runbook.pseudonym')) = ''
     OR current_setting('runbook.pseudonym') = current_setting('runbook.handle') THEN
    RAISE EXCEPTION 'pseudonym must be non-empty and different from the handle';
  END IF;
END $$;

-- What matches before the change.
SELECT 'toilets.contributors' AS place, count(*) AS rows
FROM public.toilets WHERE :'handle' = ANY (contributors)
UNION ALL
SELECT 'toilets.updated_by_sub', count(*)
FROM public.toilets WHERE :'sub' <> '' AND updated_by_sub = :'sub'
UNION ALL
SELECT 'record_version (contributors)', count(*)
FROM audit.record_version
WHERE table_name = 'toilets'
  AND (record -> 'contributors' ? :'handle' OR old_record -> 'contributors' ? :'handle')
UNION ALL
SELECT 'record_version (updated_by_sub)', count(*)
FROM audit.record_version
WHERE :'sub' <> '' AND table_name = 'toilets'
  AND (record ->> 'updated_by_sub' = :'sub' OR old_record ->> 'updated_by_sub' = :'sub')
UNION ALL
SELECT 'pending_change', count(*)
FROM public.pending_change
WHERE submitted_by = :'handle' OR (:'sub' <> '' AND submitter_sub = :'sub');

-- 1. toilets: replace the handle, and clear the erased sub. The trigger
-- toilets_set_updated_by_sub sets updated_by_sub from toiletmap.actor_sub on
-- every UPDATE, so rows are updated in groups by their current sub, with the
-- setting set to that sub (or '' = NULL for the erased one).
DO $$
DECLARE
  h text := current_setting('runbook.handle');
  p text := current_setting('runbook.pseudonym');
  s text := current_setting('runbook.sub');
  owner text;
BEGIN
  FOR owner IN
    SELECT DISTINCT updated_by_sub FROM public.toilets
    WHERE h = ANY (contributors) OR (s <> '' AND updated_by_sub = s)
  LOOP
    PERFORM set_config(
      'toiletmap.actor_sub',
      CASE WHEN owner IS NULL OR (s <> '' AND owner = s) THEN '' ELSE owner END,
      true
    );
    UPDATE public.toilets
    SET contributors = array_replace(contributors, h, p)
    WHERE updated_by_sub IS NOT DISTINCT FROM owner
      AND (h = ANY (contributors) OR (s <> '' AND updated_by_sub = s));
  END LOOP;
  PERFORM set_config('toiletmap.actor_sub', '', true);
END $$;

-- 2. History snapshots (after step 1, which itself added snapshots holding the
-- old values).
UPDATE audit.record_version rv
SET record = CASE
      WHEN rv.record -> 'contributors' ? :'handle' THEN jsonb_set(
        rv.record, '{contributors}',
        (SELECT jsonb_agg(CASE WHEN e = to_jsonb(:'handle'::text) THEN to_jsonb(:'pseudonym'::text) ELSE e END)
         FROM jsonb_array_elements(rv.record -> 'contributors') e))
      ELSE rv.record
    END,
    old_record = CASE
      WHEN rv.old_record -> 'contributors' ? :'handle' THEN jsonb_set(
        rv.old_record, '{contributors}',
        (SELECT jsonb_agg(CASE WHEN e = to_jsonb(:'handle'::text) THEN to_jsonb(:'pseudonym'::text) ELSE e END)
         FROM jsonb_array_elements(rv.old_record -> 'contributors') e))
      ELSE rv.old_record
    END
WHERE rv.table_name = 'toilets'
  AND (rv.record -> 'contributors' ? :'handle' OR rv.old_record -> 'contributors' ? :'handle');

UPDATE audit.record_version rv
SET record = CASE
      WHEN rv.record ->> 'updated_by_sub' = :'sub'
        THEN jsonb_set(rv.record, '{updated_by_sub}', 'null'::jsonb)
      ELSE rv.record
    END,
    old_record = CASE
      WHEN rv.old_record ->> 'updated_by_sub' = :'sub'
        THEN jsonb_set(rv.old_record, '{updated_by_sub}', 'null'::jsonb)
      ELSE rv.old_record
    END
WHERE :'sub' <> ''
  AND rv.table_name = 'toilets'
  AND (rv.record ->> 'updated_by_sub' = :'sub' OR rv.old_record ->> 'updated_by_sub' = :'sub');

-- 3. The moderation queue.
UPDATE public.pending_change
SET submitted_by = CASE WHEN submitted_by = :'handle' THEN :'pseudonym' ELSE submitted_by END,
    submitter_sub = CASE WHEN :'sub' <> '' AND submitter_sub = :'sub' THEN NULL ELSE submitter_sub END
WHERE submitted_by = :'handle' OR (:'sub' <> '' AND submitter_sub = :'sub');

-- What still matches: every count should be 0.
SELECT 'toilets' AS place, count(*) AS remaining
FROM public.toilets
WHERE :'handle' = ANY (contributors) OR (:'sub' <> '' AND updated_by_sub = :'sub')
UNION ALL
SELECT 'record_version', count(*)
FROM audit.record_version
WHERE table_name = 'toilets'
  AND (record -> 'contributors' ? :'handle' OR old_record -> 'contributors' ? :'handle'
       OR (:'sub' <> '' AND (record ->> 'updated_by_sub' = :'sub'
                             OR old_record ->> 'updated_by_sub' = :'sub')))
UNION ALL
SELECT 'pending_change', count(*)
FROM public.pending_change
WHERE submitted_by = :'handle' OR (:'sub' <> '' AND submitter_sub = :'sub');

\if :{?apply}
COMMIT;
\else
ROLLBACK;
\echo 'Dry run: nothing was changed. Re-run with -v apply=1 to apply.'
\endif
