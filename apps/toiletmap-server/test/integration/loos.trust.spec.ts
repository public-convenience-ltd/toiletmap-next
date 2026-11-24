/**
 * The trust rule for direct writes (create, edit, report, restore): anyone
 * signed in writes directly unless Auth0 reports them blocked. Anonymous and
 * blocked callers, and anyone whose block status cannot be confirmed, are
 * queued for moderation. Without Auth0 Management config (local dev) nobody
 * counts as blocked. Verification is never moderated.
 *
 * Kept apart from loos.report.spec.ts because every request opens its own
 * database pool: one file with all of these exhausts local Postgres slots.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/types";
import { getPrismaClient, getTestContext } from "./setup";
import {
  BLOCKED_SUB,
  LOOKUP_FAILS_SUB,
  useAuth0ManagementStub,
  WITHOUT_MANAGEMENT_ENV,
} from "./utils/auth0-management";
import { cleanupManager } from "./utils/cleanup";
import { createFixtureFactory } from "./utils/fixtures";
import type { QueuedBody, SavedLooBody } from "./utils/response-types";
import { TEST_ORIGIN } from "./utils/session";
import { callApi, jsonRequest, readJson } from "./utils/test-client";

const fixtures = createFixtureFactory();

/** Auth0's Management API is configured and stubbed for every test in this file. */
const isUserBlocked = useAuth0ManagementStub();

const bearer = (claims?: Parameters<ReturnType<typeof getTestContext>["issueToken"]>[0]) => ({
  Authorization: `Bearer ${getTestContext().issueToken(claims)}`,
});

/** Signed in with no permissions at all (the default test token). */
const signedInHeaders = () => bearer();
const adminHeaders = () => bearer({ sub: "auth0|admin-only", permissions: ["access:admin"] });
const BLOCKED_NICKNAME = "blocked-contributor";
const blockedHeaders = () =>
  bearer({ sub: BLOCKED_SUB, app_metadata: { nickname: BLOCKED_NICKNAME } });
const lookupFailsHeaders = () => bearer({ sub: LOOKUP_FAILS_SUB });

const pendingRow = (id: string) => {
  cleanupManager.trackPendingChange(id);
  return getPrismaClient().pending_change.findUnique({ where: { id } });
};

/** Somewhere in the Highlands, away from other tests' loos. */
const uniqueLocation = () => ({
  lat: 56.5 + Math.random() * 1.5,
  lng: -5 + Math.random() * 1.5,
});

