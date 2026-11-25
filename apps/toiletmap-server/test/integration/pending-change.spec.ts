import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { __adminRoleTestUtils } from "../../src/middleware/require-admin-role";
import { getPrismaClient, getTestContext } from "./setup";
import { cleanupManager } from "./utils/cleanup";
import { createFixtureFactory } from "./utils/fixtures";
import { sessionHeaders } from "./utils/session";
import { callApi, jsonRequest } from "./utils/test-client";

const fixtures = createFixtureFactory();

// access_token: verified against AUTH0_AUDIENCE, carries the admin permission;
// id_token: verified against AUTH0_CLIENT_ID, supplies only the profile.
const adminHeaders = () =>
  sessionHeaders({
    sub: "auth0|test-admin",
    permissions: ["access:admin"],
    profile: { email: "admin@example.com", name: "Test Admin" },
  });

const seedPendingCreate = async (payload = {}) => {
  const prisma = getPrismaClient();
  const record = await prisma.pending_change.create({
    data: {
      type: "create",
      loo_id: null,
      payload: {
        name: "Pending New Loo",
        location: { lat: 51.5, lng: -0.1 },
        ...payload,
      },
      ip: "127.0.0.1",
    },
  });
  cleanupManager.trackPendingChange(record.id);
  return record;
};

const seedPendingUpdate = async (looId: string, payload = {}) => {
  const prisma = getPrismaClient();
  const record = await prisma.pending_change.create({
    data: {
      type: "update",
      loo_id: looId,
      payload: {
        notes: "Updated via pending change",
        ...payload,
      },
      ip: "127.0.0.1",
    },
  });
  cleanupManager.trackPendingChange(record.id);
  return record;
};

