-- Record the version of the toilet a pending change was computed against.
--
-- Anonymous edits are queued as a diff against the record the submitter saw.
-- `base_updated_at` stores that record's `updated_at` so moderators can see
-- when the toilet has changed since submission, and approvals can detect
-- conflicts instead of silently overwriting newer edits.
--
-- Nullable: rows queued before this migration (and all 'create' changes)
-- have no base version.
--
-- Rollback:
--   ALTER TABLE public.pending_change DROP COLUMN IF EXISTS base_updated_at;

ALTER TABLE public.pending_change
  ADD COLUMN IF NOT EXISTS base_updated_at timestamptz;
