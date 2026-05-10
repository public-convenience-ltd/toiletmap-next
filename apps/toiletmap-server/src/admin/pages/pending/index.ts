import type { Context } from "hono";
import { html } from "hono/html";
import { generateLooId } from "../../../services/loo";
import type { PendingChangeRow } from "../../../services/pending-change/pending-change.service";
import type { AppVariables, Env } from "../../../types";
import { invalidateDumpCache } from "../../../utils/cache";
import { Layout } from "../../components/Layout";

const formatDate = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));

const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const formatPayloadValue = (key: string, v: unknown): string => {
  if (v === null || v === undefined) return "—";
  if (key === "location" && typeof v === "object" && v !== null && !Array.isArray(v)) {
    const loc = v as { lat?: number; lng?: number };
    const lat = typeof loc.lat === "number" ? loc.lat.toFixed(5) : "?";
    const lng = typeof loc.lng === "number" ? loc.lng.toFixed(5) : "?";
    return `${lat}, ${lng}`;
  }
  if (key === "openingTimes" && Array.isArray(v)) {
    const slots = v
      .slice(0, 7)
      .map((day: unknown, i: number) =>
        Array.isArray(day) && day.length === 2 ? `${DAYS_SHORT[i]}: ${day[0]}–${day[1]}` : "",
      )
      .filter(Boolean);
    return slots.length > 0 ? slots.join(", ") : "No hours set";
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (typeof v === "object") return JSON.stringify(v).slice(0, 80);
  return String(v);
};

const PayloadPreview = ({ payload }: { payload: unknown }) => {
  const obj = typeof payload === "object" && payload !== null ? payload : {};
  const entries = Object.entries(obj as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .slice(0, 8);
  return html`<dl class="payload-preview">
    ${entries.map(
      ([k, v]) =>
        html`<div class="payload-row">
          <dt class="payload-key">${k}</dt>
          <dd class="payload-val">${formatPayloadValue(k, v)}</dd>
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
    return c.text("Invalid id", 400);
  }
  const user = c.get("user");
  const pendingChangeService = c.get("pendingChangeService");
  const looService = c.get("looService");

  const change = await pendingChangeService.getById(id);
  if (!change || change.status !== "pending") {
    return c.text("Not found or already processed", 404);
  }

  const contributorName = user?.name ?? "Admin";
  const payload = change.payload as Parameters<typeof looService.create>[1];

  if (change.type === "create") {
    const newId = generateLooId();
    await looService.create(newId, payload, contributorName);
  } else if (change.type === "update" && change.loo_id) {
    await looService.upsert(change.loo_id, payload, contributorName);
  }

  await invalidateDumpCache(c.req.url);
  await pendingChangeService.setStatus(id, "approved", user?.sub ?? "admin");
  return c.redirect("/admin/pending");
};

export const pendingReject = async (c: Context<{ Bindings: Env; Variables: AppVariables }>) => {
  const id = c.req.param("id");
  if (!id) {
    return c.text("Invalid id", 400);
  }
  const user = c.get("user");
  const pendingChangeService = c.get("pendingChangeService");
  await pendingChangeService.setStatus(id, "rejected", user?.sub ?? "admin");
  return c.redirect("/admin/pending");
};
