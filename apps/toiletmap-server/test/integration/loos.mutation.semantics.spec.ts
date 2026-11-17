import { describe, expect, it } from "vitest";
import type { toilets } from "../../src/prisma";
import { generateLooId } from "../../src/services/loo";
import type { LooMutationAttributes, LooResponse } from "../../src/services/loo/types";
import { getPrismaClient, getTestContext } from "./setup";
import { cleanupManager } from "./utils/cleanup";
import { createFixtureFactory } from "./utils/fixtures";
import { callApi, jsonRequest } from "./utils/test-client";

const fixtures = createFixtureFactory();

const authHeaders = () => {
  const { issueToken } = getTestContext();
  return { Authorization: `Bearer ${issueToken()}` };
};

const authedPut = (id: string, body: unknown) =>
  callApi(`/api/loos/${id}`, jsonRequest("PUT", body, authHeaders()));

const anonPut = (id: string, body: unknown) => callApi(`/api/loos/${id}`, jsonRequest("PUT", body));

const fullyPopulated: LooMutationAttributes = {
  name: "Semantics Loo",
  accessible: true,
  active: true,
  allGender: false,
  attended: true,
  automatic: false,
  babyChange: true,
  children: true,
  men: true,
  women: true,
  urinalOnly: false,
  radar: true,
  notes: "Next to the bandstand",
  noPayment: false,
  paymentDetails: "40p contactless",
  removalReason: null,
  openingTimes: [
    ["09:00", "17:00"],
    ["09:00", "17:00"],
    ["09:00", "17:00"],
    ["09:00", "17:00"],
    ["09:00", "17:00"],
    ["10:00", "16:00"],
    [],
  ],
};

const seedFullLoo = () => fixtures.loos.create({ ...fullyPopulated });

const getRaw = async (id: string): Promise<toilets> => {
  const row = await fixtures.loos.getRawById(id);
  if (!row) throw new Error(`Loo ${id} not found`);
  return row;
};

/** Columns that legitimately change on every write. */
const withoutWriteMetadata = (row: toilets) => {
  const { updated_at: _updatedAt, contributors: _contributors, ...rest } = row;
  return rest;
};

const countAuditRows = (id: string) =>
  getPrismaClient().record_version.count({ where: { record: { path: ["id"], equals: id } } });

