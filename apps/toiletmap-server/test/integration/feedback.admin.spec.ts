/**
 * The admin feedback inbox: auth on list, confirm and delete; newest-first
 * pagination; escaping of submitted text; the two-step delete; and that the
 * worker's database role (toiletmap_web) may delete feedback
 * (migration 20261118001500_feedback_admin_delete.sql).
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { __adminRoleTestUtils } from "../../src/middleware/require-admin-role";
import { createPrismaClient } from "../../src/prisma";
import { getPrismaClient } from "./setup";
import { cleanupManager } from "./utils/cleanup";
import { getTestDatabaseUrl } from "./utils/env";
import { sessionHeaders } from "./utils/session";
import { callApi } from "./utils/test-client";

const feedbackSessionHeaders = (permissions: string[]) =>
  sessionHeaders({
    sub: permissions.length ? "auth0|feedback-admin" : "auth0|feedback-member",
    permissions,
    profile: { email: "someone@example.com", name: "Test User" },
  });

const adminHeaders = () => {
  __adminRoleTestUtils.clearPermissionCache();
  return feedbackSessionHeaders(["access:admin"]);
};

const memberHeaders = () => {
  __adminRoleTestUtils.clearPermissionCache();
  return feedbackSessionHeaders([]);
};

/** Far-future timestamps keep seeded rows at the top of the newest-first list. */
const FUTURE = Date.parse("2100-01-01T00:00:00.000Z");

const seed = async (
  text: string,
  extra: { email?: string | null; route?: string; createdAt?: Date } = {},
) => {
  const row = await getPrismaClient().feedback.create({
    data: {
      feedback_text: text,
      email: extra.email ?? null,
      route: extra.route ?? "/",
      created_at: extra.createdAt ?? new Date(FUTURE),
    },
  });
  cleanupManager.trackFeedback(row.id);
  return row;
};

const tag = () => `fba-${randomBytes(6).toString("hex")}`;

const confirmForm = (confirm?: string) => {
  const body = new URLSearchParams();
  if (confirm !== undefined) body.set("confirm", confirm);
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  };
};

const exists = async (id: number) =>
  (await getPrismaClient().feedback.findUnique({ where: { id } })) !== null;

describe("admin feedback: access control", () => {
  it("redirects signed-out visitors to login on list, confirm and delete", async () => {
    const row = await seed(tag());
    for (const [path, init] of [
      ["/admin/feedback", undefined],
      [`/admin/feedback/${row.id}/delete`, undefined],
      [`/admin/feedback/${row.id}/delete`, confirmForm("delete")],
    ] as const) {
      const response = await callApi(path, init ? { ...init } : undefined);
      expect(response.status, path).toBe(302);
      expect(response.headers.get("location")).toBe("/admin/login");
    }
    expect(await exists(row.id)).toBe(true);
  });

  it("denies signed-in users without admin access, and deletes nothing", async () => {
    const text = tag();
    const row = await seed(text, { email: "private@example.org" });

    const list = await callApi("/admin/feedback", { headers: memberHeaders() });
    expect(list.status).toBe(403);
    const html = await list.text();
    expect(html).not.toContain(text);
    expect(html).not.toContain("private@example.org");

    const confirm = await callApi(`/admin/feedback/${row.id}/delete`, { headers: memberHeaders() });
    expect(confirm.status).toBe(403);

    const init = confirmForm("delete");
    const del = await callApi(`/admin/feedback/${row.id}/delete`, {
      ...init,
      headers: { ...init.headers, ...memberHeaders() },
    });
    expect(del.status).toBe(403);
    expect(await exists(row.id)).toBe(true);
  });
});

