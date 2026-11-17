/**
 * Direct DB access for assertions and clean-up. The implementation lives in
 * toiletmap-server (which owns the `pg` dependency and the schema).
 */
export {
  checkDatabase,
  deleteLoos,
  deletePendingChanges,
  E2E_SWEEP_MIN_AGE_MS,
  e2eDatabaseUrl,
  e2eRunStart,
  getPendingChangesForLoo,
  isStaleE2eRow,
  type PendingChangeRow,
  sweepE2eRows,
} from "../../../toiletmap-server/scripts/e2e-db";
