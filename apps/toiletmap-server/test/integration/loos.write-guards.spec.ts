/**
 * Write guards for non-admin POST/PUT /api/loos (audit M2, L3, B18, B19; see
 * src/routes/loos/write-guards.ts):
 * - `active`, `removalReason` and `location: null` are 400s (report/restore
 *   instead), whether the write would go live or be queued;
 * - a new or changed location must be inside the GB / NI / Isle of Man /
 *   Channel Islands box;
 * - a move of more than 50 m is queued even for a trusted contributor;
 * - only admins choose ids (POST) or create with PUT (unknown id: 404);
 * - ids everywhere are 24 hex characters.
 * Admins may still do each of these.
 *
 * Without the Auth0 Management API (local dev) an `access:admin` claim is
 * enough to count as an admin; the last block checks a revoked admin against
 * the stubbed Management API.
 */
import { describe, expect, it, vi } from "vitest";
import { generateLooId } from "../../src/services/loo";
import type { LooResponse } from "../../src/services/loo/types";
import { getPrismaClient, getTestContext } from "./setup";
import { REVOKED_ADMIN_SUB, useAuth0ManagementStub } from "./utils/auth0-management";
import { cleanupManager } from "./utils/cleanup";
import { createFixtureFactory } from "./utils/fixtures";
import type { QueuedBody, SavedLooBody } from "./utils/response-types";
import { callApi, jsonRequest, readJson } from "./utils/test-client";

const fixtures = createFixtureFactory();

type Headers = Record<string, string>;

const bearer = (claims?: Parameters<ReturnType<typeof getTestContext>["issueToken"]>[0]) => ({
  Authorization: `Bearer ${getTestContext().issueToken(claims)}`,
});

const TRUSTED_SUB = "auth0|write-guards-contributor";
/** Signed in, no permissions: writes directly. */
const trusted = () => bearer({ sub: TRUSTED_SUB });
const admin = () => bearer({ sub: "auth0|write-guards-admin", permissions: ["access:admin"] });
const anonymous: Headers = {};

type RefusalBody = {
  error: string;
  message: string;
  issues: Record<string, { _errors: string[] }>;
};

const put = (id: string, body: unknown, headers: Headers) =>
  callApi(`/api/loos/${id}`, jsonRequest("PUT", body, headers));
const post = (body: unknown, headers: Headers) =>
  callApi("/api/loos", jsonRequest("POST", body, headers));

const LONDON = { lat: 51.5072, lng: -0.1276 };
const PARIS = { lat: 48.8566, lng: 2.3522 };

/** `metres` due north of `from` (one degree of latitude is about 111.2 km). */
const north = (from: { lat: number; lng: number }, metres: number) => ({
  lat: from.lat + metres / 111_195,
  lng: from.lng,
});

const expectRefused = async (response: Response, error: string, field?: string) => {
  expect(response.status).toBe(400);
  const body = await readJson<RefusalBody>(response);
  expect(body.error).toBe(error);
  if (field) expect(body.issues[field]?._errors.length).toBeGreaterThan(0);
  return body;
};

const pendingCount = (looId: string) =>
  getPrismaClient().pending_change.count({ where: { loo_id: looId } });

const savedAndTracked = async (response: Response, status: number) => {
  expect(response.status).toBe(status);
  const body = await readJson<SavedLooBody>(response);
  cleanupManager.trackLoo(body.id);
  return body;
};

