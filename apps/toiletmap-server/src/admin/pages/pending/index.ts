import type { Context } from "hono";
import { html } from "hono/html";
import { generateLooId } from "../../../services/loo";
import { diffMutation, isEmptyMutation, isStaleBase } from "../../../services/loo/diff";
import type { LooMutationAttributes, LooResponse } from "../../../services/loo/types";
import type {
  PendingChangeRow,
  ReviewResult,
} from "../../../services/pending-change/pending-change.service";
import type { AppVariables, Env } from "../../../types";
import { Layout } from "../../components/Layout";

type AdminContext = Context<{ Bindings: Env; Variables: AppVariables }>;

const formatDate = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));

const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Human labels for mutation fields, in display order. */
const FIELD_LABELS: Record<keyof LooMutationAttributes, string> = {
  active: "Active (on map)",
  removalReason: "Removal reason",
  name: "Name",
  location: "Location",
  areaId: "Area",
  accessible: "Accessible",
  radar: "RADAR key",
  noPayment: "Free to use",
  paymentDetails: "Payment details",
  openingTimes: "Opening hours",
  women: "Women",
  men: "Men",
  allGender: "All gender",
  children: "Children",
  urinalOnly: "Urinal only",
  babyChange: "Baby change",
  attended: "Attended",
  automatic: "Automatic",
  notes: "Notes",
};

const FIELD_ORDER = Object.keys(FIELD_LABELS) as Array<keyof LooMutationAttributes>;

const formatValue = (key: string, v: unknown): string => {
  if (v === null || v === undefined) return "—";
  if (key === "location" && typeof v === "object" && !Array.isArray(v)) {
    const loc = v as { lat?: number; lng?: number };
    const lat = typeof loc.lat === "number" ? loc.lat.toFixed(6) : "?";
    const lng = typeof loc.lng === "number" ? loc.lng.toFixed(6) : "?";
    return `${lat}, ${lng}`;
  }
  if (key === "openingTimes" && Array.isArray(v)) {
    return v
      .slice(0, 7)
      .map((day: unknown, i: number) => {
        if (!Array.isArray(day) || day.length !== 2) return `${DAYS_SHORT[i]}: closed`;
        if (day[0] === day[1]) return `${DAYS_SHORT[i]}: 24 hours`;
        return `${DAYS_SHORT[i]}: ${day[0]}–${day[1]}`;
      })
      .join(", ");
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 200);
  return String(v);
};

const currentValue = (current: LooResponse, key: keyof LooMutationAttributes): unknown => {
  // LooResponse has no areaId; show the resolved area name instead.
  if (key === "areaId") return current.area[0]?.name ?? null;
  return current[key];
};

const asPayload = (payload: unknown): LooMutationAttributes =>
  typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? (payload as LooMutationAttributes)
    : {};

const orderedKeys = (payload: LooMutationAttributes) =>
  FIELD_ORDER.filter((key) => payload[key] !== undefined);

type DiffRow = { key: keyof LooMutationAttributes; before: unknown; after: unknown };

/** Before → after table of the fields a change would actually modify. */
const ChangeTable = ({ rows, unchangedCount }: { rows: DiffRow[]; unchangedCount: number }) => html`
  <table class="change-table">
    <thead>
      <tr>
        <th scope="col">Field</th>
        <th scope="col">Current</th>
        <th scope="col">Proposed</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(
        (row) => html`<tr>
          <th scope="row">${FIELD_LABELS[row.key] ?? row.key}</th>
          <td class="change-before">${formatValue(row.key, row.before)}</td>
          <td class="change-after">${formatValue(row.key, row.after)}</td>
        </tr>`,
      )}
    </tbody>
  </table>
  ${
    unchangedCount > 0
      ? html`<p class="change-note">
          ${unchangedCount} submitted field${unchangedCount === 1 ? "" : "s"} already match the
          current record and will be skipped.
        </p>`
      : ""
  }
`;

const ChangePreview = ({
  row,
  current,
}: {
  row: PendingChangeRow;
  current: LooResponse | undefined;
}) => {
  const payload = asPayload(row.payload);

  if (row.type === "create") {
    const rows = orderedKeys(payload)
      .filter((key) => payload[key] !== null && payload[key] !== "")
      .map((key) => ({ key, before: null, after: payload[key] }));
    return ChangeTable({ rows, unchangedCount: 0 });
  }

  if (!current) {
    return html`<p class="change-warning">
      This toilet no longer exists. Approving will reject the change; nothing will be created.
    </p>`;
  }

  const changes = diffMutation(payload, current);
  const changedKeys = orderedKeys(changes);
  const rows = changedKeys.map((key) => ({
    key,
    before: currentValue(current, key),
    after: changes[key],
  }));
  const unchangedCount = orderedKeys(payload).length - changedKeys.length;

  if (rows.length === 0) {
    return html`<p class="change-note">
      Every submitted field already matches the current record. Approving writes nothing.
    </p>`;
  }
  return ChangeTable({ rows, unchangedCount });
};

