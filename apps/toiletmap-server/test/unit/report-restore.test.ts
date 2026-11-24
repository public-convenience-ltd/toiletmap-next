import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __adminRoleTestUtils, canWriteDirectly } from "../../src/middleware/require-admin-role";
import { reportSchema, restoreSchema } from "../../src/routes/loos/schemas";
import { Auth0ManagementClient } from "../../src/services/auth0/management";
import { clearRemovalOnReactivate } from "../../src/services/loo/diff";
import { DEFAULT_REMOVAL_REASONS } from "../../src/services/loo/loo.service";
import { REMOVAL_CATEGORIES } from "../../src/services/loo/types";
import {
  __moderationAlertTestUtils,
  isModerationAlertThreshold,
  MODERATION_ALERT_INTERVAL_MS,
  moderationAlertText,
  scheduleModerationAlert,
  sendModerationAlert,
  shouldSendModerationAlert,
} from "../../src/services/moderation-alert";
import type { AppVariables, Env, RequestUser } from "../../src/types";

const LOO_ID = "0123456789abcdef01234567";

describe("reportSchema", () => {
  it.each(REMOVAL_CATEGORIES.filter((reason) => reason !== "other" && reason !== "duplicate"))(
    "accepts %s without details",
    (reason) => {
      expect(reportSchema.safeParse({ reason }).success).toBe(true);
    },
  );

  it("requires details for other and trims them", () => {
    expect(reportSchema.safeParse({ reason: "other" }).success).toBe(false);
    expect(reportSchema.safeParse({ reason: "other", details: " \n " }).success).toBe(false);
    expect(reportSchema.parse({ reason: "other", details: "  Now a shop " }).details).toBe(
      "Now a shop",
    );
  });

  it("requires duplicateOf for duplicate and normalises it to lower case", () => {
    expect(reportSchema.safeParse({ reason: "duplicate" }).success).toBe(false);
    expect(
      reportSchema.parse({ reason: "duplicate", duplicateOf: LOO_ID.toUpperCase() }).duplicateOf,
    ).toBe(LOO_ID);
  });

  it("only allows duplicateOf with the duplicate reason", () => {
    const result = reportSchema.safeParse({ reason: "not_public", duplicateOf: LOO_ID });
    expect(result.success).toBe(false);
  });

  it("rejects unknown fields and over-long details", () => {
    expect(reportSchema.safeParse({ reason: "not_public", active: false }).success).toBe(false);
    expect(
      reportSchema.safeParse({ reason: "not_public", details: "x".repeat(2001) }).success,
    ).toBe(false);
  });

  it("has a default reason sentence for every category", () => {
    for (const reason of REMOVAL_CATEGORIES) {
      expect(DEFAULT_REMOVAL_REASONS[reason]).toMatch(/\.$/);
    }
  });
});

describe("restoreSchema", () => {
  it("accepts an empty body and drops blank details", () => {
    expect(restoreSchema.parse({})).toEqual({});
    expect(restoreSchema.parse({ details: "  " }).details).toBeUndefined();
  });

  it("validates baseUpdatedAt", () => {
    expect(restoreSchema.safeParse({ baseUpdatedAt: "soon" }).success).toBe(false);
    expect(restoreSchema.safeParse({ baseUpdatedAt: "2026-11-17T09:00:00.000Z" }).success).toBe(
      true,
    );
  });
});

describe("clearRemovalOnReactivate", () => {
  const removed = {
    active: false,
    removalCategory: "duplicate",
    removalReason: "Reported as a duplicate of another toilet.",
    duplicateOf: LOO_ID,
  };

  it("clears the category, reason and duplicate link when a removed loo is reactivated", () => {
    expect(clearRemovalOnReactivate({ active: true }, removed)).toEqual({
      active: true,
      removalCategory: null,
      removalReason: null,
      duplicateOf: null,
    });
  });

  it("keeps removal fields the change sets itself", () => {
    expect(
      clearRemovalOnReactivate({ active: true, removalReason: "Reopened after refit" }, removed),
    ).toEqual({
      active: true,
      removalCategory: null,
      removalReason: "Reopened after refit",
      duplicateOf: null,
    });
  });

  it("leaves other changes alone", () => {
    expect(clearRemovalOnReactivate({ notes: "x" }, removed)).toEqual({ notes: "x" });
    expect(clearRemovalOnReactivate({ active: false }, removed)).toEqual({ active: false });
    expect(
      clearRemovalOnReactivate(
        { active: true },
        { active: false, removalCategory: null, removalReason: null, duplicateOf: null },
      ),
    ).toEqual({ active: true });
  });
});

