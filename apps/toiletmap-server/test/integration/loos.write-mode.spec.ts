/**
 * The write kill switch (audit H4 / B12; src/services/write-mode.ts), driven
 * through the SETTINGS KV namespace the way an operator would
 * (`wrangler kv key put write_mode ...`, docs/runbooks/kill-switch.md):
 * - no binding or no key: `open`, the normal trust rules;
 * - `read-only`: every loo write (admins included) and moderator
 *   approve/reject is refused with 503 `read_only` and `Retry-After`; reads
 *   and feedback still work;
 * - `queue`: every non-admin write is queued (202, `reason: "queue_mode"`);
 *   admins write directly; verify still applies.
 *
 * Without the Auth0 Management API (local dev) an `access:admin` claim is
 * enough to count as an admin and nobody is blocked.
 */
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { __adminRoleTestUtils } from "../../src/middleware/require-admin-role";
import { __writeModeTestUtils } from "../../src/services/write-mode";
import type { Env } from "../../src/types";
import { getPrismaClient, getTestContext } from "./setup";
import { cleanupManager } from "./utils/cleanup";
import { createFixtureFactory } from "./utils/fixtures";
import { FakeKvNamespace, settingsWithWriteMode } from "./utils/kv-fake";
import type { QueuedBody, SavedLooBody } from "./utils/response-types";
import { sessionHeaders } from "./utils/session";
import { callApi, jsonRequest, readJson } from "./utils/test-client";

const fixtures = createFixtureFactory();

type Headers = Record<string, string>;

const bearer = (claims?: Parameters<ReturnType<typeof getTestContext>["issueToken"]>[0]) => ({
  Authorization: `Bearer ${getTestContext().issueToken(claims)}`,
});
const contributor = () => bearer({ sub: "auth0|write-mode-contributor" });
const admin = () => bearer({ sub: "auth0|write-mode-admin", permissions: ["access:admin"] });

/** Somewhere in the Highlands, away from other tests' loos. */
const uniqueLocation = () => ({ lat: 56.5 + Math.random() * 1.5, lng: -5 + Math.random() * 1.5 });

const withMode = (mode: string): { env: Partial<Env> } => ({
  env: { SETTINGS: settingsWithWriteMode(mode) },
});

type ReadOnlyBody = { error: string; message: string };

const expectReadOnly = async (response: Response) => {
  expect(response.status).toBe(503);
  expect(response.headers.get("retry-after")).toBe("300");
  const body = await readJson<ReadOnlyBody>(response);
  expect(body.error).toBe("read_only");
  expect(body.message).toMatch(/paused/i);
};

/** Each loo write route, against a fresh loo. */
const writes = [
  {
    name: "POST /api/loos",
    send: (headers: Headers, options: { env: Partial<Env> }) =>
      callApi(
        "/api/loos",
        jsonRequest(
          "POST",
          { name: `Write mode ${randomBytes(4).toString("hex")}`, location: uniqueLocation() },
          headers,
        ),
        options,
      ),
  },
  {
    name: "PUT /api/loos/:id",
    send: async (headers: Headers, options: { env: Partial<Env> }) => {
      const loo = await fixtures.loos.create({ notes: "Before" });
      return callApi(
        `/api/loos/${loo.id}`,
        jsonRequest("PUT", { notes: "After" }, headers),
        options,
      );
    },
  },
  {
    name: "POST /api/loos/:id/report",
    send: async (headers: Headers, options: { env: Partial<Env> }) => {
      const loo = await fixtures.loos.create();
      return callApi(
        `/api/loos/${loo.id}/report`,
        jsonRequest("POST", { reason: "not_public" }, headers),
        options,
      );
    },
  },
  {
    name: "POST /api/loos/:id/restore",
    send: async (headers: Headers, options: { env: Partial<Env> }) => {
      const loo = await fixtures.loos.create({ active: false });
      return callApi(`/api/loos/${loo.id}/restore`, jsonRequest("POST", {}, headers), options);
    },
  },
  {
    name: "POST /api/loos/:id/verify",
    send: async (headers: Headers, options: { env: Partial<Env> }) => {
      const loo = await fixtures.loos.create();
      return callApi(`/api/loos/${loo.id}/verify`, { method: "POST", headers }, options);
    },
  },
] as const;

beforeEach(() => {
  __writeModeTestUtils.reset();
  __adminRoleTestUtils.clearPermissionCache();
});

