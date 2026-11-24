-- Harden database grants and function settings (audit items L13, L14).
--
-- Legacy-compatible: nothing here changes a table, a column, a constraint or a
-- trigger body. The legacy Next.js app and this worker both connect as
-- toiletmap_web and keep every privilege they use: SELECT/INSERT/UPDATE on
-- toilets, SELECT on areas, SELECT/INSERT/DELETE on feedback (+ the id
-- sequence), SELECT/INSERT/UPDATE on pending_change and its existing grants on
-- audit.record_version (UPDATE there is left for the post-cutover tightening).
--
-- 1. L13: the audit schema's SECURITY DEFINER helpers were executable by
--    PUBLIC, so toiletmap_web could run audit.disable_tracking('toilets') and
--    drop the audit triggers as postgres. Nothing in either app calls them;
--    only the migration owner (postgres) needs them. The trigger functions are
--    revoked too: PostgreSQL checks EXECUTE on a trigger function only when a
--    trigger is created, never when it fires.
-- 2. L14: anon and authenticated (Supabase Data API roles, unused by both
--    apps) had GRANT ALL, including TRUNCATE (which bypasses RLS), TRIGGER and
--    REFERENCES, on every table and sequence. Revoked, and the default
--    privileges that would re-grant them on new public tables/sequences are
--    revoked as well. toiletmap_web loses TRIGGER and REFERENCES on toilets,
--    which neither app uses.
-- 3. Advisor function_search_path_mutable: pin search_path on the functions
--    that had none. PostGIS lives in `extensions` (CREATE EXTENSION ... SCHEMA
--    extensions in the initial migration) and is called unqualified by the
--    area trigger (ST_WITHIN, ::geometry), and audit.to_record_id calls
--    uuid_generate_v5 unqualified, so the path is `public, extensions`, never
--    ''. pg_catalog first and pg_temp last stop a caller's temporary objects
--    shadowing catalog tables inside the SECURITY DEFINER functions.
--    ALTER FUNCTION changes only the setting, not the body.
--
-- Rollback (restores the previous state exactly):
--   GRANT EXECUTE ON FUNCTION audit.enable_tracking(regclass) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION audit.disable_tracking(regclass) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION audit.primary_key_columns(oid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION audit.to_record_id(oid, text[], jsonb) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION audit.insert_update_delete_trigger() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION audit.truncate_trigger() TO PUBLIC;
--   GRANT ALL ON TABLE public.toilets, public.areas, public.feedback,
--     public.pending_change TO anon, authenticated;
--   GRANT ALL ON SEQUENCE public.feedback_id_seq TO anon, authenticated;
--   GRANT ALL ON TABLE audit.record_version TO anon, authenticated;
--   GRANT REFERENCES, TRIGGER ON TABLE public.toilets TO toiletmap_web;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT ALL ON TABLES TO anon, authenticated;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT ALL ON SEQUENCES TO anon, authenticated;
--   ALTER FUNCTION audit.primary_key_columns(oid) RESET search_path;
--   ALTER FUNCTION audit.to_record_id(oid, text[], jsonb) RESET search_path;
--   ALTER FUNCTION audit.insert_update_delete_trigger() RESET search_path;
--   ALTER FUNCTION public.determine_area_loo_is_within_on_upsert() RESET search_path;

-- 1. Audit functions: owner only.
REVOKE EXECUTE ON FUNCTION audit.enable_tracking(regclass) FROM PUBLIC, anon, authenticated, toiletmap_web;
REVOKE EXECUTE ON FUNCTION audit.disable_tracking(regclass) FROM PUBLIC, anon, authenticated, toiletmap_web;
REVOKE EXECUTE ON FUNCTION audit.primary_key_columns(oid) FROM PUBLIC, anon, authenticated, toiletmap_web;
REVOKE EXECUTE ON FUNCTION audit.to_record_id(oid, text[], jsonb) FROM PUBLIC, anon, authenticated, toiletmap_web;
REVOKE EXECUTE ON FUNCTION audit.insert_update_delete_trigger() FROM PUBLIC, anon, authenticated, toiletmap_web;
REVOKE EXECUTE ON FUNCTION audit.truncate_trigger() FROM PUBLIC, anon, authenticated, toiletmap_web;

-- 2. Data API roles: no table or sequence access.
REVOKE ALL ON TABLE public.toilets, public.areas, public.feedback, public.pending_change
  FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.feedback_id_seq FROM anon, authenticated;
REVOKE ALL ON TABLE audit.record_version FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- toiletmap_web: drop the privileges neither app uses.
REVOKE REFERENCES, TRIGGER ON TABLE public.toilets FROM toiletmap_web;

-- 3. Fixed search_path.
ALTER FUNCTION audit.primary_key_columns(oid)
  SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION audit.to_record_id(oid, text[], jsonb)
  SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION audit.insert_update_delete_trigger()
  SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.determine_area_loo_is_within_on_upsert()
  SET search_path = pg_catalog, public, extensions, pg_temp;

-- 4. Fail the migration unless the end state holds. A REVOKE by a role that
--    neither owns the object nor granted the privilege only raises a WARNING
--    ("no privileges could be revoked") and succeeds, so an ownership mismatch
--    on a remote database would otherwise leave the old grants in place
--    silently. The search_path checks prove that the pinned path still finds
--    uuid_generate_v5 (audit.to_record_id, run by every toilets write) and
--    PostGIS (area trigger) before any app write depends on it.
DO $verify$
DECLARE
  fn text;
  tbl text;
  role_name text;
  priv text;
  failures text[] := array[]::text[];
  pinned constant text := 'search_path=pg_catalog, public, extensions, pg_temp';
BEGIN
  FOREACH fn IN ARRAY array[
    'audit.enable_tracking(regclass)',
    'audit.disable_tracking(regclass)',
    'audit.primary_key_columns(oid)',
    'audit.to_record_id(oid, text[], jsonb)',
    'audit.insert_update_delete_trigger()',
    'audit.truncate_trigger()'
  ] LOOP
    FOREACH role_name IN ARRAY array['public', 'anon', 'authenticated', 'toiletmap_web'] LOOP
      IF has_function_privilege(role_name, fn, 'EXECUTE') THEN
        failures := failures || format('%s can still EXECUTE %s', role_name, fn);
      END IF;
    END LOOP;
  END LOOP;

  FOREACH tbl IN ARRAY array[
    'public.toilets', 'public.areas', 'public.feedback', 'public.pending_change',
    'audit.record_version'
  ] LOOP
    FOREACH role_name IN ARRAY array['anon', 'authenticated'] LOOP
      FOREACH priv IN ARRAY array[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ] LOOP
        IF has_table_privilege(role_name, tbl, priv) THEN
          failures := failures || format('%s still has %s on %s', role_name, priv, tbl);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  FOREACH role_name IN ARRAY array['anon', 'authenticated'] LOOP
    FOREACH priv IN ARRAY array['USAGE', 'SELECT', 'UPDATE'] LOOP
      IF has_sequence_privilege(role_name, 'public.feedback_id_seq', priv) THEN
        failures := failures || format('%s still has %s on public.feedback_id_seq', role_name, priv);
      END IF;
    END LOOP;
  END LOOP;

  FOREACH priv IN ARRAY array['REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('toiletmap_web', 'public.toilets', priv) THEN
      failures := failures || format('toiletmap_web still has %s on public.toilets', priv);
    END IF;
  END LOOP;

  FOREACH fn IN ARRAY array[
    'audit.primary_key_columns(oid)',
    'audit.to_record_id(oid, text[], jsonb)',
    'audit.insert_update_delete_trigger()',
    'public.determine_area_loo_is_within_on_upsert()'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc WHERE oid = fn::regprocedure AND proconfig = array[pinned]
    ) THEN
      failures := failures || format('%s does not have %s', fn, pinned);
    END IF;
  END LOOP;

  -- The functions the pinned path must resolve, in the schemas it searches.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.proname = 'uuid_generate_v5'
      AND p.pronamespace IN ('public'::regnamespace, 'extensions'::regnamespace)
  ) THEN
    failures := failures || 'uuid_generate_v5 (uuid-ossp) is not in public or extensions';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.proname = 'st_within'
      AND p.pronamespace IN ('public'::regnamespace, 'extensions'::regnamespace)
  ) THEN
    failures := failures || 'st_within (PostGIS) is not in public or extensions';
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'harden_grants_and_functions did not reach its end state: %',
      array_to_string(failures, '; ');
  END IF;

  -- Run the audit id function on its pinned path, as the audit trigger does.
  IF audit.to_record_id('public.toilets'::regclass, array['id'], '{"id": "probe"}'::jsonb) IS NULL THEN
    RAISE EXCEPTION 'audit.to_record_id returned NULL on its pinned search_path';
  END IF;
END
$verify$;