describe("direct writes: anyone signed in, unless blocked in Auth0", () => {
  type Headers = Record<string, string>;
  type Options = { env?: Partial<Env> };

  /** Each moderated write, sent against a fresh loo. */
  const writes = [
    {
      name: "create",
      direct: 201,
      queuedType: "create",
      send: (headers: Headers, options: Options = {}) =>
        callApi(
          "/api/loos",
          jsonRequest(
            "POST",
            { name: `Trust rule ${randomBytes(4).toString("hex")}`, location: uniqueLocation() },
            headers,
          ),
          options,
        ),
    },
    {
      name: "edit",
      direct: 200,
      queuedType: "update",
      send: async (headers: Headers, options: Options = {}) => {
        const loo = await fixtures.loos.create({ notes: "Original" });
        return callApi(
          `/api/loos/${loo.id}`,
          jsonRequest("PUT", { notes: "Changed" }, headers),
          options,
        );
      },
    },
    {
      name: "report",
      direct: 200,
      queuedType: "remove",
      send: async (headers: Headers, options: Options = {}) => {
        const loo = await fixtures.loos.create();
        return callApi(
          `/api/loos/${loo.id}/report`,
          jsonRequest("POST", { reason: "not_public" }, headers),
          options,
        );
      },
    },
    {
      name: "restore",
      direct: 200,
      queuedType: "restore",
      send: async (headers: Headers, options: Options = {}) => {
        const loo = await fixtures.loos.create({ active: false });
        return callApi(`/api/loos/${loo.id}/restore`, jsonRequest("POST", {}, headers), options);
      },
    },
  ] as const;

  /** Asserts a direct write and tracks a created loo for cleanup. */
  const expectDirect = async (response: Response, status: number) => {
    expect(response.status).toBe(status);
    const body = await readJson<SavedLooBody & { queued?: boolean }>(response);
    expect(body.queued).toBeUndefined();
    if (status === 201) cleanupManager.trackLoo(body.id);
  };

  /** Asserts a queued write of `type` and tracks it for cleanup. */
  const expectQueued = async (response: Response, type: string) => {
    expect(response.status).toBe(202);
    const body = await readJson<QueuedBody>(response);
    expect(body.queued).toBe(true);
    expect((await pendingRow(body.id))?.type).toBe(type);
  };

  it.each(writes)("$name: a signed-in user with no permissions writes directly", async (write) => {
    await expectDirect(await write.send(signedInHeaders()), write.direct);
    expect(isUserBlocked()).toHaveBeenCalledWith("auth0|integration-test-user");
  });

  it.each(writes)("$name: a blocked user is queued", async (write) => {
    await expectQueued(await write.send(blockedHeaders()), write.queuedType);
  });

  it.each(writes)(
    "$name: a user whose block status cannot be confirmed is queued",
    async (write) => {
      await expectQueued(await write.send(lookupFailsHeaders()), write.queuedType);
    },
  );

  it.each(writes)(
    "$name: in local development without Auth0 Management config, signed-in users write directly",
    async (write) => {
      await expectDirect(
        await write.send(blockedHeaders(), { env: WITHOUT_MANAGEMENT_ENV }),
        write.direct,
      );
      expect(isUserBlocked()).not.toHaveBeenCalled();
    },
  );

  it("verify is never moderated: signed-in, blocked and unconfirmed users all verify", async () => {
    for (const headers of [signedInHeaders(), blockedHeaders(), lookupFailsHeaders()]) {
      const loo = await fixtures.loos.create();
      const response = await callApi(`/api/loos/${loo.id}/verify`, { method: "POST", headers });
      expect(response.status).toBe(200);
    }
  });

  it("asks Auth0 about a user at most once a minute", async () => {
    await expectQueued(await writes[1].send(blockedHeaders()), "update");
    await expectQueued(await writes[2].send(blockedHeaders()), "remove");
    expect(isUserBlocked()).toHaveBeenCalledTimes(1);
  });

  it("does not let a blocked user's PUT create a loo", async () => {
    const id = randomBytes(12).toString("hex");
    const response = await callApi(
      `/api/loos/${id}`,
      jsonRequest("PUT", { name: "Nope" }, blockedHeaders()),
    );
    expect(response.status).toBe(404);
    expect(await getPrismaClient().toilets.findUnique({ where: { id } })).toBeNull();
  });

  it("queues a blocked user's PUT diff with the submitter and leaves the loo alone", async () => {
    const loo = await fixtures.loos.create({ notes: "Original" });
    const response = await callApi(
      `/api/loos/${loo.id}`,
      jsonRequest("PUT", { notes: "Suggested" }, blockedHeaders()),
    );
    expect(response.status).toBe(202);
    const row = await pendingRow((await readJson<QueuedBody>(response)).id);
    expect(row?.payload).toEqual({ notes: "Suggested" });
    expect(row?.submitted_by).toBe(BLOCKED_NICKNAME);
    const live = await getPrismaClient().toilets.findUnique({ where: { id: loo.id } });
    expect(live?.notes).toBe("Original");
  });

  it("still writes directly for an admin", async () => {
    const loo = await fixtures.loos.create({ notes: "Original" });
    const asAdmin = await callApi(
      `/api/loos/${loo.id}`,
      jsonRequest("PUT", { notes: "By admin" }, adminHeaders()),
    );
    expect(asAdmin.status).toBe(200);
    expect((await readJson<SavedLooBody>(asAdmin)).notes).toBe("By admin");
  });
});

