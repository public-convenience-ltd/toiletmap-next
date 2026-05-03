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
    const result = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.pending_change (type, loo_id, payload, ip)
      VALUES (${type}, ${looId}, ${JSON.stringify(payload)}::jsonb, ${ip})
      RETURNING id::text
    `;
    return { id: result[0].id };
  }

  async listPending(): Promise<PendingChangeRow[]> {
    return await this.prisma.$queryRaw<PendingChangeRow[]>`
      SELECT id::text, type, loo_id, payload, ip, submitted_at, status, reviewed_by, reviewed_at
      FROM public.pending_change
      WHERE status = 'pending'
      ORDER BY submitted_at ASC
    `;
  }

  async setStatus(id: string, status: "approved" | "rejected", reviewedBy: string): Promise<void> {
    await await this.prisma.$queryRaw`
      UPDATE public.pending_change
      SET status = ${status}, reviewed_by = ${reviewedBy}, reviewed_at = now()
      WHERE id = ${id}::uuid
    `;
  }

  async getById(id: string): Promise<PendingChangeRow | null> {
    const rows = await this.prisma.$queryRaw<PendingChangeRow[]>`
      SELECT id::text, type, loo_id, payload, ip, submitted_at, status, reviewed_by, reviewed_at
      FROM public.pending_change
      WHERE id = ${id}::uuid
      LIMIT 1
    `;
    return rows[0] ?? null;
  }
}
