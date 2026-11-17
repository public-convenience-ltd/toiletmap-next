import type { Prisma, PrismaClientInstance } from "../../prisma";
import type { LooMutationAttributes, RemovalCategory } from "../loo/types";

export type PendingChangeType = "create" | "update" | "remove" | "restore";

/** Payload of a queued `remove` change: exactly the report fields, nothing else. */
type RemovePendingPayload = {
  reason: RemovalCategory;
  details?: string;
  duplicateOf?: string;
};

/** Payload of a queued `restore` change. */
type RestorePendingPayload = { details?: string };

export type PendingPayload = LooMutationAttributes | RemovePendingPayload | RestorePendingPayload;

export type QueueOptions = {
  looId: string | null;
  ip: string | null;
  /** updated_at of the toilet the change was computed against. */
  baseUpdatedAt?: Date | null;
  /** Contributor name of a signed-in submitter; null when anonymous. */
  submittedBy?: string | null;
};

/** Default page size of the moderation queue. */
const PENDING_PAGE_SIZE = 25;

export type PendingOrder = "newest" | "oldest";

export type PendingPage = {
  rows: PendingChangeRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};
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
  /** updated_at of the toilet the change was computed against (not set for creates). */
  base_updated_at: Date | null;
  /** Contributor name of a signed-in submitter; null when anonymous. */
  submitted_by: string | null;
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
    payload: PendingPayload,
    { looId, ip, baseUpdatedAt = null, submittedBy = null }: QueueOptions,
  ): Promise<{ id: string }> {
    const result = await this.prisma.pending_change.create({
      data: {
        type,
        loo_id: looId,
        payload: payload as Prisma.InputJsonValue,
        ip,
        base_updated_at: baseUpdatedAt,
        submitted_by: submittedBy,
      },
      select: { id: true },
    });
    return { id: result.id };
  }

  /** Number of changes awaiting review (indexed on status; cheap enough for every admin page). */
  countPending(): Promise<number> {
    return this.prisma.pending_change.count({ where: { status: "pending" } });
  }

  /**
   * One page of the moderation queue. `page` is clamped to the available
   * range, so a stale link past the end shows the last page.
   */
  async listPending(
    options: { page?: number; pageSize?: number; order?: PendingOrder } = {},
  ): Promise<PendingPage> {
    const pageSize = Math.max(1, Math.min(options.pageSize ?? PENDING_PAGE_SIZE, 200));
    const total = await this.countPending();
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const requested = Number.isFinite(options.page) ? Math.floor(options.page ?? 1) : 1;
    const page = Math.min(Math.max(1, requested), pageCount);
    const direction = options.order === "oldest" ? "asc" : "desc";

    const rows = await this.prisma.pending_change.findMany({
      where: { status: "pending" },
      orderBy: [{ submitted_at: direction }, { id: direction }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { rows: rows as PendingChangeRow[], total, page, pageSize, pageCount };
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
