/**
 * Admin feedback inbox: newest first, paginated, with a two-step delete
 * (a confirmation page, then a POST that must carry `confirm=delete`).
 *
 * Every value is interpolated through `hono/html`, which escapes it, so
 * submitted text can never inject markup. The email address is shown here
 * only: the whole admin area is behind `requireAdminAuth` +
 * `requireAdminRole`, and nothing else (logs, Slack) ever sees it.
 */
import type { Context } from "hono";
import { html } from "hono/html";
import { type FeedbackRow, parseFeedbackId } from "../../../services/feedback/feedback.service";
import type { AppVariables, Env } from "../../../types";
import { Layout } from "../../components/Layout";

type AdminContext = Context<{ Bindings: Env; Variables: AppVariables }>;

/** Form field and value the delete POST must carry. */
const FEEDBACK_DELETE_CONFIRM_FIELD = "confirm";
const FEEDBACK_DELETE_CONFIRM_VALUE = "delete";

const formatDate = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/London",
      }).format(new Date(d))
    : "Unknown date";

/** Fixed notice codes: the redirect carries a code, never free text. */
const NOTICES = {
  deleted: { tone: "success", text: "Feedback deleted." },
  "not-found": {
    tone: "warning",
    text: "That feedback could not be found. It may already be deleted.",
  },
  "confirm-required": {
    tone: "warning",
    text: "Nothing was deleted: confirm the deletion on the confirmation page.",
  },
} as const;

type NoticeCode = keyof typeof NOTICES;

const redirectWithNotice = (c: AdminContext, notice: NoticeCode) =>
  c.redirect(`/admin/feedback?notice=${notice}`);

const NoticeBanner = (code: string | undefined) => {
  if (!code || !Object.hasOwn(NOTICES, code)) return "";
  const notice = NOTICES[code as NoticeCode];
  return html`<div class="feedback-notice feedback-notice--${notice.tone}" role="status">
    ${notice.text}
  </div>`;
};