describe("canWriteDirectly", () => {
  const check = async (user: RequestUser | undefined, env: Partial<Env> = {}) => {
    const app = new Hono<{ Variables: AppVariables; Bindings: Env }>();
    let result: boolean | undefined;
    app.get("/", async (c) => {
      result = await canWriteDirectly(c, user);
      return c.text("ok");
    });
    await app.request("/", {}, env as Env);
    return result;
  };

  const managementEnv: Partial<Env> = {
    AUTH0_ISSUER_BASE_URL: "https://auth.example",
    AUTH0_MANAGEMENT_CLIENT_ID: "management-client",
    AUTH0_MANAGEMENT_CLIENT_SECRET: "secret",
  };

  /** Stubs the Auth0 Management API so the user's block status is what `lookup` returns. */
  const stubManagement = (lookup: () => Promise<boolean>) => {
    __adminRoleTestUtils.clearManagementClientCache();
    const isUserBlocked = vi.fn(lookup);
    vi.spyOn(Auth0ManagementClient, "fromEnv").mockReturnValue({
      isUserBlocked,
    } as unknown as Auth0ManagementClient);
    return isUserBlocked;
  };

  beforeEach(() => {
    __adminRoleTestUtils.clearBlockedCache();
    __adminRoleTestUtils.clearManagementClientCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never trusts anonymous callers", async () => {
    const lookup = stubManagement(async () => false);
    expect(await check(undefined, managementEnv)).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("trusts any signed-in user Auth0 has not blocked, whatever their permissions", async () => {
    stubManagement(async () => false);
    expect(await check({ sub: "plain", permissions: [] }, managementEnv)).toBe(true);
    expect(await check({ sub: "no-claim" }, managementEnv)).toBe(true);
    expect(await check({ sub: "admin", permissions: ["access:admin"] }, managementEnv)).toBe(true);
  });

  it("queues a blocked user, even an admin, and caches the answer per user", async () => {
    const lookup = stubManagement(async () => true);
    const user = { sub: "blocked", permissions: ["access:admin"] };
    expect(await check(user, managementEnv)).toBe(false);
    expect(await check(user, managementEnv)).toBe(false);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("blocked");
  });

  it("looks the block status up again after 60 seconds", async () => {
    vi.useFakeTimers();
    try {
      let blocked = false;
      const lookup = stubManagement(async () => blocked);
      const user = { sub: "later-blocked" };
      expect(await check(user, managementEnv)).toBe(true);
      blocked = true;
      vi.advanceTimersByTime(59_000);
      expect(await check(user, managementEnv)).toBe(true);
      vi.advanceTimersByTime(2_000);
      expect(await check(user, managementEnv)).toBe(false);
      expect(lookup).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("queues when the block status cannot be confirmed, and retries after 10 seconds", async () => {
    vi.useFakeTimers();
    try {
      let failing = true;
      const lookup = stubManagement(() =>
        failing ? Promise.reject(new Error("auth0 down")) : Promise.resolve(false),
      );
      expect(await check({ sub: "offline" }, managementEnv)).toBe(false);
      failing = false;
      vi.advanceTimersByTime(9_000);
      expect(await check({ sub: "offline" }, managementEnv)).toBe(false);
      expect(lookup).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2_000);
      expect(await check({ sub: "offline" }, managementEnv)).toBe(true);
      expect(lookup).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("queues machine-to-machine tokens without a lookup, unless they carry access:admin", async () => {
    const lookup = stubManagement(async () => false);
    expect(await check({ sub: "app@clients", gty: "client-credentials" }, managementEnv)).toBe(
      false,
    );
    expect(await check({ sub: "app@clients", permissions: ["access:admin"] }, managementEnv)).toBe(
      true,
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it("queues when the Management client cannot be created", async () => {
    __adminRoleTestUtils.clearManagementClientCache();
    vi.spyOn(Auth0ManagementClient, "fromEnv").mockImplementation(() => {
      throw new Error("bad config");
    });
    expect(await check({ sub: "misconfigured" }, managementEnv)).toBe(false);
  });

  it("treats users as not blocked in development when the Management API is not configured", async () => {
    const fromEnv = vi.spyOn(Auth0ManagementClient, "fromEnv");
    expect(await check({ sub: "local", permissions: [] }, { ENVIRONMENT: "development" })).toBe(
      true,
    );
    expect(fromEnv).not.toHaveBeenCalled();
  });

  it("queues signed-in users outside development when the Management API is not configured", async () => {
    const fromEnv = vi.spyOn(Auth0ManagementClient, "fromEnv");
    expect(await check({ sub: "prod-user" }, { ENVIRONMENT: "production" })).toBe(false);
    // Previews too, until they get their own Management app.
    expect(await check({ sub: "preview-user" }, { ENVIRONMENT: "preview" })).toBe(false);
    expect(await check({ sub: "unset-user" }, { ENVIRONMENT: undefined })).toBe(false);
    expect(fromEnv).not.toHaveBeenCalled();
  });
});

describe("moderation alerts", () => {
  beforeEach(() => __moderationAlertTestUtils.reset());

  it("says only how many changes are waiting", () => {
    expect(moderationAlertText(1)).toBe("1 change awaiting review");
    expect(moderationAlertText(3)).toBe("3 changes awaiting review");
  });

  it("posts the count as JSON to the webhook", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    const sent = await sendModerationAlert({
      webhookUrl: "https://hooks.example/abc",
      count: 3,
      fetchImpl,
    });
    expect(sent).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith("https://hooks.example/abc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "3 changes awaiting review" }),
    });
  });

  it("swallows webhook failures", async () => {
    const failing = vi.fn(async () => new Response("no", { status: 500 }));
    expect(
      await sendModerationAlert({ webhookUrl: "https://x", count: 1, fetchImpl: failing }),
    ).toBe(false);
    const throwing = vi.fn(() => Promise.reject(new Error("offline")));
    expect(
      await sendModerationAlert({ webhookUrl: "https://x", count: 1, fetchImpl: throwing }),
    ).toBe(false);
  });

  const runSchedule = async (
    env: Partial<Env>,
    countPending: () => Promise<number>,
    {
      now = Date.now,
      fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response("ok")),
    }: {
      now?: () => number;
      fetchImpl?: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;
    } = {},
  ) => {
    const tasks: Promise<unknown>[] = [];
    const app = new Hono<{ Variables: AppVariables; Bindings: Env }>();
    app.get("/", (c) => {
      c.set("pendingChangeService", { countPending } as AppVariables["pendingChangeService"]);
      scheduleModerationAlert(c, fetchImpl, now);
      return c.text("ok");
    });
    await app.request(
      "/",
      {},
      env as Env,
      {
        waitUntil: (task: Promise<unknown>) => tasks.push(task),
        passThroughOnException: () => undefined,
        props: undefined,
      } as unknown as ExecutionContext,
    );
    await Promise.all(tasks);
    return { fetchImpl, tasks };
  };

  it("does nothing when MODERATION_SLACK_WEBHOOK is unset", async () => {
    const countPending = vi.fn(async () => 2);
    const { fetchImpl, tasks } = await runSchedule({}, countPending);
    expect(tasks).toHaveLength(0);
    expect(countPending).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("counts the queue in the background and posts when the webhook is set", async () => {
    const { fetchImpl, tasks } = await runSchedule(
      { MODERATION_SLACK_WEBHOOK: "https://hooks.example/abc" },
      async () => 4,
    );
    expect(tasks).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ text: "4 changes awaiting review" }),
    );
  });

  it("never rejects the background task when counting fails", async () => {
    const { fetchImpl, tasks } = await runSchedule(
      { MODERATION_SLACK_WEBHOOK: "https://hooks.example/abc" },
      () => Promise.reject(new Error("db down")),
    );
    await expect(Promise.all(tasks)).resolves.toBeDefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("alerts at queue thresholds 1, 5, 10, 25, 50, 100, ...", () => {
    const hits = Array.from({ length: 1000 }, (_, i) => i + 1).filter(isModerationAlertThreshold);
    expect(hits).toEqual([1, 5, 10, 25, 50, 100, 250, 500, 1000]);
    expect(isModerationAlertThreshold(0)).toBe(false);
    expect(isModerationAlertThreshold(2.5)).toBe(false);
  });

  it("between thresholds posts at most once per interval", () => {
    const t0 = 1_000_000;
    expect(shouldSendModerationAlert(0, null, t0)).toBe(false);
    expect(shouldSendModerationAlert(3, null, t0)).toBe(true);
    expect(shouldSendModerationAlert(3, t0, t0 + 1)).toBe(false);
    expect(shouldSendModerationAlert(5, t0, t0 + 1)).toBe(true);
    expect(shouldSendModerationAlert(7, t0, t0 + MODERATION_ALERT_INTERVAL_MS - 1)).toBe(false);
    expect(shouldSendModerationAlert(7, t0, t0 + MODERATION_ALERT_INTERVAL_MS)).toBe(true);
  });

  it("throttles a burst of queued changes to thresholds plus one per interval", async () => {
    const env = { MODERATION_SLACK_WEBHOOK: "https://hooks.example/abc" };
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response("ok"));
    let clock = 5_000_000;
    const now = () => clock;
    const posted = () =>
      fetchImpl.mock.calls.map(
        ([, init]) => (JSON.parse(String(init?.body)) as { text: string }).text,
      );

    // A flood from 2 to 30 pending within a minute.
    for (let count = 2; count <= 30; count++) {
      clock += 1000;
      await runSchedule(env, async () => count, { now, fetchImpl });
    }
    expect(posted()).toEqual([
      "2 changes awaiting review",
      "5 changes awaiting review",
      "10 changes awaiting review",
      "25 changes awaiting review",
    ]);

    // After the interval the next change posts again, once.
    clock += MODERATION_ALERT_INTERVAL_MS;
    await runSchedule(env, async () => 31, { now, fetchImpl });
    await runSchedule(env, async () => 32, { now, fetchImpl });
    expect(posted().at(-1)).toBe("31 changes awaiting review");
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("does not use up the interval when the webhook fails", async () => {
    const env = { MODERATION_SLACK_WEBHOOK: "https://hooks.example/abc" };
    const failing = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("no", { status: 500 }),
    );
    await runSchedule(env, async () => 3, { now: () => 1, fetchImpl: failing });
    const ok = vi.fn(async (_url: string, _init?: RequestInit) => new Response("ok"));
    await runSchedule(env, async () => 4, { now: () => 2, fetchImpl: ok });
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
