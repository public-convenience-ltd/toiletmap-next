import type { Context } from "hono";
import { html } from "hono/html";
import { generateLooId } from "../../../services/loo";
import type { PendingChangeRow } from "../../../services/pending-change/pending-change.service";
import type { AppVariables, Env } from "../../../types";
import { Layout } from "../../components/Layout";

const formatDate = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));

const PayloadPreview = ({ payload }: { payload: unknown }) => {
  const obj = typeof payload === "object" && payload !== null ? payload : {};
  const entries = Object.entries(obj as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .slice(0, 6);
  return html`<dl class="payload-preview">
    ${entries.map(
      ([k, v]) =>
        html`<div class="payload-row">
          <dt class="payload-key">${k}</dt>
          <dd class="payload-val">${String(v)}</dd>
        </div>`,
    )}
  </dl>`;
};

export const pendingList = async (c: Context<{ Bindings: Env; Variables: AppVariables }>) => {
  const pendingChangeService = c.get("pendingChangeService");
  const pending = await pendingChangeService.listPending();

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
                      <th>Loo ID</th>
                      <th>Submitted</th>
                      <th>IP</th>
                      <th>Payload</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${pending.map(
                      (row: PendingChangeRow) => html`
                        <tr>
                          <td><span class="badge badge--neutral">${row.type}</span></td>
                          <td>${row.loo_id ?? "—"}</td>
                          <td>${formatDate(row.submitted_at)}</td>
                          <td>${row.ip ?? "—"}</td>
                          <td>${PayloadPreview({ payload: row.payload })}</td>
                          <td>
                            <div style="display:flex;gap:var(--space-xs);">
                              <form method="POST" action="/admin/pending/${row.id}/approve">
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
                      `,
                    )}
                  </tbody>
                </table>
              </div>`
        }

        <style>
          .payload-preview { margin: 0; display: flex; flex-direction: column; gap: 2px; }
          .payload-row { display: flex; gap: var(--space-xs); font-size: var(--text--2); }
          .payload-key { color: var(--color-neutral-grey); min-width: 80px; }
          .payload-val { color: var(--color-primary-navy); font-weight: 600; word-break: break-all; }
        </style>
      `,
    }),
  );
};

export const pendingApprove = async (c: Context<{ Bindings: Env; Variables: AppVariables }>) => {
  const id = c.req.param("id");
  if (!id) {
    return c.text("Invalid id", 500);
  }
  const user = c.get("user");
  const pendingChangeService = c.get("pendingChangeService");
  const looService = c.get("looService");

  const change = await pendingChangeService.getById(id);
  if (!change || change.status !== "pending") {
    return c.text("Not found or already processed", 404);
  }

  const contributor = { user_id: user?.sub ?? "admin", name: user?.name ?? "Admin" };
  const payload = change.payload as Parameters<typeof looService.create>[1];

  if (change.type === "create") {
    const newId = generateLooId();
    await looService.create(newId, payload, contributor.name);
  } else if (change.type === "update" && change.loo_id) {
    await looService.upsert(change.loo_id, payload, contributor.name);
  }

  await pendingChangeService.setStatus(id, "approved", user?.sub ?? "admin");
  return c.redirect("/admin/pending");
};

export const pendingReject = async (c: Context<{ Bindings: Env; Variables: AppVariables }>) => {
  const id = c.req.param("id");
  if (!id) {
    return c.text("Invalid id", 500);
  }
  const user = c.get("user");
  const pendingChangeService = c.get("pendingChangeService");
  await pendingChangeService.setStatus(id, "rejected", user?.sub ?? "admin");
  return c.redirect("/admin/pending");
};
