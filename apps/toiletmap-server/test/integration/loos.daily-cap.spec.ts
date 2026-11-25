/**
 * Per-account daily caps (audit H4 / B11; src/services/write-caps.ts): an
 * account's removals (trusted reports) and moves (any location change of a
 * toilet that had one), counted together from the audit trail by Auth0 sub
 * over the last 24 hours. At the cap, the next one is queued (202, `reason:
 * "daily_cap"`) instead of applied; other edits still apply. Confirmed admins
 * are exempt. Also the Slack alerts: one on every direct removal and one when
 * an account reaches its cap, with counts and admin links only.
 *
 * Each test uses a fresh sub, because the audit history it counts outlives
 * the test's cleanup. Without the Auth0 Management API (local dev) nobody is
 * blocked and an `access:admin` claim is enough to count as an admin.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __adminRoleTestUtils } from "../../src/middleware/require-admin-role";
import { __moderationAlertTestUtils } from "../../src/services/moderation-alert";
import type { Env } from "../../src/types";
import { getPrismaClient, getTestContext } from "./setup";
import { cleanupManager } from "./utils/cleanup";
import { createFixtureFactory } from "./utils/fixtures";
import type { QueuedBody } from "./utils/response-types";
import { sessionHeaders } from "./utils/session";
import {
  callApi,
  createCapturingExecutionContext,
  jsonRequest,
  readJson,
} from "./utils/test-client";

const fixtures = createFixtureFactory();

const freshSub = () => `auth0|daily-cap-${randomBytes(6).toString("hex")}`;
const bearerFor = (sub: string, permissions: string[] = []) => ({
  Authorization: `Bearer ${getTestContext().issueToken({ sub, permissions })}`,
});

/** Somewhere in the Highlands, away from other tests' loos. */
const uniqueLocation = () => ({ lat: 56.5 + Math.random() * 1.5, lng: -5 + Math.random() * 1.5 });
/** `metres` due north (one degree of latitude is about 111.2 km). */
const north = (from: { lat: number; lng: number }, metres: number) => ({
  lat: from.lat + metres / 111_195,
  lng: from.lng,
});

type Options = { env?: Partial<Env>; ctx?: ExecutionContext };
const CAP_2: Partial<Env> = { ACCOUNT_DAILY_CAP: "2" };

const report = async (headers: Record<string, string>, options: Options = { env: CAP_2 }) => {
  const loo = await fixtures.loos.create();
  const response = await callApi(
    `/api/loos/${loo.id}/report`,
    jsonRequest("POST", { reason: "other", details: "Secret removal details" }, headers),
    options,
  );
  return { loo, response };
};

const move = async (headers: Record<string, string>, options: Options = { env: CAP_2 }) => {
  const location = uniqueLocation();
  const loo = await fixtures.loos.create({ location });
  const response = await callApi(
    `/api/loos/${loo.id}`,
    jsonRequest("PUT", { location: north(location, 10) }, headers),
    options,
  );
  return { loo, response };
};

const expectCapped = async (response: Response, type: string) => {
  expect(response.status).toBe(202);
  const body = await readJson<QueuedBody & { reason?: string }>(response);
  cleanupManager.trackPendingChange(body.id);
  expect(body.reason).toBe("daily_cap");
  const row = await getPrismaClient().pending_change.findUnique({ where: { id: body.id } });
  expect(row?.type).toBe(type);
  return row;
};

