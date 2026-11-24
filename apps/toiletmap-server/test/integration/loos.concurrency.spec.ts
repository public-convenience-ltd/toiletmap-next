import { describe, expect, it } from "vitest";
import type { toilets } from "../../src/prisma";
import { generateLooId, LooService } from "../../src/services/loo";
import type { LooResponse } from "../../src/services/loo/types";
import { getPrismaClient } from "./setup";
import { createFixtureFactory } from "./utils/fixtures";
import { sessionHeaders } from "./utils/session";
import { callApi, jsonRequest } from "./utils/test-client";

const fixtures = createFixtureFactory();

const service = () => new LooService(getPrismaClient());

const getRaw = async (id: string): Promise<toilets> => {
  const row = await fixtures.loos.getRawById(id);
  if (!row) throw new Error(`Loo ${id} not found`);
  return row;
};

const countAuditRows = (id: string) =>
  getPrismaClient().record_version.count({ where: { record: { path: ["id"], equals: id } } });

const minuteBefore = (iso: string | null) => new Date(Date.parse(iso ?? "") - 60_000).toISOString();

/** The cookie session (and same-origin Origin) the admin edit page sends with its PUT. */
const adminSessionHeaders = () =>
  sessionHeaders({
    sub: "auth0|concurrency-admin",
    permissions: ["access:admin"],
    profile: { email: "admin@example.com", name: "Concurrency Admin" },
  });

describe("PUT /api/loos/:id from an admin session", () => {
  it("returns 409 and writes nothing when baseUpdatedAt is stale", async () => {
    const loo = await fixtures.loos.create({ notes: "Loaded by the edit page" });
    const before = await getRaw(loo.id);

    const response = await callApi(
      `/api/loos/${loo.id}`,
      jsonRequest(
        "PUT",
        { notes: "Saved from a stale edit page", baseUpdatedAt: minuteBefore(loo.updatedAt) },
        adminSessionHeaders(),
      ),
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; current: LooResponse };
    expect(body.error).toBe("conflict");
    expect(body.current.updatedAt).toBe(loo.updatedAt);
    expect(await getRaw(loo.id)).toEqual(before);
  });

  it("applies the save when baseUpdatedAt matches the record", async () => {
    const loo = await fixtures.loos.create({ notes: "Loaded by the edit page" });

    const response = await callApi(
      `/api/loos/${loo.id}`,
      jsonRequest(
        "PUT",
        { notes: "Saved from a fresh edit page", baseUpdatedAt: loo.updatedAt },
        adminSessionHeaders(),
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as LooResponse;
    expect(body.notes).toBe("Saved from a fresh edit page");
  });
});

describe("LooService.updateExisting optimistic-concurrency guard", () => {
  it("returns conflict and leaves the row untouched for an older expectedUpdatedAt", async () => {
    const loo = await fixtures.loos.create({ notes: "Original" });
    const before = await getRaw(loo.id);
    const auditBefore = await countAuditRows(loo.id);

    const result = await service().updateExisting(loo.id, { notes: "Overwrite" }, "tester", {
      expectedUpdatedAt: minuteBefore(loo.updatedAt),
    });

    expect(result).toEqual({ status: "conflict" });
    expect(await getRaw(loo.id)).toEqual(before);
    expect(await countAuditRows(loo.id)).toBe(auditBefore);
  });

  it("updates when expectedUpdatedAt matches the row", async () => {
    const loo = await fixtures.loos.create({ notes: "Original" });

    const result = await service().updateExisting(loo.id, { notes: "Guarded edit" }, "tester", {
      expectedUpdatedAt: loo.updatedAt,
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    expect(result.loo?.notes).toBe("Guarded edit");
    expect((await getRaw(loo.id)).notes).toBe("Guarded edit");
  });

  it("matches a row whose updated_at has sub-millisecond precision", async () => {
    const loo = await fixtures.loos.create({ notes: "Microseconds" });
    const prisma = getPrismaClient();
    // timestamptz keeps microseconds; JS Dates (and our ISO strings) only keep milliseconds.
    await prisma.$executeRaw`
      UPDATE toilets SET updated_at = '2025-06-01 12:00:00.123456+00' WHERE id = ${loo.id}
    `;

    const base = await service().getMutationBase(loo.id);
    expect(base?.updatedAt).toBe("2025-06-01T12:00:00.123Z");

    const result = await service().updateExisting(loo.id, { notes: "Still matches" }, "tester", {
      expectedUpdatedAt: base?.updatedAt,
    });

    expect(result.status).toBe("updated");
    expect((await getRaw(loo.id)).notes).toBe("Still matches");
  });

  it("matches a NULL updated_at only when expectedUpdatedAt is null", async () => {
    const loo = await fixtures.loos.create({ notes: "Legacy row" });
    const prisma = getPrismaClient();
    await prisma.$executeRaw`UPDATE toilets SET updated_at = NULL WHERE id = ${loo.id}`;

    const stale = await service().updateExisting(loo.id, { notes: "Dated guard" }, "tester", {
      expectedUpdatedAt: new Date().toISOString(),
    });
    expect(stale).toEqual({ status: "conflict" });
    expect((await getRaw(loo.id)).notes).toBe("Legacy row");

    const matched = await service().updateExisting(loo.id, { notes: "Null guard" }, "tester", {
      expectedUpdatedAt: null,
    });
    expect(matched.status).toBe("updated");
    expect((await getRaw(loo.id)).notes).toBe("Null guard");
  });

  it("returns not_found for a missing id and inserts nothing", async () => {
    const missingId = generateLooId();

    const result = await service().updateExisting(missingId, { notes: "Ghost" }, "tester", {
      expectedUpdatedAt: new Date().toISOString(),
    });

    expect(result).toEqual({ status: "not_found" });
    expect(await fixtures.loos.getRawById(missingId)).toBeNull();
  });
});
