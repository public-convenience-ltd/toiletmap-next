import type { PrismaClientInstance } from "../../prisma";
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
}

export class PendingChangeService {
  constructor(private readonly prisma: PrismaClientInstance) {}

  async queue(
    type: PendingChangeType,
    payload: LooMutationAttributes,
    looId: string | null,
    ip: string | null,
  ): Promise<{ id: string }> {
    const result = await this.prisma.pending_change.create({
      data: {
        type,
        loo_id: looId,
        // Prisma expects InputJsonValue for Json fields
        payload: payload as Parameters<
          typeof this.prisma.pending_change.create
        >[0]["data"]["payload"],
        ip,
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

  async setStatus(id: string, status: "approved" | "rejected", reviewedBy: string): Promise<void> {
    await this.prisma.pending_change.update({
      where: { id },
      data: { status, reviewed_by: reviewedBy, reviewed_at: new Date() },
    });
  }

  async getById(id: string): Promise<PendingChangeRow | null> {
    const row = await this.prisma.pending_change.findUnique({ where: { id } });
    return row as PendingChangeRow | null;
  }
}
