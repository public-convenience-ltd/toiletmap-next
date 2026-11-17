/**
 * Report a problem / restore / verify, and the trust rule for direct writes:
 * only `report:loo` or `access:admin` callers write directly; everyone else
 * (anonymous or signed in) is queued for moderation.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __moderationAlertTestUtils } from "../../src/services/moderation-alert";
import { getPrismaClient, getTestContext } from "./setup";
import { cleanupManager } from "./utils/cleanup";
import { createFixtureFactory } from "./utils/fixtures";
import type {
  ConflictBody,
  DumpBody,
  ErrorBody,
  FormattedFieldError,
  ListBody,
  NearbyLooResponse,
  QueuedBody,
  SavedLooBody,
  StateConflictBody,
  UpdatesBody,
  VerifyBody,
} from "./utils/response-types";
import {
  callApi,
  createCapturingExecutionContext,
  jsonRequest,
  readJson,
} from "./utils/test-client";

const fixtures = createFixtureFactory();

/** A `report:loo` contributor (the default test token). */
const trustedHeaders = () => ({ Authorization: `Bearer ${getTestContext().issueToken()}` });

/** An admin without `report:loo`: still trusted. */
const adminOnlyHeaders = () => ({
  Authorization: `Bearer ${getTestContext().issueToken({
    sub: "auth0|admin-only",
    permissions: ["access:admin"],
  })}`,
});