describe("admin feedback: list", () => {
  it("shows feedback newest first with the email, escaped, and is linked from the nav", async () => {
    const older = tag();
    const newer = tag();
    await seed(`${older} <b>older</b>`, { createdAt: new Date(FUTURE - 60_000) });
    await seed(`${newer} <script>alert("x")</script>\nsecond line`, {
      email: "reply@example.org",
      route: "/loos/<id>",
    });

    const response = await callApi("/admin/feedback", { headers: adminHeaders() });
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain('href="/admin/feedback"');
    expect(html.indexOf(newer)).toBeGreaterThan(-1);
    expect(html.indexOf(newer)).toBeLessThan(html.indexOf(older));
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("&lt;b&gt;older&lt;/b&gt;");
    expect(html).toContain("/loos/&lt;id&gt;");
    expect(html).toContain("reply@example.org");
  });

  it("paginates 25 to a page", async () => {
    const prefix = tag();
    // 26 rows, one minute apart: #0 is the newest.
    const rows = [];
    for (let i = 0; i < 26; i++) {
      rows.push(
        await seed(`${prefix}-${String(i).padStart(2, "0")}`, {
          createdAt: new Date(FUTURE + 3_600_000 - i * 60_000),
        }),
      );
    }

    const first = await (await callApi("/admin/feedback", { headers: adminHeaders() })).text();
    expect(first).toContain(`${prefix}-00`);
    expect(first).toContain(`${prefix}-24`);
    expect(first).not.toContain(`${prefix}-25`);
    expect(first).toContain('rel="next" href="/admin/feedback?page=2"');

    const second = await (
      await callApi("/admin/feedback?page=2", { headers: adminHeaders() })
    ).text();
    expect(second).toContain(`${prefix}-25`);
    expect(second).not.toContain(`${prefix}-00`);
    expect(second).toContain('rel="prev" href="/admin/feedback?page=1"');
    expect(rows).toHaveLength(26);
  });
});

describe("admin feedback: delete", () => {
  it("asks for confirmation before deleting", async () => {
    const text = tag();
    const row = await seed(text, { email: "reply@example.org" });

    const confirm = await callApi(`/admin/feedback/${row.id}/delete`, { headers: adminHeaders() });
    expect(confirm.status).toBe(200);
    const html = await confirm.text();
    expect(html).toContain(text);
    expect(html).toContain(`action="/admin/feedback/${row.id}/delete"`);
    expect(html).toContain('name="confirm" value="delete"');
    expect(await exists(row.id)).toBe(true);
  });

  it("refuses a POST without the confirmation field", async () => {
    const row = await seed(tag());
    for (const confirm of [undefined, "yes", ""]) {
      const init = confirmForm(confirm);
      const response = await callApi(`/admin/feedback/${row.id}/delete`, {
        ...init,
        headers: { ...init.headers, ...adminHeaders() },
      });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/admin/feedback?notice=confirm-required");
    }
    expect(await exists(row.id)).toBe(true);
  });

  it("deletes with confirmation, then reports not found", async () => {
    const row = await seed(tag());
    const send = () => {
      const init = confirmForm("delete");
      return callApi(`/admin/feedback/${row.id}/delete`, {
        ...init,
        headers: { ...init.headers, ...adminHeaders() },
      });
    };

    const first = await send();
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe("/admin/feedback?notice=deleted");
    expect(await exists(row.id)).toBe(false);

    const again = await send();
    expect(again.headers.get("location")).toBe("/admin/feedback?notice=not-found");

    const notice = await callApi("/admin/feedback?notice=deleted", { headers: adminHeaders() });
    expect(await notice.text()).toContain("Feedback deleted.");
  });

  it("treats malformed ids as not found", async () => {
    for (const id of ["abc", "0", "-1", "1.5", "99999999999"]) {
      const confirm = await callApi(`/admin/feedback/${id}/delete`, { headers: adminHeaders() });
      expect(confirm.headers.get("location"), id).toBe("/admin/feedback?notice=not-found");
    }
  });

  it("is allowed for the worker's database role (toiletmap_web)", async () => {
    const row = await seed(tag());
    const url = new URL(getTestDatabaseUrl());
    url.username = "toiletmap_web";
    url.password = "toiletmap_web";
    const web = createPrismaClient(url.toString());
    try {
      const { count } = await web.feedback.deleteMany({ where: { id: row.id } });
      expect(count).toBe(1);
    } finally {
      await web.$disconnect();
    }
    expect(await exists(row.id)).toBe(false);
  });
});