describe("write_mode = read-only", () => {
  it.each(writes)("$name: refused for anonymous callers", async (write) => {
    await expectReadOnly(await write.send({}, withMode("read-only")));
  });

  it.each(writes)("$name: refused for signed-in contributors", async (write) => {
    await expectReadOnly(await write.send(contributor(), withMode("read-only")));
  });

  it.each(writes)("$name: refused for admins too", async (write) => {
    await expectReadOnly(await write.send(admin(), withMode("read-only")));
  });

  it("changes nothing in the database", async () => {
    const loo = await fixtures.loos.create({ notes: "Frozen" });
    const before = await getPrismaClient().pending_change.count();
    await expectReadOnly(
      await callApi(
        `/api/loos/${loo.id}`,
        jsonRequest("PUT", { notes: "Thawed" }, contributor()),
        withMode("read-only"),
      ),
    );
    await expectReadOnly(
      await callApi(`/api/loos/${loo.id}`, jsonRequest("PUT", { notes: "Queued?" }), {
        ...withMode("read-only"),
      }),
    );
    const row = await getPrismaClient().toilets.findUnique({ where: { id: loo.id } });
    expect(row?.notes).toBe("Frozen");
    expect(await getPrismaClient().pending_change.count()).toBe(before);
  });

  it("accepts the documented spellings and fails closed on an unknown value", async () => {
    for (const value of ["read-only", "readonly", " READ_ONLY ", "lockdown"]) {
      __writeModeTestUtils.reset();
      const loo = await fixtures.loos.create();
      await expectReadOnly(
        await callApi(`/api/loos/${loo.id}/verify`, { method: "POST" }, withMode(value)),
      );
    }
  });

  it("still serves reads", async () => {
    const loo = await fixtures.loos.create();
    const response = await callApi(`/api/loos/${loo.id}`, {}, withMode("read-only"));
    expect(response.status).toBe(200);
    expect((await readJson<SavedLooBody>(response)).id).toBe(loo.id);
  });

  it("keeps feedback open", async () => {
    const tag = `wm-${randomBytes(6).toString("hex")}`;
    const response = await callApi(
      "/api/feedback",
      jsonRequest(
        "POST",
        { text: `Read-only feedback ${tag}` },
        { "cf-connecting-ip": "203.0.113.9" },
      ),
      withMode("read-only"),
    );
    expect(response.status).toBe(200);
    const rows = await getPrismaClient().feedback.findMany({
      where: { feedback_text: { contains: tag } },
    });
    for (const row of rows) cleanupManager.trackFeedback(row.id);
    expect(rows).toHaveLength(1);
  });

  it("stops moderators approving or rejecting queued changes", async () => {
    const loo = await fixtures.loos.create({ notes: "Before review" });
    const prisma = getPrismaClient();
    const change = await prisma.pending_change.create({
      data: { type: "update", loo_id: loo.id, payload: { notes: "After review" }, ip: "127.0.0.1" },
    });
    cleanupManager.trackPendingChange(change.id);
    const adminSession = sessionHeaders({
      sub: "auth0|write-mode-moderator",
      permissions: ["access:admin"],
    });

    for (const action of ["approve", "reject"]) {
      const response = await callApi(
        `/admin/pending/${change.id}/${action}`,
        { method: "POST", headers: adminSession },
        withMode("read-only"),
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/admin/pending?notice=read-only");
    }

    expect((await prisma.pending_change.findUnique({ where: { id: change.id } }))?.status).toBe(
      "pending",
    );
    expect((await prisma.toilets.findUnique({ where: { id: loo.id } }))?.notes).toBe(
      "Before review",
    );
  });
});

describe("write_mode = queue", () => {
  const queuedWrites = writes.filter((write) => write.name !== "POST /api/loos/:id/verify");

  it.each(queuedWrites)("$name: a signed-in contributor is queued", async (write) => {
    const response = await write.send(contributor(), withMode("queue"));
    expect(response.status).toBe(202);
    const body = await readJson<QueuedBody & { reason?: string }>(response);
    cleanupManager.trackPendingChange(body.id);
    expect(body.queued).toBe(true);
    expect(body.reason).toBe("queue_mode");
    const row = await getPrismaClient().pending_change.findUnique({ where: { id: body.id } });
    expect(row?.submitter_sub).toBe("auth0|write-mode-contributor");
  });

  it.each(queuedWrites)("$name: an admin still writes directly", async (write) => {
    const response = await write.send(admin(), withMode("queue"));
    expect([200, 201]).toContain(response.status);
    const body = await readJson<SavedLooBody & { queued?: boolean }>(response);
    expect(body.queued).toBeUndefined();
    if (response.status === 201) cleanupManager.trackLoo(body.id);
  });

  it("still lets anyone verify", async () => {
    const loo = await fixtures.loos.create();
    const response = await callApi(
      `/api/loos/${loo.id}/verify`,
      { method: "POST", headers: contributor() },
      withMode("queue"),
    );
    expect(response.status).toBe(200);
  });
});

describe("write_mode = open, or no setting", () => {
  it("applies a contributor's edit directly with no SETTINGS binding", async () => {
    const loo = await fixtures.loos.create({ notes: "Before" });
    const response = await callApi(
      `/api/loos/${loo.id}`,
      jsonRequest("PUT", { notes: "After" }, contributor()),
    );
    expect(response.status).toBe(200);
  });

  it("applies it directly when the key is missing or set to open", async () => {
    for (const settings of [new FakeKvNamespace().asBinding(), settingsWithWriteMode("open")]) {
      __writeModeTestUtils.reset();
      const loo = await fixtures.loos.create({ notes: "Before" });
      const response = await callApi(
        `/api/loos/${loo.id}`,
        jsonRequest("PUT", { notes: "After" }, contributor()),
        { env: { SETTINGS: settings } },
      );
      expect(response.status).toBe(200);
    }
  });

  it("stays open when KV cannot be read and nothing was read before", async () => {
    const settings = new FakeKvNamespace({ write_mode: "read-only" });
    settings.failWith = new Error("KV unavailable");
    const loo = await fixtures.loos.create({ notes: "Before" });
    const response = await callApi(
      `/api/loos/${loo.id}`,
      jsonRequest("PUT", { notes: "After" }, contributor()),
      { env: { SETTINGS: settings.asBinding() } },
    );
    expect(response.status).toBe(200);
  });
});
