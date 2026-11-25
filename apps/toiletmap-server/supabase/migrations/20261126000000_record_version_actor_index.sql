-- Index audit history by the account behind each write (audit item H4 / B11).
--
-- The per-account daily cap counts one account's removals and moves in the
-- last 24 hours (LooService.countRecentRemovalsAndMoves):
--
--   SELECT count(*) FROM audit.record_version
--   WHERE record->>'updated_by_sub' = $1 AND ts >= $2 AND op = 'UPDATE' ...
--
-- record->>'updated_by_sub' is the Auth0 sub the toilets_set_updated_by_sub
-- trigger stored on the row (20261125000000_write_attribution.sql). Without
-- this index that query reads every history row since the BRIN `ts` range.
--
-- Partial: only rows written by a signed-in account through the new app carry
-- a sub, so every existing row (legacy history) and every anonymous or legacy
-- write is left out and the index stays small.
--
-- Legacy-compatible: an index only (no column, constraint or trigger change).
-- Legacy inserts into toilets (and so into audit.record_version via the audit
-- trigger) work unchanged; rows without a sub skip the index entirely.
--
-- Deploy note: CREATE INDEX (not CONCURRENTLY, which cannot run inside the
-- migration transaction) holds a SHARE lock on audit.record_version while it
-- scans the table once, so toilet writes from both apps wait for that scan
-- (seconds for a few hundred thousand rows). Merge outside busy hours.
--
-- Rollback:
--   DROP INDEX IF EXISTS audit.record_version_updated_by_sub_ts;

CREATE INDEX IF NOT EXISTS record_version_updated_by_sub_ts
  ON audit.record_version ((record ->> 'updated_by_sub'), ts)
  WHERE (record ->> 'updated_by_sub') IS NOT NULL;
