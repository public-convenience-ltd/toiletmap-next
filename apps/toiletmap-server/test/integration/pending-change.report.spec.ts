/**
 * Moderation of queued `remove` / `restore` changes, queue pagination and the
 * nav count badge.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { __adminRoleTestUtils } from "../../src/middleware/require-admin-role";
import type { Prisma } from "../../src/prisma";
import { PendingChangeService } from "../../src/services/pending-change/pending-change.service";
import { getPrismaClient, getTestContext } from "./setup";
import { cleanupManager } from "./utils/cleanup";
import { createFixtureFactory } from "./utils/fixtures";
import type { LooResponse } from "./utils/response-types";
import { sessionHeaders } from "./utils/session";
import { callApi, jsonRequest, readJson } from "./utils/test-client";

const fixtures = createFixtureFactory();

const adminHeaders = () => {
  __adminRoleTestUtils.clearPermissionCache();
  return sessionHeaders({
    sub: "auth0|test-admin",
    permissions: ["access:admin"],
    profile: { email: "admin@example.com", name: "Test Admin" },
  });
};

const seedPending = async (
  type: "remove" | "restore" | "update" | "create",
  looId: string | null,
  payload: Record<string, unknown>,
  extra: { submittedBy?: string; submittedAt?: Date } = {},
) => {
  const record = await getPrismaClient().pending_change.create({
    data: {
      type,
      loo_id: looId,
      payload: payload as Prisma.InputJsonValue,
      ip: "127.0.0.1",
      submitted_by: extra.submittedBy ?? null,
      ...(extra.submittedAt ? { submitted_at: extra.submittedAt } : {}),
    },
  });
  cleanupManager.trackPendingChange(record.id);
  return record;
};

const pendingPage = async (query = "") => {
  const response = await callApi(`/admin/pending${query}`, { headers: adminHeaders() });
  expect(response.status).toBe(200);
  return response.text();
};

/** The reviewed-version token rendered into a change's approve form. */
const renderedReviewedVersion = async (changeId: string) => {
  const html = await pendingPage();
  const match = new RegExp(
    `action="/admin/pending/${changeId}/approve">[\\s\\S]*?name="reviewedUpdatedAt"[\\s\\S]*?value="([^"]*)"`,
  ).exec(html);
  if (!match) throw new Error(`No reviewed version rendered for change ${changeId}`);
  return match[1] ?? "";
};