const parsePage = (value: string | undefined) => {
  const page = Number.parseInt(value ?? "", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
};

const pageHref = (page: number) => `/admin/feedback?page=${page}`;

const Pagination = ({
  page,
  pageCount,
  total,
}: {
  page: number;
  pageCount: number;
  total: number;
}) =>
  html`<nav class="feedback-pagination" aria-label="Feedback pages">
    <p>${total} ${total === 1 ? "message" : "messages"} · Page ${page} of ${pageCount} · Newest first</p>
    ${
      pageCount > 1
        ? html`<p>
            ${page > 1 ? html`<a class="button button--secondary" rel="prev" href="${pageHref(page - 1)}">Previous</a>` : ""}
            ${page < pageCount ? html`<a class="button button--secondary" rel="next" href="${pageHref(page + 1)}">Next</a>` : ""}
          </p>`
        : ""
    }
  </nav>`;

const FeedbackMeta = (row: FeedbackRow) => html`<dl class="feedback-meta">
  <div><dt>Received</dt><dd>${formatDate(row.created_at)}</dd></div>
  <div><dt>From</dt><dd>${row.route || "—"}</dd></div>
  <div><dt>Email</dt><dd>${row.email ?? "Not given"}</dd></div>
</dl>`;

const styles = html`<style>
  .feedback-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-s); }
  .feedback-item { border: 1px solid var(--color-light-grey); border-radius: 8px; padding: var(--space-s); background: var(--color-white, #fff); }
  .feedback-text { margin: 0 0 var(--space-xs); white-space: pre-wrap; overflow-wrap: anywhere; }
  .feedback-meta { display: flex; flex-wrap: wrap; gap: var(--space-3xs) var(--space-m); margin: 0 0 var(--space-xs); font-size: var(--text--1); }
  .feedback-meta div { display: flex; gap: var(--space-3xs); min-width: 0; }
  .feedback-meta dt { color: var(--color-neutral-grey); }
  .feedback-meta dd { margin: 0; overflow-wrap: anywhere; }
  .feedback-actions { display: flex; gap: var(--space-xs); flex-wrap: wrap; align-items: center; }
  .feedback-pagination p { margin-block: var(--space-xs); display: flex; gap: var(--space-xs); flex-wrap: wrap; align-items: center; }
  .feedback-notice { margin-block: var(--space-s); padding: var(--space-xs) var(--space-s); border-radius: 8px; font-weight: 600; }
  .feedback-notice--success { background: #e2fbf2; color: var(--color-primary-navy); }
  .feedback-notice--warning { background: #fde5eb; color: var(--color-accent-pink); }
  .button--danger { background-color: var(--color-accent-pink); border-color: var(--color-accent-pink); color: var(--color-white, #fff); }
  .button--danger:hover { background-color: var(--color-primary-navy); border-color: var(--color-primary-navy); color: var(--color-white, #fff); }
</style>`;

export const feedbackList = async (c: AdminContext) => {
  const result = await c.get("feedbackService").list({ page: parsePage(c.req.query("page")) });

  return c.html(
    Layout({
      title: "Feedback",
      children: html`
        <div class="page-header">
          <div>
            <p class="section-eyebrow">Inbox</p>
            <h2>Feedback</h2>
          </div>
        </div>

        ${NoticeBanner(c.req.query("notice"))}

        ${
          result.rows.length === 0
            ? html`<div class="empty-state"><p>No feedback yet.</p></div>`
            : html`${Pagination(result)}
                <ol class="feedback-list">
                  ${result.rows.map(
                    (row) => html`<li class="feedback-item" id="feedback-${row.id}">
                      <p class="feedback-text">${row.feedback_text}</p>
                      ${FeedbackMeta(row)}
                      <div class="feedback-actions">
                        <a class="button button--secondary" href="/admin/feedback/${row.id}/delete">Delete…</a>
                      </div>
                    </li>`,
                  )}
                </ol>
                ${Pagination(result)}`
        }
        ${styles}
      `,
    }),
  );
};

/** Confirmation step: shows the message and a POST form that carries the confirm field. */
export const feedbackDeleteConfirm = async (c: AdminContext) => {
  const id = parseFeedbackId(c.req.param("id"));
  const row = id === null ? null : await c.get("feedbackService").getById(id);
  if (!row) return redirectWithNotice(c, "not-found");

  return c.html(
    Layout({
      title: "Delete feedback",
      children: html`
        <div class="page-header">
          <div>
            <p class="section-eyebrow">Feedback</p>
            <h2>Delete this feedback?</h2>
          </div>
        </div>
        <div class="feedback-item">
          <p class="feedback-text">${row.feedback_text}</p>
          ${FeedbackMeta(row)}
        </div>
        <p>This permanently deletes the message${row.email ? " and the email address stored with it" : ""}. It cannot be undone.</p>
        <form method="POST" action="/admin/feedback/${row.id}/delete" class="feedback-actions">
          <input type="hidden" name="${FEEDBACK_DELETE_CONFIRM_FIELD}" value="${FEEDBACK_DELETE_CONFIRM_VALUE}" />
          <button type="submit" class="button button--danger">Delete permanently</button>
          <a class="button button--secondary" href="/admin/feedback">Cancel</a>
        </form>
        ${styles}
      `,
    }),
  );
};

export const feedbackDelete = async (c: AdminContext) => {
  const id = parseFeedbackId(c.req.param("id"));
  if (id === null) return redirectWithNotice(c, "not-found");

  const body = await c.req.parseBody();
  if (body[FEEDBACK_DELETE_CONFIRM_FIELD] !== FEEDBACK_DELETE_CONFIRM_VALUE) {
    return redirectWithNotice(c, "confirm-required");
  }

  const deleted = await c.get("feedbackService").delete(id);
  return redirectWithNotice(c, deleted ? "deleted" : "not-found");
};