describe("direct-write edge cases", () => {
  /** A Cloudflare rate limiter stand-in that allows `limit` requests per key. */
  const countingLimiter = (limit: number) => {
    const counts = new Map<string, number>();
    return {
      limit: vi.fn(({ key }: { key: string }) => {
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        return Promise.resolve({ success: count <= limit });
      }),
    };
  };

  const editRequest = async (
    headers: Record<string, string>,
    options: { env?: Partial<Env> } = {},
  ) => {
    const loo = await fixtures.loos.create({ notes: "Original" });
    return callApi(
      `/api/loos/${loo.id}`,
      jsonRequest("PUT", { notes: `Changed ${randomBytes(4).toString("hex")}` }, headers),
      options,
    );
  };

  const expectQueuedEdit = async (response: Response) => {
    expect(response.status).toBe(202);
    const body = await readJson<QueuedBody>(response);
    expect(body.queued).toBe(true);
    expect((await pendingRow(body.id))?.type).toBe("update");
  };

  it("limits a blocked user to one queued change a minute, like an anonymous caller", async () => {
    const limiter = countingLimiter(1);
    const env = { RATE_LIMIT_ANON_WRITE: limiter };

    await expectQueuedEdit(await editRequest(blockedHeaders(), { env }));
    const loo = await fixtures.loos.create();
    const second = await callApi(
      `/api/loos/${loo.id}/report`,
      jsonRequest("POST", { reason: "not_public" }, blockedHeaders()),
      { env },
    );
    expect(second.status).toBe(429);
    expect(limiter.limit).toHaveBeenCalledWith({ key: `anon-write:user:${BLOCKED_SUB}` });
    expect(await getPrismaClient().pending_change.count({ where: { loo_id: loo.id } })).toBe(0);
  });

  it("does not apply the queued-change limit to direct writes", async () => {
    const limiter = countingLimiter(0);
    const response = await editRequest(signedInHeaders(), {
      env: { RATE_LIMIT_ANON_WRITE: limiter },
    });
    expect(response.status).toBe(200);
    expect(limiter.limit).not.toHaveBeenCalled();
  });

  it("limits signed-in writes per IP as well as per user", async () => {
    const limiter = countingLimiter(1);
    const env = { RATE_LIMIT_WRITE: limiter };
    const fromIp = (headers: Record<string, string>) => ({
      ...headers,
      "cf-connecting-ip": "203.0.113.50",
    });

    expect((await editRequest(fromIp(signedInHeaders()), { env })).status).toBe(200);
    // A second account from the same IP gets its own per-user budget but shares the IP's.
    const other = await editRequest(fromIp(bearer({ sub: "auth0|second-account" })), { env });
    expect(other.status).toBe(429);
    expect(limiter.limit).toHaveBeenCalledWith({ key: "write:user:auth0|second-account" });
    expect(limiter.limit).toHaveBeenCalledWith({ key: "write-ip:203.0.113.50" });
  });

  it("remembers a failed block lookup briefly instead of asking Auth0 on every write", async () => {
    await expectQueuedEdit(await editRequest(lookupFailsHeaders()));
    await expectQueuedEdit(await editRequest(lookupFailsHeaders()));
    expect(isUserBlocked()).toHaveBeenCalledTimes(1);
  });

  it.each(["production", "preview", undefined] as const)(
    "queues signed-in writes (ENVIRONMENT=%s) when the Management API is not configured",
    async (ENVIRONMENT) => {
      await expectQueuedEdit(
        await editRequest(signedInHeaders(), {
          env: { ...WITHOUT_MANAGEMENT_ENV, ENVIRONMENT },
        }),
      );
      expect(isUserBlocked()).not.toHaveBeenCalled();
    },
  );

  it("does not accept an id_token as a credential: the change is anonymous and queued", async () => {
    const { issueToken } = getTestContext();
    const sub = "auth0|id-token-only";
    const cookie = [
      `id_token=${issueToken({ sub, aud: process.env.AUTH0_CLIENT_ID })}`,
      "access_token=not-a-valid-token",
    ].join("; ");
    const loo = await fixtures.loos.create({ notes: "Original" });
    const response = await callApi(
      `/api/loos/${loo.id}`,
      jsonRequest("PUT", { notes: "Changed" }, { Cookie: cookie, Origin: TEST_ORIGIN }),
    );
    // The broken session is cleared.
    expect(response.headers.get("set-cookie")).toContain("access_token=;");
    await expectQueuedEdit(response);
    const queued = await getPrismaClient().pending_change.findFirst({
      where: { loo_id: loo.id },
    });
    expect(queued?.submitted_by).toBeNull();
    expect(isUserBlocked()).not.toHaveBeenCalled();
  });

  it("queues a machine-to-machine token without asking Auth0, unless it carries access:admin", async () => {
    const m2m = { sub: "integration-m2m-client@clients", gty: "client-credentials" };
    await expectQueuedEdit(await editRequest(bearer(m2m)));

    const asAdmin = await editRequest(bearer({ ...m2m, permissions: ["access:admin"] }));
    expect(asAdmin.status).toBe(200);
    expect(isUserBlocked()).not.toHaveBeenCalled();
  });
});