const isRemovalRequest = (row: PendingChangeRow) => asPayload(row.payload).active === false;

const changedSinceSubmission = (row: PendingChangeRow, current: LooResponse | undefined) => {
  if (!row.base_updated_at || !current?.updatedAt) return false;
  return Date.parse(current.updatedAt) > new Date(row.base_updated_at).getTime();
};

/**
 * Form field carrying the `updatedAt` of the record the moderator's preview was
 * computed from. An empty value means that record had no `updatedAt`.
 */
const REVIEWED_VERSION_FIELD = "reviewedUpdatedAt";

/**
 * True when the record has changed since the moderator reviewed it, i.e. the
 * preview they approved no longer reflects what approval would write.
 */
const reviewedVersionChanged = (reviewed: string, currentUpdatedAt: string | null): boolean =>
  reviewed === "" ? currentUpdatedAt !== null : isStaleBase(reviewed, currentUpdatedAt);

/**
 * Fixed notice codes. The redirect carries only a code, never free text, so
 * nothing user-controlled is reflected into the page.
 */
const NOTICES = {
  approved: { tone: "success", text: "Change approved and applied." },
  "approved-noop": {
    tone: "success",
    text: "Change approved. The toilet already matched it, so nothing was written.",
  },
  rejected: { tone: "success", text: "Change rejected." },
  "loo-missing": {
    tone: "warning",
    text: "The toilet no longer exists, so the change was rejected. Nothing was created.",
  },
  conflict: {
    tone: "warning",
    text: "The toilet was edited while you were approving. Nothing was applied; review the change again.",
  },
  "already-reviewed": {
    tone: "warning",
    text: "That change has already been reviewed. Nothing was applied.",
  },
  "not-found": { tone: "warning", text: "That pending change could not be found." },
} as const;

type NoticeCode = keyof typeof NOTICES;

const redirectWithNotice = (c: AdminContext, notice: NoticeCode) =>
  c.redirect(`/admin/pending?notice=${notice}`);

const NoticeBanner = (code: string | undefined) => {
  if (!code || !Object.hasOwn(NOTICES, code)) return "";
  const notice = NOTICES[code as NoticeCode];
  return html`<div class="pending-notice pending-notice--${notice.tone}" role="status">
    ${notice.text}
  </div>`;
};

export const pendingList = async (c: AdminContext) => {
  const pendingChangeService = c.get("pendingChangeService");
  const looService = c.get("looService");
  const pending = await pendingChangeService.listPending();

  const looIds = [
    ...new Set(pending.map((row) => row.loo_id).filter((id): id is string => Boolean(id))),
  ];
  const currentLoos = new Map(
    (looIds.length ? await looService.getByIds(looIds) : []).map((loo) => [loo.id, loo]),
  );

  return c.html(
    Layout({
      title: "Pending Changes",
      children: html`
        <div class="page-header">
          <div>
            <p class="section-eyebrow">Review queue</p>
            <h2>Pending Changes</h2>
          </div>
        </div>

        ${NoticeBanner(c.req.query("notice"))}

        ${
          pending.length === 0
            ? html`<div class="empty-state">
                <p>No pending changes to review.</p>
              </div>`
            : html`<div class="table-overflow">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Loo</th>
                      <th>Submitted</th>
                      <th>IP</th>
                      <th>Changes</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${pending.map((row: PendingChangeRow) => {
                      const current = row.loo_id ? currentLoos.get(row.loo_id) : undefined;
                      const removal = isRemovalRequest(row);
                      return html`
                        <tr>
                          <td>
                            ${
                              removal
                                ? html`<span class="badge badge--no">Removal request</span>`
                                : html`<span class="badge badge--neutral">${row.type}</span>`
                            }
                          </td>
                          <td>
                            ${
                              row.loo_id
                                ? html`<a href="/admin/loos/${row.loo_id}">${current?.name ?? row.loo_id}</a>`
                                : "—"
                            }
                          </td>
                          <td>${formatDate(row.submitted_at)}</td>
                          <td>${row.ip ?? "—"}</td>
                          <td>
                            ${
                              changedSinceSubmission(row, current)
                                ? html`<p class="change-warning">
                                    Changed since submission: this toilet was edited after the
                                    change was submitted. Check the current values below.
                                  </p>`
                                : ""
                            }
                            ${ChangePreview({ row, current })}
                          </td>
                          <td>
                            <div style="display:flex;gap:var(--space-xs);">
                              <form method="POST" action="/admin/pending/${row.id}/approve">
                                ${
                                  row.type === "update"
                                    ? html`<input
                                        type="hidden"
                                        name="${REVIEWED_VERSION_FIELD}"
                                        value="${current?.updatedAt ?? ""}"
                                      />`
                                    : ""
                                }
                                <button type="submit" class="button" style="font-size:var(--text--2)">
                                  Approve
                                </button>
                              </form>
                              <form method="POST" action="/admin/pending/${row.id}/reject">
                                <button type="submit" class="button button--secondary" style="font-size:var(--text--2)">
                                  Reject
                                </button>
                              </form>
                            </div>
                          </td>
                        </tr>
                      `;
                    })}
                  </tbody>
                </table>
              </div>`
        }

        <style>
          .change-table { border-collapse: collapse; font-size: var(--text--2); min-width: 320px; }
          .change-table th, .change-table td { padding: 2px var(--space-xs) 2px 0; text-align: left; vertical-align: top; }
          .change-table thead th { color: var(--color-neutral-grey); font-weight: 600; }
          .change-table tbody th { color: var(--color-neutral-grey); font-weight: 400; white-space: nowrap; }
          .change-before { color: var(--color-neutral-grey); text-decoration: line-through; word-break: break-word; }
          .change-after { color: var(--color-primary-navy); font-weight: 600; word-break: break-word; }
          .change-note { margin: var(--space-3xs) 0 0; font-size: var(--text--2); color: var(--color-neutral-grey); }
          .change-warning { margin: 0 0 var(--space-3xs); font-size: var(--text--2); color: var(--color-accent-pink); font-weight: 600; }
          .pending-notice { margin-block: var(--space-s); padding: var(--space-xs) var(--space-s); border-radius: 8px; font-weight: 600; }
          .pending-notice--success { background: #e2fbf2; color: var(--color-primary-navy); }
          .pending-notice--warning { background: #fde5eb; color: var(--color-accent-pink); }
        </style>
      `,
    }),
  );
};

