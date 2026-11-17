-- Report a problem / restore / verify (Phase 3).
--
-- 1. toilets.removal_category: why a toilet was removed, as a fixed category.
--    Free-text details stay in the existing removal_reason column. NULL for
--    active toilets and for toilets removed before categories existed.
-- 2. toilets.duplicate_of: the toilet a duplicate was merged into. A real
--    foreign key (same char(24) type as toilets.id); ON DELETE SET NULL so a
--    hard delete of the surviving record never blocks or cascades. The audit
--    trigger records the resulting UPDATE like any other.
-- 3. pending_change.type gains 'remove' and 'restore' (queued report and
--    restore requests from untrusted callers).
-- 4. pending_change.submitted_by: contributor name of a signed-in submitter
--    without direct-write permission, so approval credits them rather than
--    the moderator. NULL for anonymous submissions.
--
-- The audit trigger (audit.insert_update_delete_trigger) snapshots TO_JSONB(NEW),
-- so the new columns are captured in record_version automatically.
-- Table-level grants to toiletmap_web already cover new columns.
--
-- Rollback:
--   ALTER TABLE public.pending_change DROP CONSTRAINT IF EXISTS pending_change_type_check;
--   DELETE FROM public.pending_change WHERE type IN ('remove', 'restore');
--   ALTER TABLE public.pending_change
--     ADD CONSTRAINT pending_change_type_check CHECK (type IN ('create', 'update'));
--   ALTER TABLE public.pending_change DROP COLUMN IF EXISTS submitted_by;
--   DROP INDEX IF EXISTS public.idx_toilets_duplicate_of;
--   ALTER TABLE public.toilets DROP CONSTRAINT IF EXISTS toilets_duplicate_of_fk;
--   ALTER TABLE public.toilets DROP CONSTRAINT IF EXISTS toilets_duplicate_of_not_self;
--   ALTER TABLE public.toilets DROP CONSTRAINT IF EXISTS toilets_removal_category_check;
--   ALTER TABLE public.toilets DROP COLUMN IF EXISTS duplicate_of;
--   ALTER TABLE public.toilets DROP COLUMN IF EXISTS removal_category;

ALTER TABLE public.toilets ADD COLUMN IF NOT EXISTS removal_category text;
ALTER TABLE public.toilets ADD COLUMN IF NOT EXISTS duplicate_of char(24);

ALTER TABLE public.toilets DROP CONSTRAINT IF EXISTS toilets_removal_category_check;
ALTER TABLE public.toilets
  ADD CONSTRAINT toilets_removal_category_check CHECK (
    removal_category IS NULL
    OR removal_category IN (
      'permanently_closed',
      'does_not_exist',
      'not_public',
      'duplicate',
      'other'
    )
  );

ALTER TABLE public.toilets DROP CONSTRAINT IF EXISTS toilets_duplicate_of_not_self;
ALTER TABLE public.toilets
  ADD CONSTRAINT toilets_duplicate_of_not_self CHECK (duplicate_of IS NULL OR duplicate_of <> id);

ALTER TABLE public.toilets DROP CONSTRAINT IF EXISTS toilets_duplicate_of_fk;
ALTER TABLE public.toilets
  ADD CONSTRAINT toilets_duplicate_of_fk FOREIGN KEY (duplicate_of)
  REFERENCES public.toilets (id) ON DELETE SET NULL;

-- Supports ON DELETE SET NULL and "what duplicates this?" lookups.
CREATE INDEX IF NOT EXISTS idx_toilets_duplicate_of
  ON public.toilets (duplicate_of)
  WHERE duplicate_of IS NOT NULL;

ALTER TABLE public.pending_change DROP CONSTRAINT IF EXISTS pending_change_type_check;
ALTER TABLE public.pending_change
  ADD CONSTRAINT pending_change_type_check
  CHECK (type IN ('create', 'update', 'remove', 'restore'));

ALTER TABLE public.pending_change ADD COLUMN IF NOT EXISTS submitted_by text;
