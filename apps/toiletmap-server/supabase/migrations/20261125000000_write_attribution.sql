-- Store the Auth0 account (sub) behind every write (audit items M3 / B13).
--
-- 1. toilets.updated_by_sub: the Auth0 `sub` of the account whose change
--    produced the current row version (the submitter, for an approved queued
--    change; NULL for anonymous changes and for writes by the legacy app).
--    The audit trigger snapshots TO_JSONB(NEW), so every record_version row
--    carries the sub of the write it recorded: history needs no trigger change.
-- 2. pending_change.submitter_sub: the Auth0 `sub` of a signed-in submitter
--    (submitted_by keeps holding their contributor name, which approval
--    credits). NULL for anonymous submissions and rows queued before this.
-- 3. toilets_set_updated_by_sub (BEFORE INSERT OR UPDATE): sets
--    updated_by_sub from the transaction-local setting `toiletmap.actor_sub`,
--    which the worker sets right before each write (set_config(..., true)).
--    A write that does not set it, including every legacy-app write, stores
--    NULL. Without the trigger, a legacy edit after a new-app edit would keep
--    the earlier account's sub and be attributed to them.
--
-- Legacy-compatible: two nullable columns with no default, constraint or
-- index, and a trigger that only assigns NEW.updated_by_sub (it never raises
-- and reads no table). The legacy app's INSERT and UPDATE on toilets as
-- toiletmap_web work unchanged (tested in test/integration/write-attribution.spec.ts).
-- Existing table grants to toiletmap_web cover the new columns. The sub is
-- private: the public mappers, GraphQL and the dataset export are
-- allowlists and never read it, and the Prisma `toilets` model does not map
-- the column at all.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS toilets_set_updated_by_sub ON public.toilets;
--   DROP FUNCTION IF EXISTS public.set_toilets_updated_by_sub();
--   ALTER TABLE public.pending_change DROP COLUMN IF EXISTS submitter_sub;
--   ALTER TABLE public.toilets DROP COLUMN IF EXISTS updated_by_sub;

ALTER TABLE public.toilets ADD COLUMN IF NOT EXISTS updated_by_sub text;
ALTER TABLE public.pending_change ADD COLUMN IF NOT EXISTS submitter_sub text;

CREATE OR REPLACE FUNCTION public.set_toilets_updated_by_sub() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
BEGIN
  -- current_setting(..., true) is NULL when the setting was never created on
  -- this connection, and '' after a transaction that set it locally ended.
  NEW.updated_by_sub := NULLIF(current_setting('toiletmap.actor_sub', true), '');
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_toilets_updated_by_sub() FROM PUBLIC, anon, authenticated, toiletmap_web;

DROP TRIGGER IF EXISTS toilets_set_updated_by_sub ON public.toilets;
CREATE TRIGGER toilets_set_updated_by_sub
  BEFORE INSERT OR UPDATE ON public.toilets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_toilets_updated_by_sub();