/** Thrown inside the review transaction to roll back when a concurrent edit is detected. */
class ApprovalConflictError extends Error {}

export const pendingApprove = async (c: AdminContext) => {
  const id = c.req.param("id");
  if (!id) {
    return c.text("Invalid id", 400);
  }
  const user = c.get("user");
  const pendingChangeService = c.get("pendingChangeService");
  const looService = c.get("looService");
  const contributorName = user?.name ?? "Admin";

  // The version the moderator reviewed. Absent (e.g. a scripted POST) means
  // no check; otherwise approval only applies to that exact version.
  const body = await c.req.parseBody();
  const reviewedField = body[REVIEWED_VERSION_FIELD];
  const reviewedUpdatedAt = typeof reviewedField === "string" ? reviewedField : undefined;

  let result: ReviewResult<NoticeCode>;
  try {
    result = await pendingChangeService.review<NoticeCode>(
      id,
      "approved",
      user?.sub ?? "admin",
      async (tx, change) => {
        const { active, ...rest } = asPayload(change.payload);
        // Changes queued before `active` became boolean-only may carry null,
        // which would hide the toilet without a decision. Never apply it.
        const payload: LooMutationAttributes = active === null ? rest : { ...rest, active };

        if (change.type === "create") {
          await looService.createInTransaction(tx, generateLooId(), payload, contributorName);
          return { status: "approved", detail: "approved" };
        }

        if (!change.loo_id) return { status: "rejected", detail: "loo-missing" };

        // Re-diff the stored payload against the record as it is now, so fields
        // that already match (e.g. after an intervening edit) are not rewritten.
        const current = await looService.getMutationBase(change.loo_id, tx);
        if (!current) return { status: "rejected", detail: "loo-missing" };

        // The moderator approved a preview computed from an older version.
        // Roll back the claim so the change stays pending for re-review.
        if (
          reviewedUpdatedAt !== undefined &&
          reviewedVersionChanged(reviewedUpdatedAt, current.updatedAt)
        ) {
          throw new ApprovalConflictError();
        }

        const changes = diffMutation(payload, current);
        if (isEmptyMutation(changes)) return { status: "approved", detail: "approved-noop" };

        // Strict update: never inserts, and only applies to the version we diffed.
        const updated = await looService.updateExisting(change.loo_id, changes, contributorName, {
          tx,
          expectedUpdatedAt: current.updatedAt,
        });
        if (updated.status === "not_found") return { status: "rejected", detail: "loo-missing" };
        if (updated.status === "conflict") throw new ApprovalConflictError();
        return { status: "approved", detail: "approved" };
      },
    );
  } catch (error) {
    if (error instanceof ApprovalConflictError) return redirectWithNotice(c, "conflict");
    throw error;
  }

  if (result.status === "not_found") return redirectWithNotice(c, "not-found");
  if (result.status === "already_reviewed") return redirectWithNotice(c, "already-reviewed");

  return redirectWithNotice(c, result.detail ?? "approved");
};

export const pendingReject = async (c: AdminContext) => {
  const id = c.req.param("id");
  if (!id) {
    return c.text("Invalid id", 400);
  }
  const user = c.get("user");
  const pendingChangeService = c.get("pendingChangeService");
  const result = await pendingChangeService.review(id, "rejected", user?.sub ?? "admin");

  if (result.status === "not_found") return redirectWithNotice(c, "not-found");
  if (result.status === "already_reviewed") return redirectWithNotice(c, "already-reviewed");
  return redirectWithNotice(c, "rejected");
};