describe("Admin pending-change review", () => {
  describe("GET /admin/pending", () => {
    it("shows the pending list page for an admin", async () => {
      __adminRoleTestUtils.clearPermissionCache();
      const response = await callApi("/admin/pending", { headers: adminHeaders() });
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("Pending Changes");
    });

    it("redirects unauthenticated requests to login", async () => {
      const response = await callApi("/admin/pending", { method: "GET" });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toContain("/admin/login");
    });
  });

  describe("POST /admin/pending/:id/approve — create", () => {
    it("creates a loo from a pending create change and redirects", async () => {
      __adminRoleTestUtils.clearPermissionCache();
      const change = await seedPendingCreate({ name: "Approved New Loo" });

      const response = await callApi(`/admin/pending/${change.id}/approve`, {
        method: "POST",
        headers: adminHeaders(),
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/admin/pending?notice=approved");

      const prisma = getPrismaClient();
      const updated = await prisma.pending_change.findUnique({ where: { id: change.id } });
      expect(updated?.status).toBe("approved");

      // Verify a loo was created with the submitted name
      const newLoo = await prisma.toilets.findFirst({
        where: { name: "Approved New Loo" },
        orderBy: { created_at: "desc" },
      });
      expect(newLoo).not.toBeNull();
      if (newLoo) cleanupManager.trackLoo(newLoo.id);
    });
  });

  describe("POST /admin/pending/:id/approve — update", () => {
    it("updates an existing loo from a pending update change and redirects", async () => {
      __adminRoleTestUtils.clearPermissionCache();
      const existingLoo = await fixtures.loos.create({ notes: "Before approval" });
      const change = await seedPendingUpdate(existingLoo.id, { notes: "After approval" });

      const response = await callApi(`/admin/pending/${change.id}/approve`, {
        method: "POST",
        headers: adminHeaders(),
      });

      expect(response.status).toBe(302);

      const prisma = getPrismaClient();
      const updated = await prisma.pending_change.findUnique({ where: { id: change.id } });
      expect(updated?.status).toBe("approved");

      const updatedLoo = await prisma.toilets.findUnique({ where: { id: existingLoo.id } });
      expect(updatedLoo?.notes).toBe("After approval");
    });
  });

  describe("POST /admin/pending/:id/reject", () => {
    it("marks the change as rejected without touching any loos", async () => {
      __adminRoleTestUtils.clearPermissionCache();
      const change = await seedPendingCreate({ name: "Should Not Be Created" });
      const looCountBefore = await getPrismaClient().toilets.count();

      const response = await callApi(`/admin/pending/${change.id}/reject`, {
        method: "POST",
        headers: adminHeaders(),
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/admin/pending?notice=rejected");

      const prisma = getPrismaClient();
      const updated = await prisma.pending_change.findUnique({ where: { id: change.id } });
      expect(updated?.status).toBe("rejected");

      const looCountAfter = await prisma.toilets.count();
      expect(looCountAfter).toBe(looCountBefore);
    });
  });

  describe("POST /admin/pending/:id/approve — already processed", () => {
    it("does not re-apply a change that has already been processed", async () => {
      __adminRoleTestUtils.clearPermissionCache();
      const change = await seedPendingCreate();

      // Approve once
      await callApi(`/admin/pending/${change.id}/approve`, {
        method: "POST",
        headers: adminHeaders(),
      });

      // Clean up the loo that was created
      const prisma = getPrismaClient();
      const newLoo = await prisma.toilets.findFirst({
        where: { name: "Pending New Loo" },
        orderBy: { created_at: "desc" },
      });
      if (newLoo) cleanupManager.trackLoo(newLoo.id);

      // Clear cache so requireAdminRole re-evaluates
      __adminRoleTestUtils.clearPermissionCache();

      const countBefore = await prisma.toilets.count({ where: { name: "Pending New Loo" } });

      // Try to approve again
      const response = await callApi(`/admin/pending/${change.id}/approve`, {
        method: "POST",
        headers: adminHeaders(),
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/admin/pending?notice=already-reviewed");

      const countAfter = await prisma.toilets.count({ where: { name: "Pending New Loo" } });
      expect(countAfter).toBe(countBefore);
    });
  });
});

describe("Admin pending-change integrity", () => {
  const approve = (id: string) => {
    __adminRoleTestUtils.clearPermissionCache();
    return callApi(`/admin/pending/${id}/approve`, { method: "POST", headers: adminHeaders() });
  };

  const reject = (id: string) => {
    __adminRoleTestUtils.clearPermissionCache();
    return callApi(`/admin/pending/${id}/reject`, { method: "POST", headers: adminHeaders() });
  };

  it("applies a double-submitted approval exactly once", async () => {
    const existingLoo = await fixtures.loos.create({ notes: "Before approval" });
    const change = await seedPendingUpdate(existingLoo.id, { notes: "Approved once" });
    const prisma = getPrismaClient();

    const [first, second] = await Promise.all([approve(change.id), approve(change.id)]);
    const locations = [first, second].map((r) => r.headers.get("location"));
    expect(locations).toContain("/admin/pending?notice=approved");
    expect(locations).toContain("/admin/pending?notice=already-reviewed");

    const third = await approve(change.id);
    expect(third.headers.get("location")).toBe("/admin/pending?notice=already-reviewed");

    const after = await prisma.toilets.findUnique({ where: { id: existingLoo.id } });
    expect(after?.notes).toBe("Approved once");
    // The fixture contributed once; the approval should add exactly one more entry.
    expect(after?.contributors).toHaveLength(2);
  });

  it("applies a double-submitted create approval exactly once", async () => {
    const name = `Pending Once ${Date.now()}`;
    const change = await seedPendingCreate({ name });
    const prisma = getPrismaClient();

    await Promise.all([approve(change.id), approve(change.id)]);

    const created = await prisma.toilets.findMany({ where: { name } });
    for (const loo of created) cleanupManager.trackLoo(loo.id);
    expect(created).toHaveLength(1);
  });

  it("does not approve a change that was already rejected", async () => {
    const existingLoo = await fixtures.loos.create({ notes: "Keep me" });
    const change = await seedPendingUpdate(existingLoo.id, { notes: "Rejected edit" });

    const rejected = await reject(change.id);
    expect(rejected.headers.get("location")).toBe("/admin/pending?notice=rejected");

    const approved = await approve(change.id);
    expect(approved.headers.get("location")).toBe("/admin/pending?notice=already-reviewed");

    const prisma = getPrismaClient();
    const loo = await prisma.toilets.findUnique({ where: { id: existingLoo.id } });
    expect(loo?.notes).toBe("Keep me");
    const row = await prisma.pending_change.findUnique({ where: { id: change.id } });
    expect(row?.status).toBe("rejected");
  });

  it("does not reject a change twice", async () => {
    const change = await seedPendingCreate({ name: "Reject twice" });
    await reject(change.id);
    const second = await reject(change.id);
    expect(second.headers.get("location")).toBe("/admin/pending?notice=already-reviewed");
  });

  it("only applies the stored diff when the toilet was edited after submission", async () => {
    const existingLoo = await fixtures.loos.create({
      notes: "Original notes",
      radar: false,
      babyChange: false,
    });
    const change = await seedPendingUpdate(existingLoo.id, { notes: "Anonymous notes" });

    // An authenticated editor changes other fields in the meantime.
    const { issueToken } = getTestContext();
    const edit = await callApi(
      `/api/loos/${existingLoo.id}`,
      jsonRequest(
        "PUT",
        { radar: true, babyChange: true },
        { Authorization: `Bearer ${issueToken()}` },
      ),
    );
    expect(edit.status).toBe(200);

    const response = await approve(change.id);
    expect(response.headers.get("location")).toBe("/admin/pending?notice=approved");

    const prisma = getPrismaClient();
    const after = await prisma.toilets.findUnique({ where: { id: existingLoo.id } });
    expect(after?.notes).toBe("Anonymous notes");
    // The intervening edit survives: approval did not reset fields outside the diff.
    expect(after?.radar).toBe(true);
    expect(after?.baby_change).toBe(true);
  });

  it("skips stored fields that already match the current record", async () => {
    const existingLoo = await fixtures.loos.create({ notes: "Already there" });
    const change = await seedPendingUpdate(existingLoo.id, { notes: "Already there" });
    const prisma = getPrismaClient();
    const before = await prisma.toilets.findUnique({ where: { id: existingLoo.id } });

    const response = await approve(change.id);
    expect(response.headers.get("location")).toBe("/admin/pending?notice=approved-noop");

    const after = await prisma.toilets.findUnique({ where: { id: existingLoo.id } });
    expect(after?.updated_at?.getTime()).toBe(before?.updated_at?.getTime());
    const row = await prisma.pending_change.findUnique({ where: { id: change.id } });
    expect(row?.status).toBe("approved");
  });

  it("does not insert a toilet when approving an update for a missing loo", async () => {
    const missingId = randomBytes(12).toString("hex");
    const change = await seedPendingUpdate(missingId, { notes: "Ghost edit" });

    const response = await approve(change.id);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/admin/pending?notice=loo-missing");

    const prisma = getPrismaClient();
    const loo = await prisma.toilets.findUnique({ where: { id: missingId } });
    expect(loo).toBeNull();
    const row = await prisma.pending_change.findUnique({ where: { id: change.id } });
    expect(row?.status).toBe("rejected");
  });

  describe("approval is bound to the version the moderator reviewed", () => {
    /** Reads the reviewed-version token rendered into a change's approve form. */
    const renderedReviewedVersion = async (changeId: string): Promise<string> => {
      __adminRoleTestUtils.clearPermissionCache();
      const response = await callApi("/admin/pending", { headers: adminHeaders() });
      const html = await response.text();
      const form = new RegExp(
        `action="/admin/pending/${changeId}/approve">[\\s\\S]*?name="reviewedUpdatedAt"[\\s\\S]*?value="([^"]*)"`,
      ).exec(html);
      if (!form) throw new Error(`No reviewed version rendered for change ${changeId}`);
      return form[1] ?? "";
    };

    const approveReviewed = (id: string, reviewedUpdatedAt: string) => {
      __adminRoleTestUtils.clearPermissionCache();
      return callApi(`/admin/pending/${id}/approve`, {
        method: "POST",
        headers: { ...adminHeaders(), "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ reviewedUpdatedAt }).toString(),
      });
    };

    it("renders the previewed record's updatedAt into the approve form", async () => {
      const existingLoo = await fixtures.loos.create({ notes: "Rendered version" });
      const change = await seedPendingUpdate(existingLoo.id, { notes: "Proposed" });

      const reviewed = await renderedReviewedVersion(change.id);
      expect(Date.parse(reviewed)).toBe(Date.parse(existingLoo.updatedAt ?? ""));
    });

    it("refuses to approve when the toilet was edited after the moderator reviewed it", async () => {
      const existingLoo = await fixtures.loos.create({ notes: "Reviewed notes", radar: false });
      const change = await seedPendingUpdate(existingLoo.id, { notes: "Anonymous notes" });
      const reviewed = await renderedReviewedVersion(change.id);

      // Someone edits the toilet between rendering and clicking approve.
      const { issueToken } = getTestContext();
      const edit = await callApi(
        `/api/loos/${existingLoo.id}`,
        jsonRequest("PUT", { radar: true }, { Authorization: `Bearer ${issueToken()}` }),
      );
      expect(edit.status).toBe(200);

      const prisma = getPrismaClient();
      const beforeApprove = await prisma.toilets.findUnique({ where: { id: existingLoo.id } });

      const response = await approveReviewed(change.id, reviewed);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/admin/pending?notice=conflict");

      // The claim was rolled back: the change is still pending for re-review.
      const row = await prisma.pending_change.findUnique({ where: { id: change.id } });
      expect(row?.status).toBe("pending");
      expect(row?.reviewed_by).toBeNull();
      expect(row?.reviewed_at).toBeNull();

      // And the toilet was not touched by the approval.
      const after = await prisma.toilets.findUnique({ where: { id: existingLoo.id } });
      expect(after).toEqual(beforeApprove);
      expect(after?.notes).toBe("Reviewed notes");
      expect(after?.radar).toBe(true);
    });

    it("approves when the reviewed version is still current", async () => {
      const existingLoo = await fixtures.loos.create({ notes: "Unchanged since review" });
      const change = await seedPendingUpdate(existingLoo.id, { notes: "Approved after review" });
      const reviewed = await renderedReviewedVersion(change.id);

      const response = await approveReviewed(change.id, reviewed);
      expect(response.headers.get("location")).toBe("/admin/pending?notice=approved");

      const prisma = getPrismaClient();
      const after = await prisma.toilets.findUnique({ where: { id: existingLoo.id } });
      expect(after?.notes).toBe("Approved after review");
      const row = await prisma.pending_change.findUnique({ where: { id: change.id } });
      expect(row?.status).toBe("approved");
    });
  });

  it("reports an unknown change id without throwing", async () => {
    const response = await approve("not-a-uuid");
    expect(response.headers.get("location")).toBe("/admin/pending?notice=not-found");
  });

  describe("GET /admin/pending moderator view", () => {
    it("shows a before/after table of changed fields only", async () => {
      const existingLoo = await fixtures.loos.create({
        name: "Diff Preview Loo",
        notes: "Old notes",
        radar: false,
      });
      await seedPendingUpdate(existingLoo.id, {
        notes: "New notes",
        radar: false,
        name: "Diff Preview Loo",
      });

      __adminRoleTestUtils.clearPermissionCache();
      const response = await callApi("/admin/pending", { headers: adminHeaders() });
      const html = await response.text();
      expect(html).toContain("Old notes");
      expect(html).toContain("New notes");
      expect(html).toContain("2 submitted fields already match");
    });

    it("labels deactivation as a removal request", async () => {
      const existingLoo = await fixtures.loos.create();
      await seedPendingUpdate(existingLoo.id, { active: false, removalReason: "Demolished" });

      __adminRoleTestUtils.clearPermissionCache();
      const response = await callApi("/admin/pending", { headers: adminHeaders() });
      const html = await response.text();
      expect(html).toContain("Removal request");
      expect(html).toContain("Demolished");
    });

    it("warns when the toilet changed since submission", async () => {
      const existingLoo = await fixtures.loos.create({ notes: "Stale base" });
      const prisma = getPrismaClient();
      const record = await prisma.pending_change.create({
        data: {
          type: "update",
          loo_id: existingLoo.id,
          payload: { notes: "Based on an old version" },
          ip: "127.0.0.1",
          base_updated_at: new Date(Date.parse(existingLoo.updatedAt ?? "") - 60_000),
        },
      });
      cleanupManager.trackPendingChange(record.id);

      __adminRoleTestUtils.clearPermissionCache();
      const response = await callApi("/admin/pending", { headers: adminHeaders() });
      const html = await response.text();
      expect(html).toContain("Changed since submission");
    });

    it("shows the notice for a completed review", async () => {
      __adminRoleTestUtils.clearPermissionCache();
      const response = await callApi("/admin/pending?notice=already-reviewed", {
        headers: adminHeaders(),
      });
      const html = await response.text();
      expect(html).toContain("already been reviewed");
    });
  });
});