describe("per-account daily cap on removals and moves", () => {
  it("queues an account's removal once it has made its allowance", async () => {
    const headers = bearerFor(freshSub());
    expect((await report(headers)).response.status).toBe(200);
    expect((await report(headers)).response.status).toBe(200);

    const third = await report(headers);
    await expectCapped(third.response, "remove");
    const row = await getPrismaClient().toilets.findUnique({ where: { id: third.loo.id } });
    expect(row?.active).toBe(true);
  });

  it("counts moves and removals together, and queues the move past the cap", async () => {
    const headers = bearerFor(freshSub());
    expect((await report(headers)).response.status).toBe(200);
    expect((await move(headers)).response.status).toBe(200);

    const third = await move(headers);
    await expectCapped(third.response, "update");
    const stored = await callApi(`/api/loos/${third.loo.id}`);
    expect((await readJson<{ location: unknown }>(stored)).location).toEqual(third.loo.location);
  });

  it("still applies edits that neither remove nor move a toilet", async () => {
    const headers = bearerFor(freshSub());
    await report(headers);
    await report(headers);

    const loo = await fixtures.loos.create({ notes: "Before" });
    const response = await callApi(
      `/api/loos/${loo.id}`,
      jsonRequest("PUT", { notes: "After" }, headers),
      { env: CAP_2 },
    );
    expect(response.status).toBe(200);
  });

  it("does not count other accounts' changes", async () => {
    await report(bearerFor(freshSub()));
    await report(bearerFor(freshSub()));
    expect((await report(bearerFor(freshSub()))).response.status).toBe(200);
  });

  it("queues every removal and move when the cap is 0", async () => {
    const headers = bearerFor(freshSub());
    const options = { env: { ACCOUNT_DAILY_CAP: "0" } };
    await expectCapped((await report(headers, options)).response, "remove");
    await expectCapped((await move(headers, options)).response, "update");
  });

  it("exempts admins", async () => {
    const headers = bearerFor(freshSub(), ["access:admin"]);
    const options = { env: { ACCOUNT_DAILY_CAP: "0" } };
    expect((await report(headers, options)).response.status).toBe(200);
    expect((await move(headers, options)).response.status).toBe(200);
  });

  it("holds against parallel requests from one account", async () => {
    // Count and write share a transaction under a per-account lock, so five
    // reports sent at once at cap 2 apply exactly two.
    const headers = bearerFor(freshSub());
    const results = await Promise.all(Array.from({ length: 5 }, () => report(headers)));
    const statuses = results.map(({ response }) => response.status).sort();
    expect(statuses).toEqual([200, 200, 202, 202, 202]);
    for (const { response } of results) {
      if (response.status === 202) await expectCapped(response, "remove");
    }
    const ids = results.map(({ loo }) => loo.id);
    const removed = await getPrismaClient().toilets.count({
      where: { id: { in: ids }, active: false },
    });
    expect(removed).toBe(2);
  });

  it("holds against parallel moves and reports together", async () => {
    const headers = bearerFor(freshSub());
    const results = await Promise.all([
      move(headers),
      report(headers),
      move(headers),
      report(headers),
    ]);
    const statuses = results.map(({ response }) => response.status).sort();
    expect(statuses).toEqual([200, 200, 202, 202]);
    for (const { response } of results) {
      if (response.status === 202) {
        const body = await readJson<QueuedBody & { reason?: string }>(response);
        cleanupManager.trackPendingChange(body.id);
        expect(body.reason).toBe("daily_cap");
      }
    }
  });

  it("counts the account's queued changes once a moderator approves them", async () => {
    const headers = bearerFor(freshSub());
    const queued = await move(headers, { env: { ACCOUNT_DAILY_CAP: "0" } });
    const row = await expectCapped(queued.response, "update");
    __adminRoleTestUtils.clearPermissionCache();
    const approval = await callApi(`/admin/pending/${row?.id}/approve`, {
      method: "POST",
      headers: sessionHeaders({
        sub: "auth0|test-admin",
        permissions: ["access:admin"],
        profile: { email: "admin@example.com", name: "Test Admin" },
      }),
    });
    expect(approval.headers.get("location")).toBe("/admin/pending?notice=approved");

    // The approved move is credited to the submitter, so at cap 1 their next removal is queued.
    await expectCapped(
      (await report(headers, { env: { ACCOUNT_DAILY_CAP: "1" } })).response,
      "remove",
    );
  });

  it("allows 10 a day when ACCOUNT_DAILY_CAP is unset", async () => {
    // Invalid values also fall back to 10: see test/unit/write-safety.test.ts.
    const headers = bearerFor(freshSub());
    const options = { env: { ACCOUNT_DAILY_CAP: undefined } };
    for (let i = 0; i < 10; i++) {
      expect((await report(headers, options)).response.status).toBe(200);
    }
    await expectCapped((await report(headers, options)).response, "remove");
  });
});

describe("removal and daily-cap alerts", () => {
  const WEBHOOK = "https://hooks.slack.test/services/T000/B000/REMOVALS";
  const realFetch = globalThis.fetch;

  beforeEach(() => __moderationAlertTestUtils.reset());
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const interceptWebhook = () => {
    const texts: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === WEBHOOK) {
        texts.push((JSON.parse(String(init?.body ?? "{}")) as { text: string }).text);
        return Promise.resolve(new Response("ok", { status: 200 }));
      }
      return realFetch(input, init);
    }) as typeof fetch;
    return texts;
  };

  it("posts the count and the toilet's admin link on a direct removal, nothing else", async () => {
    const texts = interceptWebhook();
    const sub = freshSub();
    const { ctx, settle } = createCapturingExecutionContext();

    const { loo, response } = await report(bearerFor(sub), {
      env: { ...CAP_2, MODERATION_SLACK_WEBHOOK: WEBHOOK },
      ctx,
    });
    expect(response.status).toBe(200);
    await settle();

    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatch(
      new RegExp(
        `^\\d+ toilets? removed from the map in the last 24 hours\\. Latest direct removal: https://integration\\.test/admin/loos/${loo.id}$`,
      ),
    );
    expect(texts[0]).not.toContain("Secret removal details");
    expect(texts[0]).not.toContain(sub);
  });

  it("posts when an account reaches its cap, without naming the account", async () => {
    const sub = freshSub();
    const headers = bearerFor(sub);
    await report(headers);
    await report(headers);

    const texts = interceptWebhook();
    const { ctx, settle } = createCapturingExecutionContext();
    const capped = await report(headers, {
      env: { ...CAP_2, MODERATION_SLACK_WEBHOOK: WEBHOOK },
      ctx,
    });
    await expectCapped(capped.response, "remove");
    await settle();

    const capAlert = texts.find((text) => text.includes("daily limit"));
    expect(capAlert).toBe(
      `An account reached its daily limit of 2 removals and moves; its change to https://integration.test/admin/loos/${capped.loo.id} was queued for review (see /admin/pending).`,
    );
    // The queue alert is the usual counts-only one; no removal alert (nothing was removed).
    expect(texts.filter((text) => !text.includes("daily limit"))).toEqual([
      expect.stringMatching(/^\d+ changes? awaiting review$/),
    ]);
    for (const text of texts) expect(text).not.toContain(sub);
  });
});
