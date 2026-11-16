import type { Prisma, PrismaClientInstance } from "../../prisma";
import type { LooMutationAttributes } from "../loo/types";

export type PendingChangeType = "create" | "update";
export type PendingChangeStatus = "pending" | "approved" | "rejected";

export interface PendingChangeRow {
  id: string;
  type: PendingChangeType;
  loo_id: string | null;
  payload: unknown;
  ip: string | null;
  submitted_at: Date;
  status: PendingChangeStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  /** updated_at of the toilet the change was computed against (update changes only). */
  base_updated_at: Date | null;
}

/**
 * What the review callback decided to do with a claimed change. `rejected`
 * lets an approval downgrade itself (e.g. the toilet no longer exists) inside
 * the same transaction.
 */
export type ReviewApplyOutcome<T> = { status: "approved" | "rejected"; detail: T };

export type ReviewResult<T> =
  | { status: "not_found" }
  | { status: "already_reviewed"; current: PendingChangeStatus }
  | { status: "approved" | "rejected"; detail: T | null };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pending-change ids are UUIDs; anything else can never match a row. */
export const isPendingChangeId = (id: string): boolean => UUID_PATTERN.test(id);

export class PendingChangeService {
  constructor(private readonly prisma: PrismaClientInstance) {}

  async queue(
    type: PendingChangeType,
    payload: LooMutationAttributes,
    looId: string | null,
    ip: string | null,
    baseUpdatedAt: Date | null = null,
  ): Promise<{ id: string }> {
    const result = await this.prisma.pending_change.create({
      data: {
        type,
        loo_id: looId,
        payload: payload as Prisma.InputJsonValue,
        ip,
        base_updated_at: baseUpdatedAt,
      },
      select: { id: true },
    });
    return { id: result.id };
  }

  async listPending(): Promise<PendingChangeRow[]> {
    const rows = await this.prisma.pending_change.findMany({
      where: { status: "pending" },
      orderBy: { submitted_at: "asc" },
    });
    return rows as PendingChangeRow[];
  }

  async getById(id: string): Promise<PendingChangeRow | null> {
    if (!isPendingChangeId(id)) return null;
    const row = await this.prisma.pending_change.findUnique({ where: { id } });
    return row as PendingChangeRow | null;
  }

  /**
   * Atomically reviews a pending change.
   *
   * Inside one transaction the change is claimed with
   * `UPDATE ... WHERE id = ? AND status = 'pending'`; only the caller that wins
   * the claim runs `apply`, so a double-submitted approve (or an approve racing
   * a reject) applies at most once. If `apply` throws, the transaction rolls
   * back and the change stays pending.
   *
   * @param decision - The intended status. For `rejected`, `apply` is optional.
   * @param apply - Runs inside the transaction with the claimed row. Its
   *   returned status is what gets recorded, so an approval can turn itself
   *   into a rejection when it cannot be applied safely.
   */
  review<T>(
    id: string,
    decision: "approved" | "rejected",
    reviewedBy: string,
    apply?: (
      tx: Prisma.TransactionClient,
      change: PendingChangeRow,
    ) => Promise<ReviewApplyOutcome<T>>,
  ): Promise<ReviewResult<T>> {
    if (!isPendingChangeId(id)) return Promise.resolve({ status: "not_found" });

    return this.prisma.$transaction(async (tx): Promise<ReviewResult<T>> => {
      const reviewedAt = new Date();
      const claimed = await tx.pending_change.updateMany({
        where: { id, status: "pending" },
        data: { status: decision, reviewed_by: reviewedBy, reviewed_at: reviewedAt },
      });

      if (claimed.count === 0) {
        const existing = await tx.pending_change.findUnique({
          where: { id },
          select: { status: true },
        });
        return existing
          ? { status: "already_reviewed", current: existing.status as PendingChangeStatus }
          : { status: "not_found" };
      }

      if (!apply) return { status: decision, detail: null };

      const change = (await tx.pending_change.findUnique({ where: { id } })) as PendingChangeRow;
      const outcome = await apply(tx, change);

      if (outcome.status !== decision) {
        await tx.pending_change.update({
          where: { id },
          data: { status: outcome.status },
        });
      }

      return { status: outcome.status, detail: outcome.detail };
    });
  }
}