const approve = (id: string, reviewedUpdatedAt?: string) =>
  callApi(`/admin/pending/${id}/approve`, {
    method: "POST",
    headers: { ...adminHeaders(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(
      reviewedUpdatedAt === undefined ? {} : { reviewedUpdatedAt },
    ).toString(),
  });

const noticeOf = (response: Response) => response.headers.get("location");

const statusOf = async (id: string) =>
  (await getPrismaClient().pending_change.findUnique({ where: { id } }))?.status;

const looRow = (id: string) => getPrismaClient().toilets.findUnique({ where: { id } });

const removeLoo = async (loo: LooResponse) => {
  const response = await callApi(
    `/api/loos/${loo.id}/report`,
    jsonRequest(
      "POST",
      { reason: "permanently_closed" },
      { Authorization: `Bearer ${getTestContext().issueToken()}` },
    ),
  );
  expect(response.status).toBe(200);
};

describe("moderating removal requests", () => {
  it("labels a removal request with its reason, details and a before/after", async () => {
    const loo = await fixtures.loos.create({ name: "Labelled Loo" });
    await seedPending("remove", loo.id, { reason: "permanently_closed", details: "Boarded up" });

    const html = await pendingPage();
    expect(html).toContain("Removal request: Permanently closed");
    expect(html).toContain("Boarded up");
    expect(html).toContain("On the map");
    expect(html).toContain("Removed (Permanently closed)");
  });

  it("approves a removal, crediting the signed-in submitter", async () => {
    const loo = await fixtures.loos.create();
    const change = await seedPending(
      "remove",
      loo.id,
      { reason: "not_public", details: "Staff only now" },
      { submittedBy: "keen-volunteer" },
    );
    const reviewed = await renderedReviewedVersion(change.id);

    const response = await approve(change.id, reviewed);
    expect(noticeOf(response)).toBe("/admin/pending?notice=approved");
    expect(await statusOf(change.id)).toBe("approved");

    const row = await looRow(loo.id);
    expect(row?.active).toBe(false);
    expect(row?.removal_category).toBe("not_public");
    expect(row?.removal_reason).toBe("Staff only now");
    expect(row?.contributors.at(-1)).toBe("keen-volunteer");
  });

  it("credits the moderator for an anonymous removal and links duplicates", async () => {
    const survivor = await fixtures.loos.create();
    const loo = await fixtures.loos.create();
    const change = await seedPending("remove", loo.id, {
      reason: "duplicate",
      duplicateOf: survivor.id,
    });

    const html = await pendingPage();
    expect(html).toContain(`href="/admin/loos/${survivor.id}"`);

    const response = await approve(change.id);
    expect(noticeOf(response)).toBe("/admin/pending?notice=approved");
    const row = await looRow(loo.id);
    expect(row?.duplicate_of).toBe(survivor.id);
    expect(row?.contributors.at(-1)).toBe("Test Admin");
  });

  it("applies a double-submitted removal approval exactly once", async () => {
    const loo = await fixtures.loos.create();
    const change = await seedPending("remove", loo.id, { reason: "permanently_closed" });

    const [first, second] = await Promise.all([approve(change.id), approve(change.id)]);
    expect([noticeOf(first), noticeOf(second)].sort()).toEqual([
      "/admin/pending?notice=already-reviewed",
      "/admin/pending?notice=approved",
    ]);
    const row = await looRow(loo.id);
    expect(row?.active).toBe(false);
    // The fixture contributed once; the approval added exactly one more.
    expect(row?.contributors).toHaveLength(2);
  });

  it("keeps the request pending when the toilet changed after review", async () => {
    const loo = await fixtures.loos.create({ notes: "Before" });
    const change = await seedPending("remove", loo.id, { reason: "permanently_closed" });
    const reviewed = await renderedReviewedVersion(change.id);

    const edit = await callApi(
      `/api/loos/${loo.id}`,
      jsonRequest(
        "PUT",
        { notes: "Edited meanwhile" },
        { Authorization: `Bearer ${getTestContext().issueToken()}` },
      ),
    );
    expect(edit.status).toBe(200);

    const response = await approve(change.id, reviewed);
    expect(noticeOf(response)).toBe("/admin/pending?notice=conflict");
    expect(await statusOf(change.id)).toBe("pending");
    expect((await looRow(loo.id))?.active).toBe(true);
  });

  it("approves as a no-op when the toilet is already removed", async () => {
    const loo = await fixtures.loos.create();
    const change = await seedPending("remove", loo.id, { reason: "does_not_exist" });
    await removeLoo(loo);
    const before = await looRow(loo.id);

    const html = await pendingPage();
    expect(html).toContain("Already removed");

    const response = await approve(change.id);
    expect(noticeOf(response)).toBe("/admin/pending?notice=approved-noop");
    const after = await looRow(loo.id);
    expect(after?.updated_at?.getTime()).toBe(before?.updated_at?.getTime());
    expect(after?.removal_category).toBe("permanently_closed");
  });

  it("keeps the request pending when the duplicate target was removed meanwhile", async () => {
    const survivor = await fixtures.loos.create();
    const loo = await fixtures.loos.create();
    const change = await seedPending("remove", loo.id, {
      reason: "duplicate",
      duplicateOf: survivor.id,
    });
    await removeLoo(survivor);

    const response = await approve(change.id);
    expect(noticeOf(response)).toBe("/admin/pending?notice=duplicate-invalid");
    expect(await statusOf(change.id)).toBe("pending");
    expect((await looRow(loo.id))?.active).toBe(true);
  });

  it("rejects a malformed removal request", async () => {
    const loo = await fixtures.loos.create();
    const change = await seedPending("remove", loo.id, { reason: "because" });

    const html = await pendingPage();
    expect(html).toContain("malformed");

    const response = await approve(change.id);
    expect(noticeOf(response)).toBe("/admin/pending?notice=malformed");
    expect(await statusOf(change.id)).toBe("rejected");
    expect((await looRow(loo.id))?.active).toBe(true);
  });

  it("rejects a removal for a toilet that no longer exists", async () => {
    const missing = randomBytes(12).toString("hex");
    const change = await seedPending("remove", missing, { reason: "permanently_closed" });
    const response = await approve(change.id);
    expect(noticeOf(response)).toBe("/admin/pending?notice=loo-missing");
    expect(await statusOf(change.id)).toBe("rejected");
  });

  it("processes an end-to-end anonymous report through approval", async () => {
    const loo = await fixtures.loos.create();
    const queued = await callApi(
      `/api/loos/${loo.id}/report`,
      jsonRequest("POST", { reason: "permanently_closed", details: "Gone" }),
    );
    expect(queued.status).toBe(202);
    const { id } = await readJson<{ id: string }>(queued);
    cleanupManager.trackPendingChange(id);

    const response = await approve(id, await renderedReviewedVersion(id));
    expect(noticeOf(response)).toBe("/admin/pending?notice=approved");
    const detail = await readJson<LooResponse>(await callApi(`/api/loos/${loo.id}`));
    expect(detail.active).toBe(false);
    expect(detail.removalCategory).toBe("permanently_closed");
    expect(detail.removalReason).toBe("Gone");
  });
});

describe("moderating restore requests", () => {
  it("labels and approves a restore request", async () => {
    const loo = await fixtures.loos.create();
    await removeLoo(loo);
    const change = await seedPending("restore", loo.id, { details: "Reopened in May" });

    const html = await pendingPage();
    expect(html).toContain("Restore request");
    expect(html).toContain("Reopened in May");
    expect(html).toContain("Removed (Permanently closed)");

    const response = await approve(change.id, await renderedReviewedVersion(change.id));
    expect(noticeOf(response)).toBe("/admin/pending?notice=approved");
    const row = await looRow(loo.id);
    expect(row?.active).toBe(true);
    expect(row?.removal_category).toBeNull();
  });

  it("applies a double-submitted restore approval once", async () => {
    const loo = await fixtures.loos.create();
    await removeLoo(loo);
    const change = await seedPending("restore", loo.id, {});
    const contributorsBefore = (await looRow(loo.id))?.contributors.length ?? 0;

    const results = await Promise.all([approve(change.id), approve(change.id)]);
    expect(results.map(noticeOf).sort()).toEqual([
      "/admin/pending?notice=already-reviewed",
      "/admin/pending?notice=approved",
    ]);
    expect((await looRow(loo.id))?.contributors).toHaveLength(contributorsBefore + 1);
  });

  it("keeps a restore pending on conflict and approves as a no-op when already active", async () => {
    const loo = await fixtures.loos.create();
    await removeLoo(loo);
    const change = await seedPending("restore", loo.id, {});
    const reviewed = await renderedReviewedVersion(change.id);

    // Someone restores it directly between review and approval.
    const restored = await callApi(
      `/api/loos/${loo.id}/restore`,
      jsonRequest("POST", {}, { Authorization: `Bearer ${getTestContext().issueToken()}` }),
    );
    expect(restored.status).toBe(200);

    const conflict = await approve(change.id, reviewed);
    expect(noticeOf(conflict)).toBe("/admin/pending?notice=conflict");
    expect(await statusOf(change.id)).toBe("pending");

    const noop = await approve(change.id);
    expect(noticeOf(noop)).toBe("/admin/pending?notice=approved-noop");
    expect(await statusOf(change.id)).toBe("approved");
  });
});

describe("pending queue pagination and count", () => {
  const seedMany = async (count: number) => {
    const loo = await fixtures.loos.create();
    // Recent but in the past, so other tests' rows are never pushed off page 1.
    const base = Date.now() - (count + 1) * 1000;
    const rows = [];
    for (let i = 0; i < count; i++) {
      rows.push(
        await seedPending(
          "update",
          loo.id,
          { notes: `Paged note ${i}` },
          { submittedAt: new Date(base + i * 1000) },
        ),
      );
    }
    return rows;
  };

  const rowsOnPage = (html: string) =>
    (html.match(/action="\/admin\/pending\/[^"]+\/approve"/g) ?? []).length;

  it("pages the queue 25 at a time, newest first by default", async () => {
    const seeded = await seedMany(30);
    const newest = seeded.at(-1);
    const total = await new PendingChangeService(getPrismaClient()).countPending();
    const pageCount = Math.ceil(total / 25);

    const first = await pendingPage();
    expect(rowsOnPage(first)).toBe(25);
    expect(first).toContain(`${total} pending changes · Page 1 of ${pageCount}`);
    expect(first).toContain(`/admin/pending/${newest?.id}/approve`);
    expect(first).toContain('rel="next" href="/admin/pending?page=2"');

    const oldestFirst = await pendingPage("?order=oldest");
    expect(oldestFirst).not.toContain(`/admin/pending/${newest?.id}/approve`);

    const second = await pendingPage("?page=2");
    expect(second).toContain(`Page 2 of ${pageCount}`);
    expect(second).toContain('rel="prev" href="/admin/pending?page=1"');

    // Past the end clamps to the last page.
    const beyond = await pendingPage("?page=9999");
    expect(beyond).toContain(`Page ${pageCount} of ${pageCount}`);
  });

  it("lists pages through the service with stable ordering", async () => {
    await seedMany(3);
    const service = new PendingChangeService(getPrismaClient());
    const page = await service.listPending({ pageSize: 2, order: "newest" });
    expect(page.rows).toHaveLength(2);
    expect(page.pageSize).toBe(2);
    expect(page.total).toBe(await service.countPending());
    const [a, b] = page.rows;
    expect(a && b && a.submitted_at.getTime() >= b.submitted_at.getTime()).toBe(true);
  });

  it("shows the pending count as a nav badge on admin pages", async () => {
    await seedMany(1);
    const count = await new PendingChangeService(getPrismaClient()).countPending();
    const response = await callApi("/admin/loos", { headers: adminHeaders() });
    const html = await response.text();
    expect(html).toContain('class="nav-badge"');
    expect(html).toContain(`${count} ${count === 1 ? "change" : "changes"} awaiting review`);
  });
});