/** Signed in, but without either permission: changes are queued. */
const UNTRUSTED_NICKNAME = "queued-contributor";
const untrustedHeaders = () => ({
  Authorization: `Bearer ${getTestContext().issueToken({
    sub: "auth0|untrusted-user",
    permissions: [],
    app_metadata: { nickname: UNTRUSTED_NICKNAME },
  })}`,
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  callApi(path, jsonRequest("POST", body, headers));

const pendingRow = (id: string) => {
  cleanupManager.trackPendingChange(id);
  return getPrismaClient().pending_change.findUnique({ where: { id } });
};

/**
 * A location nobody else uses, so proximity queries (whose responses are
 * cached per URL) see only this test's loos. Somewhere in the Highlands.
 */
const uniqueLocation = () => ({
  lat: 56.5 + Math.random() * 1.5,
  lng: -5 + Math.random() * 1.5,
});

/** ~`metres` north of a point. */
const offsetNorth = (point: { lat: number; lng: number }, metres: number) => ({
  lat: point.lat + metres / 111_320,
  lng: point.lng,
});

const missingId = () => randomBytes(12).toString("hex");

describe("POST /api/loos/:id/report", () => {
  describe("trusted callers", () => {
    it("removes the loo with its category, reason and contributor", async () => {
      const loo = await fixtures.loos.create();
      const prisma = getPrismaClient();

      const response = await post(
        `/api/loos/${loo.id}/report`,
        { reason: "permanently_closed", details: "Demolished last spring" },
        trustedHeaders(),
      );

      expect(response.status).toBe(200);
      const body = await readJson<SavedLooBody>(response);
      expect(body.active).toBe(false);
      expect(body.removalCategory).toBe("permanently_closed");
      expect(body.removalReason).toBe("Demolished last spring");
      expect(body.duplicateOf).toBeNull();
      expect(body.compressed).toBeNull();

      const row = await prisma.toilets.findUnique({ where: { id: loo.id } });
      expect(row?.active).toBe(false);
      expect(row?.removal_category).toBe("permanently_closed");
      expect(row?.contributors.at(-1)).toBe("integration-tester");
    });

    it("writes a default reason sentence when no details are given", async () => {
      const loo = await fixtures.loos.create();
      const response = await post(
        `/api/loos/${loo.id}/report`,
        { reason: "not_public" },
        trustedHeaders(),
      );
      expect(response.status).toBe(200);
      const body = await readJson<SavedLooBody>(response);
      expect(body.removalCategory).toBe("not_public");
      expect(body.removalReason).toBe("Reported as not open to the public.");
    });

    it("drops the loo from the dump and lists it under /updates deleted", async () => {
      const loo = await fixtures.loos.create();
      const since = new Date(Date.parse(loo.updatedAt ?? "") + 1).toISOString();
      await new Promise((resolve) => setTimeout(resolve, 20));

      const before = await readJson<DumpBody>(await callApi("/api/loos/dump"));
      expect(before.data.some(([id]) => id === loo.id)).toBe(true);

      const response = await post(
        `/api/loos/${loo.id}/report`,
        { reason: "does_not_exist" },
        trustedHeaders(),
      );
      expect(response.status).toBe(200);

      const after = await readJson<DumpBody>(await callApi("/api/loos/dump"));
      expect(after.data.some(([id]) => id === loo.id)).toBe(false);

      const updates = await readJson<UpdatesBody>(
        await callApi(`/api/loos/updates?since=${since}`),
      );
      expect(updates.deleted).toContain(loo.id);
      expect(updates.upserted.some(([id]) => id === loo.id)).toBe(false);
    });

    it("lets an admin without report:loo remove directly", async () => {
      const loo = await fixtures.loos.create();
      const response = await post(
        `/api/loos/${loo.id}/report`,
        { reason: "permanently_closed" },
        adminOnlyHeaders(),
      );
      expect(response.status).toBe(200);
    });

    it("records the category in the audit history", async () => {
      const loo = await fixtures.loos.create();
      await post(`/api/loos/${loo.id}/report`, { reason: "not_public" }, trustedHeaders());

      const response = await callApi(`/api/loos/${loo.id}/reports`);
      const body = await readJson<ListBody<{ diff: Record<string, unknown> | null }>>(response);
      const last = body.data.at(-1);
      expect(last?.diff).toMatchObject({
        active: { previous: true, current: false },
        removalCategory: { previous: null, current: "not_public" },
      });
    });

    it("refuses a stale baseUpdatedAt with the PUT conflict shape", async () => {
      const loo = await fixtures.loos.create();
      const stale = new Date(Date.parse(loo.updatedAt ?? "") - 60_000).toISOString();

      const response = await post(
        `/api/loos/${loo.id}/report`,
        { reason: "permanently_closed", baseUpdatedAt: stale },
        trustedHeaders(),
      );
      expect(response.status).toBe(409);
      const body = await readJson<ConflictBody>(response);
      expect(body.error).toBe("conflict");
      expect(body.current.id).toBe(loo.id);
      expect(body.current.active).toBe(true);

      const row = await getPrismaClient().toilets.findUnique({ where: { id: loo.id } });
      expect(row?.active).toBe(true);
    });

    it("accepts the current baseUpdatedAt", async () => {
      const loo = await fixtures.loos.create();
      const response = await post(
        `/api/loos/${loo.id}/report`,
        { reason: "permanently_closed", baseUpdatedAt: loo.updatedAt },
        trustedHeaders(),
      );
      expect(response.status).toBe(200);
    });

    it("returns 409 already_removed for a loo that is already off the map", async () => {
      const loo = await fixtures.loos.create({ active: false });
      const response = await post(
        `/api/loos/${loo.id}/report`,
        { reason: "permanently_closed" },
        trustedHeaders(),
      );
      expect(response.status).toBe(409);
      const body = await readJson<StateConflictBody>(response);
      expect(body.error).toBe("already_removed");
      expect(body.current.id).toBe(loo.id);
    });

    it("returns 404 for an unknown loo and creates nothing", async () => {
      const id = missingId();
      const response = await post(
        `/api/loos/${id}/report`,
        { reason: "permanently_closed" },
        trustedHeaders(),
      );
      expect(response.status).toBe(404);
      expect(await getPrismaClient().toilets.findUnique({ where: { id } })).toBeNull();
    });
  });

  describe("duplicates", () => {
    it("removes a duplicate and links it to the surviving loo", async () => {
      const survivor = await fixtures.loos.create();
      const duplicate = await fixtures.loos.create();

      const response = await post(
        `/api/loos/${duplicate.id}/report`,
        { reason: "duplicate", duplicateOf: survivor.id.toUpperCase() },
        trustedHeaders(),
      );
      expect(response.status).toBe(200);
      const body = await readJson<SavedLooBody>(response);
      expect(body.removalCategory).toBe("duplicate");
      expect(body.duplicateOf).toBe(survivor.id);

      const detail = await readJson<SavedLooBody>(await callApi(`/api/loos/${duplicate.id}`));
      expect(detail.duplicateOf).toBe(survivor.id);
    });

    it.each([
      ["is missing", { reason: "duplicate" }],
      ["is not a loo id", { reason: "duplicate", duplicateOf: "not-an-id" }],
      ["is given for another reason", { reason: "not_public", duplicateOf: "a".repeat(24) }],
    ])("rejects a duplicateOf that %s", async (_label, body) => {
      const loo = await fixtures.loos.create();
      const response = await post(`/api/loos/${loo.id}/report`, body, trustedHeaders());
      expect(response.status).toBe(400);
      const error = await readJson<ErrorBody<{ duplicateOf?: FormattedFieldError }>>(response);
      expect(error.issues?.duplicateOf?._errors.length).toBeGreaterThan(0);
    });

    it.each([
      ["itself", (self: string) => self, "cannot duplicate itself"],
      ["an unknown loo", () => missingId(), "does not exist"],
    ])("rejects a duplicate of %s", async (_label, target, message) => {
      const loo = await fixtures.loos.create();
      const response = await post(
        `/api/loos/${loo.id}/report`,
        { reason: "duplicate", duplicateOf: target(loo.id) },
        trustedHeaders(),
      );
      expect(response.status).toBe(400);
      const error = await readJson<ErrorBody<{ duplicateOf?: FormattedFieldError }>>(response);
      expect(error.issues?.duplicateOf?._errors[0]).toContain(message);
      const row = await getPrismaClient().toilets.findUnique({ where: { id: loo.id } });
      expect(row?.active).toBe(true);
    });

    it("rejects a duplicate of a removed loo", async () => {
      const removed = await fixtures.loos.create({ active: false });
      const loo = await fixtures.loos.create();
      const response = await post(
        `/api/loos/${loo.id}/report`,
        { reason: "duplicate", duplicateOf: removed.id },
        untrustedHeaders(),
      );
      expect(response.status).toBe(400);
      const error = await readJson<ErrorBody<{ duplicateOf?: FormattedFieldError }>>(response);
      expect(error.issues?.duplicateOf?._errors[0]).toContain("removed");
    });

    it("never removes two loos as duplicates of each other, even concurrently", async () => {
      // Several pairs at once, so the two reports in a pair really overlap.
      const pairs = await Promise.all(
        Array.from({ length: 6 }, async () => [
          await fixtures.loos.create(),
          await fixtures.loos.create(),
        ]),
      );

      const outcomes = await Promise.all(
        pairs.map(async ([a, b]) => {
          if (!a || !b) throw new Error("fixture missing");
          const [ab, ba] = await Promise.all([
            post(
              `/api/loos/${a.id}/report`,
              { reason: "duplicate", duplicateOf: b.id },
              trustedHeaders(),
            ),
            post(
              `/api/loos/${b.id}/report`,
              { reason: "duplicate", duplicateOf: a.id },
              trustedHeaders(),
            ),
          ]);
          const rows = await getPrismaClient().toilets.findMany({
            where: { id: { in: [a.id, b.id] } },
            select: { active: true },
          });
          return {
            statuses: [ab.status, ba.status].sort(),
            removed: rows.filter((row) => row.active !== true).length,
          };
        }),
      );

      for (const { statuses, removed } of outcomes) {
        // Exactly one wins; the other is told its target has been removed.
        expect(statuses).toEqual([200, 400]);
        expect(removed).toBe(1);
      }
    });

    it("clears the link when the surviving loo is hard-deleted", async () => {
      const survivor = await fixtures.loos.create();
      const duplicate = await fixtures.loos.create();
      await post(
        `/api/loos/${duplicate.id}/report`,
        { reason: "duplicate", duplicateOf: survivor.id },
        trustedHeaders(),
      );

      const prisma = getPrismaClient();
      await prisma.toilets.delete({ where: { id: survivor.id } });
      const row = await prisma.toilets.findUnique({ where: { id: duplicate.id } });
      expect(row?.duplicate_of).toBeNull();
      expect(row?.removal_category).toBe("duplicate");
    });
  });

  describe("validation", () => {
    it.each([
      ["an unknown reason", { reason: "smells" }, "reason"],
      ["'other' without details", { reason: "other" }, "details"],
      ["'other' with blank details", { reason: "other", details: "   " }, "details"],
      [
        "details over 2000 characters",
        { reason: "not_public", details: "x".repeat(2001) },
        "details",
      ],
      ["an unknown field", { reason: "not_public", active: false }, "_errors"],
      [
        "an invalid baseUpdatedAt",
        { reason: "not_public", baseUpdatedAt: "yesterday" },
        "baseUpdatedAt",
      ],
    ])("rejects %s", async (_label, body, field) => {
      const loo = await fixtures.loos.create();
      const response = await post(`/api/loos/${loo.id}/report`, body, trustedHeaders());
      expect(response.status).toBe(400);
      const error = await readJson<ErrorBody<Record<string, unknown>>>(response);
      expect(error.issues).toHaveProperty(field);
    });

    it("rejects a malformed id", async () => {
      const response = await post("/api/loos/short/report", { reason: "not_public" });
      expect(response.status).toBe(400);
    });

    it("accepts 'other' with details", async () => {
      const loo = await fixtures.loos.create();
      const response = await post(
        `/api/loos/${loo.id}/report`,
        { reason: "other", details: "Turned into a cafe" },
        trustedHeaders(),
      );
      expect(response.status).toBe(200);
      const body = await readJson<SavedLooBody>(response);
      expect(body.removalReason).toBe("Turned into a cafe");
    });
  });

  describe("untrusted callers", () => {
    it("queues an anonymous report as a pending remove change", async () => {
      const loo = await fixtures.loos.create();
      const response = await post(`/api/loos/${loo.id}/report`, {
        reason: "permanently_closed",
        details: "Boarded up",
      });

      expect(response.status).toBe(202);
      const body = await readJson<QueuedBody>(response);
      expect(body.queued).toBe(true);

      const row = await pendingRow(body.id);
      expect(row?.type).toBe("remove");
      expect(row?.loo_id).toBe(loo.id);
      expect(row?.payload).toEqual({ reason: "permanently_closed", details: "Boarded up" });
      expect(row?.submitted_by).toBeNull();
      expect(row?.base_updated_at?.getTime()).toBe(Date.parse(loo.updatedAt ?? ""));

      const live = await getPrismaClient().toilets.findUnique({ where: { id: loo.id } });
      expect(live?.active).toBe(true);
    });

    it("queues a signed-in report without report:loo and records the submitter", async () => {
      const loo = await fixtures.loos.create();
      const target = await fixtures.loos.create();
      const response = await post(
        `/api/loos/${loo.id}/report`,
        { reason: "duplicate", duplicateOf: target.id },
        untrustedHeaders(),
      );
      expect(response.status).toBe(202);
      const row = await pendingRow((await readJson<QueuedBody>(response)).id);
      expect(row?.type).toBe("remove");
      expect(row?.payload).toEqual({ reason: "duplicate", duplicateOf: target.id });
      expect(row?.submitted_by).toBe(UNTRUSTED_NICKNAME);
    });

    it("refuses before queueing: 404, already removed and stale base", async () => {
      const unknown = await post(`/api/loos/${missingId()}/report`, { reason: "not_public" });
      expect(unknown.status).toBe(404);

      const removed = await fixtures.loos.create({ active: false });
      const already = await post(`/api/loos/${removed.id}/report`, { reason: "not_public" });
      expect(already.status).toBe(409);
      expect((await readJson<StateConflictBody>(already)).error).toBe("already_removed");

      const loo = await fixtures.loos.create();
      const stale = await post(`/api/loos/${loo.id}/report`, {
        reason: "not_public",
        baseUpdatedAt: new Date(Date.parse(loo.updatedAt ?? "") - 1000).toISOString(),
      });
      expect(stale.status).toBe(409);
      expect((await readJson<ConflictBody>(stale)).error).toBe("conflict");

      const queued = await getPrismaClient().pending_change.count({
        where: { loo_id: { in: [removed.id, loo.id] } },
      });
      expect(queued).toBe(0);
    });

    it("applies the anonymous write limiter", async () => {
      const loo = await fixtures.loos.create();
      const limiter = { limit: vi.fn(async () => ({ success: false })) };
      const response = await callApi(
        `/api/loos/${loo.id}/report`,
        jsonRequest("POST", { reason: "not_public" }, { "cf-connecting-ip": "203.0.113.9" }),
        { env: { RATE_LIMIT_ANON_WRITE: limiter } },
      );
      expect(response.status).toBe(429);
      expect(limiter.limit).toHaveBeenCalledWith({ key: "anon-write:203.0.113.9" });
    });
  });
});

describe("POST /api/loos/:id/restore", () => {
  const removedLoo = async () => {
    const loo = await fixtures.loos.create();
    const response = await post(
      `/api/loos/${loo.id}/report`,
      { reason: "duplicate", duplicateOf: (await fixtures.loos.create()).id },
      trustedHeaders(),
    );
    expect(response.status).toBe(200);
    return readJson<SavedLooBody>(response);
  };

  it("puts a removed loo back on the map for a trusted caller", async () => {
    const loo = await removedLoo();
    const response = await post(`/api/loos/${loo.id}/restore`, {}, trustedHeaders());

    expect(response.status).toBe(200);
    const body = await readJson<SavedLooBody>(response);
    expect(body.active).toBe(true);
    expect(body.removalCategory).toBeNull();
    expect(body.duplicateOf).toBeNull();
    expect(body.removalReason).toBeNull();
    expect(body.compressed).toEqual([loo.id, loo.geohash, expect.any(Number)]);

    const dump = await readJson<DumpBody>(await callApi("/api/loos/dump"));
    expect(dump.data.some(([id]) => id === loo.id)).toBe(true);

    // The removal stays in the audit history.
    const history = await readJson<ListBody<{ diff: Record<string, unknown> | null }>>(
      await callApi(`/api/loos/${loo.id}/reports`),
    );
    expect(history.data.at(-1)?.diff).toMatchObject({
      active: { previous: false, current: true },
      removalCategory: { previous: "duplicate", current: null },
    });
  });

  it("says a trusted restore does not keep details, and stores nothing from them", async () => {
    const loo = await removedLoo();
    const response = await post(
      `/api/loos/${loo.id}/restore`,
      { details: "Reopened after the refit" },
      trustedHeaders(),
    );
    expect(response.status).toBe(200);
    const body = await readJson<SavedLooBody & { detailsIgnored?: boolean }>(response);
    expect(body.detailsIgnored).toBe(true);
    expect(body.active).toBe(true);
    expect(body.removalReason).toBeNull();
    const row = await getPrismaClient().toilets.findUnique({ where: { id: loo.id } });
    expect(row?.removal_reason).toBeNull();
    expect(row?.notes ?? "").not.toContain("Reopened after the refit");

    // Without details the flag is absent.
    const again = await removedLoo();
    const plain = await post(`/api/loos/${again.id}/restore`, {}, trustedHeaders());
    expect((await readJson<{ detailsIgnored?: boolean }>(plain)).detailsIgnored).toBeUndefined();
  });

  it("accepts a request without a body", async () => {
    const loo = await removedLoo();
    const response = await callApi(`/api/loos/${loo.id}/restore`, {
      method: "POST",
      headers: trustedHeaders(),
    });
    expect(response.status).toBe(200);
  });

  it("queues anonymous and signed-in untrusted restores", async () => {
    const loo = await removedLoo();

    const anonymous = await post(`/api/loos/${loo.id}/restore`, { details: "Open again" });
    expect(anonymous.status).toBe(202);
    const anonRow = await pendingRow((await readJson<QueuedBody>(anonymous)).id);
    expect(anonRow?.type).toBe("restore");
    expect(anonRow?.payload).toEqual({ details: "Open again" });
    expect(anonRow?.base_updated_at?.getTime()).toBe(Date.parse(loo.updatedAt ?? ""));

    const signedIn = await post(`/api/loos/${loo.id}/restore`, {}, untrustedHeaders());
    expect(signedIn.status).toBe(202);
    const signedInRow = await pendingRow((await readJson<QueuedBody>(signedIn)).id);
    expect(signedInRow?.payload).toEqual({});
    expect(signedInRow?.submitted_by).toBe(UNTRUSTED_NICKNAME);

    const live = await getPrismaClient().toilets.findUnique({ where: { id: loo.id } });
    expect(live?.active).toBe(false);
  });

  it("returns 409 not_removed for a loo on the map", async () => {
    const loo = await fixtures.loos.create();
    for (const headers of [trustedHeaders(), {}]) {
      const response = await post(`/api/loos/${loo.id}/restore`, {}, headers);
      expect(response.status).toBe(409);
      expect((await readJson<StateConflictBody>(response)).error).toBe("not_removed");
    }
  });

  it("returns 404 for an unknown loo and 409 for a stale base", async () => {
    const unknown = await post(`/api/loos/${missingId()}/restore`, {}, trustedHeaders());
    expect(unknown.status).toBe(404);

    const loo = await removedLoo();
    const stale = await post(
      `/api/loos/${loo.id}/restore`,
      { baseUpdatedAt: new Date(Date.parse(loo.updatedAt ?? "") - 1000).toISOString() },
      trustedHeaders(),
    );
    expect(stale.status).toBe(409);
    expect((await readJson<ConflictBody>(stale)).error).toBe("conflict");
  });

  it("clears the removal category when a trusted PUT reactivates the loo", async () => {
    const loo = await removedLoo();
    const response = await callApi(
      `/api/loos/${loo.id}`,
      jsonRequest("PUT", { active: true }, trustedHeaders()),
    );
    expect(response.status).toBe(200);
    const body = await readJson<SavedLooBody>(response);
    expect(body.active).toBe(true);
    expect(body.removalCategory).toBeNull();
    expect(body.duplicateOf).toBeNull();
    expect(body.removalReason).toBeNull();

    // A later removal without a reason must not bring the old one back.
    const removedAgain = await callApi(
      `/api/loos/${loo.id}`,
      jsonRequest("PUT", { active: false }, trustedHeaders()),
    );
    expect(removedAgain.status).toBe(200);
    expect((await readJson<SavedLooBody>(removedAgain)).removalReason).toBeNull();
  });
});

describe("POST /api/loos/:id/verify", () => {
  it("lets an anonymous caller verify, bumping only verified_at", async () => {
    const loo = await fixtures.loos.create();
    const prisma = getPrismaClient();
    const before = await prisma.toilets.findUnique({ where: { id: loo.id } });

    const response = await callApi(`/api/loos/${loo.id}/verify`, { method: "POST" });
    expect(response.status).toBe(200);
    const body = await readJson<VerifyBody>(response);
    expect(body.id).toBe(loo.id);
    expect(Number.isNaN(Date.parse(body.verifiedAt))).toBe(false);

    const after = await prisma.toilets.findUnique({ where: { id: loo.id } });
    expect(after?.verified_at?.toISOString()).toBe(body.verifiedAt);
    expect(after?.updated_at?.getTime()).toBe(before?.updated_at?.getTime());
    expect(after?.contributors).toEqual(before?.contributors);

    // The detail response (and so its ETag) reflects it.
    const detail = await readJson<SavedLooBody>(await callApi(`/api/loos/${loo.id}`));
    expect(detail.verifiedAt).toBe(body.verifiedAt);
  });

  it("lets a signed-in caller without permissions verify", async () => {
    const loo = await fixtures.loos.create();
    const response = await callApi(`/api/loos/${loo.id}/verify`, {
      method: "POST",
      headers: untrustedHeaders(),
    });
    expect(response.status).toBe(200);
  });

  it("returns 409 removed for an inactive loo and 404 for an unknown one", async () => {
    const removed = await fixtures.loos.create({ active: false });
    const conflict = await callApi(`/api/loos/${removed.id}/verify`, { method: "POST" });
    expect(conflict.status).toBe(409);
    expect((await readJson<ErrorBody>(conflict)).error).toBe("removed");
    const row = await getPrismaClient().toilets.findUnique({ where: { id: removed.id } });
    expect(row?.verified_at).toBeNull();

    const unknown = await callApi(`/api/loos/${missingId()}/verify`, { method: "POST" });
    expect(unknown.status).toBe(404);
  });

  it("rate-limits anonymous callers but not signed-in ones", async () => {
    const loo = await fixtures.loos.create();
    const limiter = { limit: vi.fn(async () => ({ success: false })) };

    const anonymous = await callApi(
      `/api/loos/${loo.id}/verify`,
      { method: "POST" },
      { env: { RATE_LIMIT_ANON_WRITE: limiter } },
    );
    expect(anonymous.status).toBe(429);

    const signedIn = await callApi(
      `/api/loos/${loo.id}/verify`,
      { method: "POST", headers: untrustedHeaders() },
      { env: { RATE_LIMIT_ANON_WRITE: limiter } },
    );
    expect(signedIn.status).toBe(200);
  });
});

describe("GET /api/loos/proximity filters", () => {
  const nearby = async (query: string) => {
    const response = await callApi(`/api/loos/proximity?${query}`);
    expect(response.status).toBe(200);
    return (await readJson<ListBody<NearbyLooResponse>>(response)).data;
  };

  it("returns active loos only by default, nearest first, with active and distance", async () => {
    const centre = uniqueLocation();
    const close = await fixtures.loos.create({ location: offsetNorth(centre, 8) });
    const further = await fixtures.loos.create({ location: offsetNorth(centre, 40) });
    const removed = await fixtures.loos.create({
      location: offsetNorth(centre, 15),
      active: false,
    });

    const data = await nearby(`lat=${centre.lat}&lng=${centre.lng}&radius=100`);
    expect(data.map((loo) => loo.id)).toEqual([close.id, further.id]);
    expect(data[0]?.active).toBe(true);
    expect(data[0]?.distance).toBeGreaterThan(5);
    expect(data[0]?.distance).toBeLessThan(11);
    expect(data.some((loo) => loo.id === removed.id)).toBe(false);
  });

  it("includes removed loos with includeInactive=true", async () => {
    const centre = uniqueLocation();
    const active = await fixtures.loos.create({ location: offsetNorth(centre, 5) });
    const removed = await fixtures.loos.create({
      location: offsetNorth(centre, 10),
      active: false,
    });

    const data = await nearby(
      `lat=${centre.lat}&lng=${centre.lng}&radius=100&includeInactive=true`,
    );
    expect(data.map((loo) => [loo.id, loo.active])).toEqual([
      [active.id, true],
      [removed.id, false],
    ]);
  });

  it("leaves out the excluded loo", async () => {
    const centre = uniqueLocation();
    const self = await fixtures.loos.create({ location: centre });
    const other = await fixtures.loos.create({ location: offsetNorth(centre, 8) });

    const data = await nearby(`lat=${centre.lat}&lng=${centre.lng}&radius=50&exclude=${self.id}`);
    expect(data.map((loo) => loo.id)).toEqual([other.id]);
  });

  it.each([
    ["exclude=short", "exclude"],
    ["includeInactive=maybe", "includeInactive"],
  ])("validates %s", async (query, field) => {
    const response = await callApi(`/api/loos/proximity?lat=51.5&lng=-0.1&${query}`);
    expect(response.status).toBe(400);
    const error = await readJson<ErrorBody<Record<string, unknown>>>(response);
    expect(error.issues).toHaveProperty(field);
  });
});

describe("direct writes require report:loo or access:admin", () => {
  it("queues a PUT from a signed-in user without report:loo", async () => {
    const loo = await fixtures.loos.create({ notes: "Original" });
    const response = await callApi(
      `/api/loos/${loo.id}`,
      jsonRequest("PUT", { notes: "Suggested" }, untrustedHeaders()),
    );
    expect(response.status).toBe(202);
    const row = await pendingRow((await readJson<QueuedBody>(response)).id);
    expect(row?.type).toBe("update");
    expect(row?.payload).toEqual({ notes: "Suggested" });
    expect(row?.submitted_by).toBe(UNTRUSTED_NICKNAME);

    const live = await getPrismaClient().toilets.findUnique({ where: { id: loo.id } });
    expect(live?.notes).toBe("Original");
  });

  it("does not let an untrusted PUT create a loo", async () => {
    const id = missingId();
    const response = await callApi(
      `/api/loos/${id}`,
      jsonRequest("PUT", { name: "Nope" }, untrustedHeaders()),
    );
    expect(response.status).toBe(404);
    expect(await getPrismaClient().toilets.findUnique({ where: { id } })).toBeNull();
  });

  it("queues a POST from a signed-in user without report:loo", async () => {
    const name = `Queued create ${Date.now()}`;
    const response = await post(
      "/api/loos",
      { name, location: uniqueLocation() },
      untrustedHeaders(),
    );
    expect(response.status).toBe(202);
    const row = await pendingRow((await readJson<QueuedBody>(response)).id);
    expect(row?.type).toBe("create");
    expect(await getPrismaClient().toilets.count({ where: { name } })).toBe(0);
  });

  it("writes a PUT directly for report:loo and for access:admin", async () => {
    const loo = await fixtures.loos.create({ notes: "Original" });
    const asContributor = await callApi(
      `/api/loos/${loo.id}`,
      jsonRequest("PUT", { notes: "By contributor" }, trustedHeaders()),
    );
    expect(asContributor.status).toBe(200);

    const asAdmin = await callApi(
      `/api/loos/${loo.id}`,
      jsonRequest("PUT", { notes: "By admin" }, adminOnlyHeaders()),
    );
    expect(asAdmin.status).toBe(200);
    expect((await readJson<SavedLooBody>(asAdmin)).notes).toBe("By admin");
  });
});

describe("moderation alerts", () => {
  const WEBHOOK = "https://hooks.slack.test/services/T000/B000/XXXX";
  const realFetch = globalThis.fetch;

  // The alert throttle is per isolate; start each test with a fresh window.
  beforeEach(() => __moderationAlertTestUtils.reset());

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** Replaces fetch for the webhook URL only; everything else goes to the network as usual. */
  const interceptWebhook = () => {
    const calls: Array<{ url: string; body: string }> = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === WEBHOOK) {
        calls.push({ url, body: String(init?.body ?? "") });
        return Promise.resolve(new Response("ok", { status: 200 }));
      }
      return realFetch(input, init);
    }) as typeof fetch;
    return calls;
  };

  it("posts a counts-only message when a change is queued and the webhook is set", async () => {
    const calls = interceptWebhook();
    const loo = await fixtures.loos.create();
    const { ctx, settle } = createCapturingExecutionContext();

    const response = await callApi(
      `/api/loos/${loo.id}/report`,
      jsonRequest(
        "POST",
        { reason: "other", details: "Secret details" },
        { "cf-connecting-ip": "198.51.100.7" },
      ),
      { env: { MODERATION_SLACK_WEBHOOK: WEBHOOK }, ctx },
    );
    expect(response.status).toBe(202);
    cleanupManager.trackPendingChange((await readJson<QueuedBody>(response)).id);
    await settle();

    expect(calls).toHaveLength(1);
    const text = (JSON.parse(calls[0]?.body ?? "{}") as { text: string }).text;
    expect(text).toMatch(/^\d+ changes? awaiting review$/);
    expect(calls[0]?.body).not.toContain("Secret details");
    expect(calls[0]?.body).not.toContain("198.51.100.7");
    expect(calls[0]?.body).not.toContain(loo.id);
  });

  it("posts nothing when the webhook is not configured or nothing is queued", async () => {
    const calls = interceptWebhook();
    const loo = await fixtures.loos.create();
    const { ctx, settle } = createCapturingExecutionContext();

    const queued = await post(`/api/loos/${loo.id}/report`, { reason: "not_public" });
    cleanupManager.trackPendingChange((await readJson<QueuedBody>(queued)).id);

    const direct = await callApi(
      `/api/loos/${loo.id}/report`,
      jsonRequest("POST", { reason: "not_public" }, trustedHeaders()),
      { env: { MODERATION_SLACK_WEBHOOK: WEBHOOK }, ctx },
    );
    expect(direct.status).toBe(200);
    await settle();
    expect(calls).toHaveLength(0);
  });
});