describe("PUT /api/loos/:id mutation semantics (authenticated)", () => {
  it("changes only the submitted column and preserves every other field", async () => {
    const loo = await seedFullLoo();
    const before = await getRaw(loo.id);

    const response = await authedPut(loo.id, { radar: false });
    expect(response.status).toBe(200);

    const after = await getRaw(loo.id);
    expect(after.radar).toBe(false);
    expect(withoutWriteMetadata(after)).toEqual({ ...withoutWriteMetadata(before), radar: false });
    expect(after.updated_at?.getTime()).toBeGreaterThan(before.updated_at?.getTime() ?? 0);
  });

  it("clears a field when sent null", async () => {
    const loo = await seedFullLoo();
    const before = await getRaw(loo.id);

    const response = await authedPut(loo.id, { notes: null });
    expect(response.status).toBe(200);
    const body = (await response.json()) as LooResponse;
    expect(body.notes).toBeNull();

    const after = await getRaw(loo.id);
    expect(after.notes).toBeNull();
    expect(withoutWriteMetadata(after)).toEqual({ ...withoutWriteMetadata(before), notes: null });
  });

  it("treats an empty string as clearing a text field", async () => {
    const loo = await seedFullLoo();
    const response = await authedPut(loo.id, { paymentDetails: "   " });
    expect(response.status).toBe(200);
    expect((await getRaw(loo.id)).payment_details).toBeNull();
  });

  it("returns 200 without writing when nothing changes", async () => {
    const loo = await seedFullLoo();
    const before = await getRaw(loo.id);
    const auditBefore = await countAuditRows(loo.id);

    const response = await authedPut(loo.id, {
      ...fullyPopulated,
      location: loo.location,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as LooResponse;
    expect(body.id).toBe(loo.id);
    expect(body.updatedAt).toBe(loo.updatedAt);

    const after = await getRaw(loo.id);
    expect(after.updated_at?.getTime()).toBe(before.updated_at?.getTime());
    expect(after.contributors).toEqual(before.contributors);
    expect(await countAuditRows(loo.id)).toBe(auditBefore);
  });

  it("ignores location jitter under half a metre", async () => {
    const loo = await seedFullLoo();
    if (!loo.location) throw new Error("fixture should have a location");
    const before = await getRaw(loo.id);

    const response = await authedPut(loo.id, {
      location: { lat: loo.location.lat + 0.000001, lng: loo.location.lng },
    });
    expect(response.status).toBe(200);
    expect((await getRaw(loo.id)).updated_at?.getTime()).toBe(before.updated_at?.getTime());
  });

  it("moves the location when it changes by more than half a metre", async () => {
    const loo = await seedFullLoo();
    if (!loo.location) throw new Error("fixture should have a location");
    const moved = { lat: loo.location.lat + 0.0001, lng: loo.location.lng };

    const response = await authedPut(loo.id, { location: moved });
    expect(response.status).toBe(200);
    const body = (await response.json()) as LooResponse;
    expect(body.location?.lat).toBeCloseTo(moved.lat, 6);
  });

  it("returns 409 with the current record when baseUpdatedAt is stale", async () => {
    const loo = await seedFullLoo();
    const staleBase = new Date(Date.parse(loo.updatedAt ?? "") - 60_000).toISOString();
    const before = await getRaw(loo.id);

    const response = await authedPut(loo.id, {
      notes: "Overwrite attempt",
      baseUpdatedAt: staleBase,
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      message: string;
      error: string;
      current: LooResponse;
    };
    expect(body.error).toBe("conflict");
    expect(body.message).toBe("This toilet was changed by someone else while you were editing.");
    expect(body.current.id).toBe(loo.id);
    expect(body.current.notes).toBe(fullyPopulated.notes);
    expect(body.current.updatedAt).toBe(loo.updatedAt);

    const after = await getRaw(loo.id);
    expect(after).toEqual(before);
  });

  it("applies the update when baseUpdatedAt matches", async () => {
    const loo = await seedFullLoo();
    const response = await authedPut(loo.id, {
      notes: "Fresh edit",
      baseUpdatedAt: loo.updatedAt,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as LooResponse;
    expect(body.notes).toBe("Fresh edit");
  });

  it("rejects a malformed baseUpdatedAt", async () => {
    const loo = await seedFullLoo();
    const response = await authedPut(loo.id, { notes: "x", baseUpdatedAt: "yesterday" });
    expect(response.status).toBe(400);
  });

  it("rejects active: null", async () => {
    const loo = await seedFullLoo();
    const response = await authedPut(loo.id, { active: null });
    expect(response.status).toBe(400);
    expect((await getRaw(loo.id)).active).toBe(true);
  });

  it("still creates a loo for an unknown id (upsert)", async () => {
    const id = generateLooId();
    const response = await authedPut(id, {
      name: "Upserted with base",
      location: { lat: 51.51, lng: -0.11 },
      baseUpdatedAt: new Date().toISOString(),
    });
    expect(response.status).toBe(201);
    cleanupManager.trackLoo(id);
  });
});

describe("PUT /api/loos/:id mutation semantics (anonymous)", () => {
  it("returns 404 for an unknown loo instead of queueing a phantom update", async () => {
    const id = generateLooId();
    const prisma = getPrismaClient();
    const queuedBefore = await prisma.pending_change.count({ where: { loo_id: id } });

    const response = await anonPut(id, { notes: "Ghost" });
    expect(response.status).toBe(404);
    expect(await prisma.pending_change.count({ where: { loo_id: id } })).toBe(queuedBefore);
  });

  it("returns 200 unchanged without queueing a no-op", async () => {
    const loo = await seedFullLoo();
    const prisma = getPrismaClient();

    const response = await anonPut(loo.id, {
      notes: fullyPopulated.notes,
      radar: fullyPopulated.radar,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ queued: false, unchanged: true });
    expect(await prisma.pending_change.count({ where: { loo_id: loo.id } })).toBe(0);
  });

  it("queues only the changed keys together with the base version", async () => {
    const loo = await seedFullLoo();

    const response = await anonPut(loo.id, {
      ...fullyPopulated,
      location: loo.location,
      notes: "Anonymous correction",
      babyChange: false,
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { queued: boolean; id: string };
    expect(body.queued).toBe(true);
    cleanupManager.trackPendingChange(body.id);

    const queued = await getPrismaClient().pending_change.findUnique({ where: { id: body.id } });
    expect(queued?.type).toBe("update");
    expect(queued?.loo_id).toBe(loo.id);
    expect(queued?.payload).toEqual({ notes: "Anonymous correction", babyChange: false });
    expect(queued?.base_updated_at?.toISOString()).toBe(loo.updatedAt);
  });

  it("records the client's baseUpdatedAt when supplied", async () => {
    const loo = await seedFullLoo();
    const response = await anonPut(loo.id, { radar: false, baseUpdatedAt: loo.updatedAt });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { id: string };
    cleanupManager.trackPendingChange(body.id);

    const queued = await getPrismaClient().pending_change.findUnique({ where: { id: body.id } });
    expect(queued?.payload).toEqual({ radar: false });
    expect(queued?.base_updated_at?.toISOString()).toBe(loo.updatedAt);
  });

  it("returns 409 when the anonymous baseUpdatedAt is stale", async () => {
    const loo = await seedFullLoo();
    const staleBase = new Date(Date.parse(loo.updatedAt ?? "") - 60_000).toISOString();

    const response = await anonPut(loo.id, { notes: "Stale", baseUpdatedAt: staleBase });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; current: LooResponse };
    expect(body.error).toBe("conflict");
    expect(body.current.id).toBe(loo.id);
    expect(await getPrismaClient().pending_change.count({ where: { loo_id: loo.id } })).toBe(0);
  });

  it("rejects active: null", async () => {
    const loo = await seedFullLoo();
    const response = await anonPut(loo.id, { active: null });
    expect(response.status).toBe(400);
  });
});
