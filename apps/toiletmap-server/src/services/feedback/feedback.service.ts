import type { PrismaClientInstance } from "../../prisma";

/** Column limits of `public.feedback` (supabase/migrations/20240823182342_feedback_table.sql). */
export const FEEDBACK_TEXT_MAX_LENGTH = 5000;
export const FEEDBACK_EMAIL_MAX_LENGTH = 255;
export const FEEDBACK_ROUTE_MAX_LENGTH = 255;

/** Default page size of the admin feedback list. */
const FEEDBACK_PAGE_SIZE = 25;

export type FeedbackRow = {
  id: number;
  email: string | null;
  feedback_text: string;
  route: string;
  created_at: Date | null;
};

export type FeedbackInput = {
  text: string;
  email: string | null;
  route: string;
};

export type FeedbackPage = {
  rows: FeedbackRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

/** Feedback ids are positive serial integers; anything else can never match a row. */
export const parseFeedbackId = (value: string | undefined): number | null => {
  if (!value || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const id = Number(value);
  return id <= 2_147_483_647 ? id : null;
};

/** Stores and lists site/app feedback (the `public.feedback` table). */
export class FeedbackService {
  constructor(private readonly prisma: PrismaClientInstance) {}

  async create(input: FeedbackInput): Promise<{ id: number }> {
    const row = await this.prisma.feedback.create({
      data: { feedback_text: input.text, email: input.email, route: input.route },
      select: { id: true },
    });
    return row;
  }

  count(): Promise<number> {
    return this.prisma.feedback.count();
  }

  /** Newest first. Out-of-range pages are clamped to the last page. */
  async list(options: { page?: number; pageSize?: number } = {}): Promise<FeedbackPage> {
    const pageSize = Math.max(1, Math.min(options.pageSize ?? FEEDBACK_PAGE_SIZE, 200));
    const total = await this.count();
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const requested = Number.isFinite(options.page) ? Math.floor(options.page ?? 1) : 1;
    const page = Math.min(Math.max(1, requested), pageCount);

    const rows = await this.prisma.feedback.findMany({
      // created_at is nullable (legacy rows); the serial id breaks ties and orders those.
      orderBy: [{ created_at: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { rows, total, page, pageSize, pageCount };
  }

  getById(id: number): Promise<FeedbackRow | null> {
    return this.prisma.feedback.findUnique({ where: { id } });
  }

  /** Returns false when no row had that id (already deleted). */
  async delete(id: number): Promise<boolean> {
    const { count } = await this.prisma.feedback.deleteMany({ where: { id } });
    return count > 0;
  }
}