describe("non-admins cannot remove, restore or unlocate a toilet with PUT/POST", () => {
  it.each([
    ["active: false", { active: false }, "admin_only_fields", "active"],
    ["active: true", { active: true }, "admin_only_fields", "active"],
    ["removalReason", { removalReason: "Closed" }, "admin_only_fields", "removalReason"],
    ["location: null", { location: null }, "location_required", "location"],
  ] as const)(
    "a trusted PUT with %s is a 400 and changes nothing",
    async (_l, body, error, field) => {
      const loo = await fixtures.loos.create({ location: LONDON });
      const response = await put(loo.id, body, trusted());
      const refusal = await expectRefused(response, error, field);
      expect(refusal.message).toMatch(/report/i);

      const after = await fixtures.loos.getRawById(loo.id);
      expect(after?.active).toBe(true);
      expect(after?.updated_at?.toISOString()).toBe(loo.updatedAt);
    },
  );

  it("an anonymous PUT with active: false is a 400, not queued", async () => {
    const loo = await fixtures.loos.create();
    await expectRefused(await put(loo.id, { active: false }, anonymous), "admin_only_fields");
    expect(await pendingCount(loo.id)).toBe(0);
  });

  it("a non-admin POST with active, removalReason or location: null is a 400", async () => {
    await expectRefused(
      await post({ name: "Inactive", active: false, location: LONDON }, trusted()),
      "admin_only_fields",
      "active",
    );
    await expectRefused(
      await post({ name: "Reasoned", removalReason: "x", location: LONDON }, anonymous),
      "admin_only_fields",
      "removalReason",
    );
    await expectRefused(
      await post({ name: "Nowhere", location: null }, trusted()),
      "location_required",
    );
  });

  it("nobody may send removalCategory or duplicateOf (report sets them)", async () => {
    const loo = await fixtures.loos.create();
    for (const headers of [trusted(), admin()]) {
      expect((await put(loo.id, { removalCategory: "other" }, headers)).status).toBe(400);
      expect((await put(loo.id, { duplicateOf: generateLooId() }, headers)).status).toBe(400);
    }
  });

  it("admins can still deactivate, give a reason, reactivate and clear the location", async () => {
    const loo = await fixtures.loos.create({ location: LONDON });

    const removed = await put(loo.id, { active: false, removalReason: "Demolished" }, admin());
    expect(removed.status).toBe(200);
    const removedBody = await readJson<SavedLooBody>(removed);
    expect(removedBody.active).toBe(false);
    expect(removedBody.removalReason).toBe("Demolished");

    const restored = await put(loo.id, { active: true }, admin());
    expect(restored.status).toBe(200);
    expect((await readJson<SavedLooBody>(restored)).active).toBe(true);

    const unlocated = await put(loo.id, { location: null }, admin());
    expect(unlocated.status).toBe(200);
    const unlocatedBody = await readJson<SavedLooBody>(unlocated);
    expect(unlocatedBody.location).toBeNull();
    expect(unlocatedBody.compressed).toBeNull();
  });
});

