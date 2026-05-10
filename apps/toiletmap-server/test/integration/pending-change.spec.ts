import { describe, expect, it } from "vitest";
import { __adminRoleTestUtils } from "../../src/middleware/require-admin-role";
import { getPrismaClient, getTestContext } from "./setup";
import { cleanupManager } from "./utils/cleanup";
import { createFixtureFactory } from "./utils/fixtures";
import { callApi } from "./utils/test-client";

const fixtures = createFixtureFactory();

const buildAdminCookie = () => {
  const { issueToken } = getTestContext();
  const sub = "auth0|test-admin";

  // access_token: verified against AUTH0_AUDIENCE — must carry the admin permission
  const accessToken = issueToken({ sub, permissions: ["access:admin"] });
  // id_token: verified against AUTH0_CLIENT_ID (fallback if access_token check fails)
  const idToken = issueToken({ sub, aud: process.env.AUTH0_CLIENT_ID });

  const user = { sub, email: "admin@example.com", name: "Test Admin" };
  const encodedUser = Buffer.from(JSON.stringify(user)).toString("base64");

  return `id_token=${idToken}; access_token=${accessToken}; user_info=${encodedUser}`;
};

const adminHeaders = () => ({ Cookie: buildAdminCookie() });

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
      expect(response.headers.get("location")).toBe("/admin/pending");

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
      expect(response.headers.get("location")).toBe("/admin/pending");

      const prisma = getPrismaClient();
      const updated = await prisma.pending_change.findUnique({ where: { id: change.id } });
      expect(updated?.status).toBe("rejected");

      const looCountAfter = await prisma.toilets.count();
      expect(looCountAfter).toBe(looCountBefore);
    });
  });

  describe("POST /admin/pending/:id/approve — already processed", () => {
    it("returns 404 for a change that has already been processed", async () => {
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

      // Try to approve again
      const response = await callApi(`/admin/pending/${change.id}/approve`, {
        method: "POST",
        headers: adminHeaders(),
      });

      expect(response.status).toBe(404);
    });
  });
});