describe("locations must be inside GB, NI, the Isle of Man and the Channel Islands", () => {
  it("refuses a trusted or anonymous create outside the area, and queues nothing", async () => {
    await expectRefused(
      await post({ name: "Paris loo", location: PARIS }, trusted()),
      "location_out_of_area",
      "location",
    );
    const before = await getPrismaClient().pending_change.count();
    await expectRefused(
      await post({ name: "Paris loo", location: PARIS }, anonymous),
      "location_out_of_area",
    );
    expect(await getPrismaClient().pending_change.count()).toBe(before);
  });

  it("accepts creates on the islands at the edges of the box", async () => {
    for (const location of [
      { lat: 60.8, lng: -0.88 }, // Unst, Shetland
      { lat: 49.18, lng: -2.11 }, // Jersey
      { lat: 54.15, lng: -4.48 }, // Douglas, Isle of Man
      { lat: 54.6, lng: -5.93 }, // Belfast
    ]) {
      await savedAndTracked(await post({ name: "Edge loo", location }, trusted()), 201);
    }
  });

  it("refuses a trusted or anonymous PUT that moves a toilet out of the area", async () => {
    const loo = await fixtures.loos.create({ location: LONDON });
    await expectRefused(await put(loo.id, { location: PARIS }, trusted()), "location_out_of_area");
    await expectRefused(await put(loo.id, { location: PARIS }, anonymous), "location_out_of_area");
    expect(await pendingCount(loo.id)).toBe(0);
  });

  it("does not spend the queued-write limit on a refused PUT, so the fix can be sent at once", async () => {
    // One queued change a minute: the out-of-area attempt and an unchanged
    // edit must not use it up.
    let calls = 0;
    const limiter = { limit: vi.fn(async () => ({ success: ++calls <= 1 })) };
    const options = { env: { RATE_LIMIT_ANON_WRITE: limiter } };
    const loo = await fixtures.loos.create({ location: LONDON, notes: "Same" });
    const send = (body: unknown) =>
      callApi(`/api/loos/${loo.id}`, jsonRequest("PUT", body, anonymous), options);

    await expectRefused(await send({ location: PARIS }), "location_out_of_area", "location");
    expect((await send({ notes: "Same" })).status).toBe(200);
    const fixed = await send({ location: north(LONDON, 20) });
    expect(fixed.status).toBe(202);
    cleanupManager.trackPendingChange((await readJson<QueuedBody>(fixed)).id);
    expect(limiter.limit).toHaveBeenCalledTimes(1);
  });

  it("does not block other edits to a toilet already outside the area", async () => {
    const loo = await fixtures.loos.create({ location: PARIS, notes: "Before" });
    const response = await put(loo.id, { notes: "After", location: PARIS }, trusted());
    expect(response.status).toBe(200);
    expect((await readJson<SavedLooBody>(response)).notes).toBe("After");
  });

  it("refuses out-of-range or non-finite coordinates from everyone", async () => {
    const loo = await fixtures.loos.create();
    for (const headers of [trusted(), admin()]) {
      expect((await put(loo.id, { location: { lat: 91, lng: 0 } }, headers)).status).toBe(400);
      expect((await put(loo.id, { location: { lat: 51, lng: 181 } }, headers)).status).toBe(400);
      // JSON.parse turns 1e999 into Infinity.
      const infinite = await callApi(`/api/loos/${loo.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...headers },
        body: '{"location":{"lat":1e999,"lng":0}}',
      });
      expect(infinite.status).toBe(400);
    }
  });

  it("lets an admin create and move toilets anywhere", async () => {
    const created = await savedAndTracked(
      await post({ name: "Admin abroad", location: PARIS }, admin()),
      201,
    );
    expect(created.location?.lat).toBeCloseTo(PARIS.lat, 5);

    const loo = await fixtures.loos.create({ location: LONDON });
    const moved = await put(loo.id, { location: PARIS }, admin());
    expect(moved.status).toBe(200);
  });
});

describe("moves of more than 50 m by non-admins are queued", () => {
  it("applies a trusted move of 30 m directly", async () => {
    const loo = await fixtures.loos.create({ location: LONDON });
    const target = north(LONDON, 30);
    const response = await put(loo.id, { location: target }, trusted());
    expect(response.status).toBe(200);
    expect((await readJson<SavedLooBody>(response)).location?.lat).toBeCloseTo(target.lat, 6);
  });

  it("queues a trusted move of 100 m (202, large_move) and leaves the toilet where it was", async () => {
    const loo = await fixtures.loos.create({ location: LONDON, notes: "Before" });
    const target = north(LONDON, 100);

    const response = await put(loo.id, { location: target, notes: "Moved" }, trusted());
    expect(response.status).toBe(202);
    const body = await readJson<QueuedBody & { reason?: string }>(response);
    cleanupManager.trackPendingChange(body.id);
    expect(body).toEqual({ queued: true, id: body.id, reason: "large_move" });

    const after = await readJson<LooResponse>(await callApi(`/api/loos/${loo.id}`));
    expect(after.location?.lat).toBeCloseTo(LONDON.lat, 6);
    expect(after.notes).toBe("Before");

    const pending = await getPrismaClient().pending_change.findUnique({ where: { id: body.id } });
    expect(pending?.type).toBe("update");
    expect(pending?.loo_id).toBe(loo.id);
    expect(pending?.payload).toEqual({ location: target, notes: "Moved" });
    expect(pending?.base_updated_at?.toISOString()).toBe(loo.updatedAt);
    expect(pending?.submitted_by).toBe("integration-tester");
    expect(pending?.submitter_sub).toBe(TRUSTED_SUB);
  });

  it("lets an admin move a toilet 5 km directly", async () => {
    const loo = await fixtures.loos.create({ location: LONDON });
    const target = north(LONDON, 5000);
    const response = await put(loo.id, { location: target }, admin());
    expect(response.status).toBe(200);
    expect((await readJson<SavedLooBody>(response)).location?.lat).toBeCloseTo(target.lat, 6);
  });

  it("lets a trusted contributor place a toilet that had no location", async () => {
    const loo = await fixtures.loos.create({ location: null });
    const response = await put(loo.id, { location: LONDON }, trusted());
    expect(response.status).toBe(200);
  });
});

describe("only admins choose ids or create with PUT", () => {
  it("refuses a non-admin POST that names an id (trusted or anonymous)", async () => {
    const id = generateLooId();
    await expectRefused(
      await post({ id, name: "Chosen id", location: LONDON }, trusted()),
      "id_not_allowed",
      "id",
    );
    await expectRefused(
      await post({ id, name: "Chosen id", location: LONDON }, anonymous),
      "id_not_allowed",
    );
    expect(await fixtures.loos.getRawById(id)).toBeNull();
  });

  it("lets an admin POST a chosen id, lowercasing it", async () => {
    const id = generateLooId();
    cleanupManager.trackLoo(id);
    const body = await savedAndTracked(
      await post({ id: id.toUpperCase(), name: "Admin id", location: LONDON }, admin()),
      201,
    );
    expect(body.id).toBe(id);
  });

  it("answers a trusted PUT to an unknown id with 404 and creates nothing", async () => {
    const id = generateLooId();
    const response = await put(id, { name: "Ghost", location: LONDON }, trusted());
    expect(response.status).toBe(404);
    expect(await fixtures.loos.getRawById(id)).toBeNull();
  });

  it("still lets an admin create with PUT", async () => {
    const id = generateLooId();
    cleanupManager.trackLoo(id);
    const body = await savedAndTracked(
      await put(id, { name: "Admin upsert", location: LONDON }, admin()),
      201,
    );
    expect(body.id).toBe(id);
  });

  it("refuses ids that are not 24 hex characters on every route", async () => {
    const bad = "zzzzzzzzzzzzzzzzzzzzzzzz";
    expect((await callApi(`/api/loos/${bad}`)).status).toBe(400);
    expect((await callApi(`/api/loos/${bad}/reports`)).status).toBe(400);
    expect((await callApi(`/api/loos?ids=${bad}`)).status).toBe(400);
    expect((await callApi(`/api/loos/proximity?lat=51.5&lng=-0.1&exclude=${bad}`)).status).toBe(
      400,
    );
    expect((await put(bad, { notes: "x" }, admin())).status).toBe(400);
    expect((await post({ id: bad, name: "Bad", location: LONDON }, admin())).status).toBe(400);
    expect((await callApi(`/api/loos/${bad}/verify`, { method: "POST" })).status).toBe(400);
  });

  it("finds a loo by its id in upper case", async () => {
    const loo = await fixtures.loos.create();
    const response = await callApi(`/api/loos/${loo.id.toUpperCase()}`);
    expect(response.status).toBe(200);
    expect((await readJson<LooResponse>(response)).id).toBe(loo.id);
  });
});

describe("a revoked admin is a non-admin", () => {
  useAuth0ManagementStub();

  it("applies the guards when Auth0 no longer grants access:admin", async () => {
    const loo = await fixtures.loos.create();
    const revoked = bearer({ sub: REVOKED_ADMIN_SUB, permissions: ["access:admin"] });
    await expectRefused(await put(loo.id, { active: false }, revoked), "admin_only_fields");

    const confirmed = bearer({ sub: "auth0|still-admin", permissions: ["access:admin"] });
    expect((await put(loo.id, { active: false }, confirmed)).status).toBe(200);
  });
});
