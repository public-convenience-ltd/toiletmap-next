/**
 * The Auth0 sub behind every write (audit M3 / B13, migration
 * 20261125000000_write_attribution.sql):
 * - every direct write path stores the caller's sub in toilets.updated_by_sub
 *   (create, PUT update and upsert, report, restore, verify), NULL when
 *   anonymous, and each record_version snapshot carries it;
 * - queued changes keep the submitter's sub in pending_change.submitter_sub,
 *   and approval stores the submitter's sub, never the moderator's;
 * - a legacy-app write (toiletmap_web, no `toiletmap.actor_sub` setting)
 *   stores NULL, even after a new-app write, and still works;
 * - the sub never appears in a public response, GraphQL or the export.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClientInstance } from "../../src/prisma";
import { buildJson, toExportToilet } from "../../src/services/export/format";
import { LooService } from "../../src/services/loo";
import { getPrismaClient, getTestContext } from "./setup";
import { BLOCKED_SUB, useAuth0ManagementStub } from "./utils/auth0-management";
import { cleanupManager } from "./utils/cleanup";
import { getTestDatabaseUrl } from "./utils/env";
import { createFixtureFactory } from "./utils/fixtures";
import type { QueuedBody, SavedLooBody } from "./utils/response-types";
import { sessionHeaders } from "./utils/session";
import { callApi, jsonRequest, readJson } from "./utils/test-client";

const fixtures = createFixtureFactory();

const bearer = (sub: string, permissions: string[] = []) => ({
  Authorization: `Bearer ${getTestContext().issueToken({ sub, permissions })}`,
});

/** A distinctive sub per test, so a leak is easy to search for. */
const uniqueSub = () => `auth0|attribution-${randomBytes(6).toString("hex")}`;

const updatedBySub = async (id: string): Promise<string | null | undefined> => {
  const [row] = await getPrismaClient().$queryRaw<{ updated_by_sub: string | null }[]>`
    SELECT updated_by_sub FROM public.toilets WHERE id = ${id}
  `;
  return row?.updated_by_sub;
};

/** updated_by_sub of each audit snapshot of a loo, oldest first. */
const snapshotSubs = async (id: string): Promise<Array<string | null>> => {
  const rows = await getPrismaClient().$queryRaw<{ sub: string | null }[]>`
    SELECT record->>'updated_by_sub' AS sub
    FROM audit.record_version
    WHERE record->>'id' = ${id}
    ORDER BY ts, id
  `;
  return rows.map((row) => row.sub);
};

const LONDON = { lat: 51.5072, lng: -0.1276 };

describe("direct writes store the caller's sub", () => {
  it("on create, PUT update, report, restore and verify", async () => {
    const creator = uniqueSub();
    const created = await callApi(
      "/api/loos",
      jsonRequest("POST", { name: "Attributed", location: LONDON }, bearer(creator)),
    );
    expect(created.status).toBe(201);
    const { id } = await readJson<SavedLooBody>(created);
    cleanupManager.trackLoo(id);
    expect(await updatedBySub(id)).toBe(creator);

    const editor = uniqueSub();
    const edited = await callApi(
      `/api/loos/${id}`,
      jsonRequest("PUT", { notes: "Edited" }, bearer(editor)),
    );
    expect(edited.status).toBe(200);
    expect(await updatedBySub(id)).toBe(editor);

    const reporter = uniqueSub();
    const reported = await callApi(
      `/api/loos/${id}/report`,
      jsonRequest("POST", { reason: "not_public" }, bearer(reporter)),
    );
    expect(reported.status).toBe(200);
    expect(await updatedBySub(id)).toBe(reporter);

    const restorer = uniqueSub();
    const restored = await callApi(
      `/api/loos/${id}/restore`,
      jsonRequest("POST", {}, bearer(restorer)),
    );
    expect(restored.status).toBe(200);
    expect(await updatedBySub(id)).toBe(restorer);

    const verifier = uniqueSub();
    const verified = await callApi(`/api/loos/${id}/verify`, {
      method: "POST",
      headers: bearer(verifier),
    });
    expect(verified.status).toBe(200);
    expect(await updatedBySub(id)).toBe(verifier);

    // History records who made each change.
    expect(await snapshotSubs(id)).toEqual([creator, editor, reporter, restorer, verifier]);
  });

  it("on an admin PUT that creates the loo", async () => {
    const adminSub = uniqueSub();
    const id = randomBytes(12).toString("hex");
    cleanupManager.trackLoo(id);
    const response = await callApi(
      `/api/loos/${id}`,
      jsonRequest(
        "PUT",
        { name: "Admin upsert", location: LONDON },
        bearer(adminSub, ["access:admin"]),
      ),
    );
    expect(response.status).toBe(201);
    expect(await updatedBySub(id)).toBe(adminSub);
  });

  it("stores NULL for an anonymous verify", async () => {
    const loo = await fixtures.loos.create();
    await callApi(`/api/loos/${loo.id}`, jsonRequest("PUT", { notes: "x" }, bearer(uniqueSub())));
    const verified = await callApi(`/api/loos/${loo.id}/verify`, { method: "POST" });
    expect(verified.status).toBe(200);
    expect(await updatedBySub(loo.id)).toBeNull();
  });
});

describe("queued changes: approval credits the submitter's sub", () => {
  const moderator = {
    sub: "auth0|attribution-moderator",
    permissions: ["access:admin"],
    profile: { name: "Attribution Moderator" },
  };

  const approve = async (pendingId: string) => {
    const response = await callApi(`/admin/pending/${pendingId}/approve`, {
      method: "POST",
      headers: sessionHeaders(moderator),
    });
    expect(response.headers.get("location")).toBe("/admin/pending?notice=approved");
  };

  it("records the sub of a trusted large move and stores it on approval", async () => {
    const mover = uniqueSub();
    const loo = await fixtures.loos.create({ location: LONDON });
    const queued = await callApi(
      `/api/loos/${loo.id}`,
      jsonRequest("PUT", { location: { lat: LONDON.lat + 0.01, lng: LONDON.lng } }, bearer(mover)),
    );
    expect(queued.status).toBe(202);
    const { id: pendingId } = await readJson<QueuedBody>(queued);
    cleanupManager.trackPendingChange(pendingId);
    const pending = await getPrismaClient().pending_change.findUnique({ where: { id: pendingId } });
    expect(pending?.submitter_sub).toBe(mover);

    await approve(pendingId);
    expect(await updatedBySub(loo.id)).toBe(mover);
    expect(await updatedBySub(loo.id)).not.toBe(moderator.sub);
  });

  it("stores NULL, not the moderator's sub, for an approved anonymous change", async () => {
    const loo = await fixtures.loos.create({ notes: "Before" });
    await callApi(
      `/api/loos/${loo.id}`,
      jsonRequest("PUT", { notes: "Signed" }, bearer(uniqueSub())),
    );

    const queued = await callApi(`/api/loos/${loo.id}`, jsonRequest("PUT", { notes: "Anon" }));
    expect(queued.status).toBe(202);
    const { id: pendingId } = await readJson<QueuedBody>(queued);
    cleanupManager.trackPendingChange(pendingId);
    const pending = await getPrismaClient().pending_change.findUnique({ where: { id: pendingId } });
    expect(pending?.submitter_sub).toBeNull();

    await approve(pendingId);
    expect(await updatedBySub(loo.id)).toBeNull();
  });

  describe("with Auth0 Management (blocked submitters)", () => {
    useAuth0ManagementStub();

    it("credits a blocked submitter's create, report and restore to their sub", async () => {
      const name = `Blocked create ${randomBytes(4).toString("hex")}`;
      const created = await callApi(
        "/api/loos",
        jsonRequest("POST", { name, location: LONDON }, bearer(BLOCKED_SUB)),
      );
      expect(created.status).toBe(202);
      const { id: createId } = await readJson<QueuedBody>(created);
      cleanupManager.trackPendingChange(createId);
      expect(
        (await getPrismaClient().pending_change.findUnique({ where: { id: createId } }))
          ?.submitter_sub,
      ).toBe(BLOCKED_SUB);

      await approve(createId);
      const [row] = await getPrismaClient().$queryRaw<{ id: string; updated_by_sub: string }[]>`
        SELECT id, updated_by_sub FROM public.toilets WHERE name = ${name}
      `;
      if (!row) throw new Error("approved create not found");
      cleanupManager.trackLoo(row.id);
      expect(row.updated_by_sub).toBe(BLOCKED_SUB);

      const loo = await fixtures.loos.create();
      const removal = await callApi(
        `/api/loos/${loo.id}/report`,
        jsonRequest("POST", { reason: "does_not_exist" }, bearer(BLOCKED_SUB)),
      );
      expect(removal.status).toBe(202);
      const { id: removalId } = await readJson<QueuedBody>(removal);
      cleanupManager.trackPendingChange(removalId);
      await approve(removalId);
      expect(await updatedBySub(loo.id)).toBe(BLOCKED_SUB);

      const restoral = await callApi(
        `/api/loos/${loo.id}/restore`,
        jsonRequest("POST", {}, bearer(BLOCKED_SUB)),
      );
      expect(restoral.status).toBe(202);
      const { id: restoreId } = await readJson<QueuedBody>(restoral);
      cleanupManager.trackPendingChange(restoreId);
      // Make the next write's attribution distinguishable from the last.
      await getPrismaClient()
        .$executeRaw`UPDATE public.toilets SET notes = 'x' WHERE id = ${loo.id}`;
      expect(await updatedBySub(loo.id)).toBeNull();
      await approve(restoreId);
      expect(await updatedBySub(loo.id)).toBe(BLOCKED_SUB);
    });
  });
});

describe("legacy-app writes (toiletmap_web, no actor setting)", () => {
  let web: PrismaClientInstance;

  beforeAll(() => {
    const url = new URL(getTestDatabaseUrl());
    url.username = "toiletmap_web";
    url.password = "toiletmap_web";
    web = createPrismaClient(url.toString());
  });

  afterAll(async () => {
    await web.$disconnect();
  });

  it("insert and update as before, store NULL, and fire the audit and area triggers", async () => {
    const id = randomBytes(12).toString("hex");
    cleanupManager.trackLoo(id);
    const point = JSON.stringify({ type: "Point", coordinates: [LONDON.lng, LONDON.lat] });

    // The legacy app's insert and its update with contributors appended.
    await web.$executeRaw`
      INSERT INTO toilets (id, created_at, updated_at, contributors, name, active, geography)
      VALUES (${id}, now(), now(), ARRAY['legacy-user'], 'Legacy insert', true,
              ST_GeomFromGeoJSON(${point}))
    `;
    expect(await updatedBySub(id)).toBeNull();

    // A new-app write, then a legacy update: the legacy write must not
    // inherit the previous writer's sub.
    const appSub = uniqueSub();
    const edited = await callApi(
      `/api/loos/${id}`,
      jsonRequest("PUT", { notes: "From the new app" }, bearer(appSub)),
    );
    expect(edited.status).toBe(200);
    expect(await updatedBySub(id)).toBe(appSub);

    const updated = await web.$executeRaw`
      UPDATE toilets
      SET notes = 'From legacy', updated_at = now(),
          contributors = array_append(contributors, 'legacy-user')
      WHERE id = ${id}
    `;
    expect(updated).toBe(1);
    expect(await updatedBySub(id)).toBeNull();

    const [row] = await getPrismaClient().$queryRaw<{ area_id: string | null; geohash: string }[]>`
      SELECT area_id, geohash FROM public.toilets WHERE id = ${id}
    `;
    expect(row?.geohash).toMatch(/^gcpv/);
    expect(await snapshotSubs(id)).toEqual([null, appSub, null]);
  });
});

describe("the sub is never published", () => {
  it("is absent from REST, history, GraphQL and the dataset export", async () => {
    const sub = uniqueSub();
    const name = `Private sub ${randomBytes(4).toString("hex")}`;
    const created = await callApi(
      "/api/loos",
      jsonRequest("POST", { name, location: LONDON }, bearer(sub)),
    );
    expect(created.status).toBe(201);
    const createdText = await created.text();
    const { id, geohash } = JSON.parse(createdText) as SavedLooBody;
    cleanupManager.trackLoo(id);
    await callApi(`/api/loos/${id}`, jsonRequest("PUT", { notes: "Second" }, bearer(sub)));
    expect(await updatedBySub(id)).toBe(sub);

    const admin = bearer("auth0|attribution-admin", ["access:admin"]);
    const graphql = `{ loo(id: "${id}") { id name notes } reportsForLoo(id: "${id}") { id contributor createdAt notes } }`;
    const responses = await Promise.all([
      callApi(`/api/loos/${id}`),
      callApi(`/api/loos?ids=${id}`),
      callApi(`/api/loos/${id}/reports?hydrate=true`),
      callApi(`/api/loos/${id}/reports?hydrate=true`, { headers: admin }),
      callApi(`/api/loos/geohash/${geohash?.slice(0, 6)}`),
      callApi(`/api/loos/proximity?lat=${LONDON.lat}&lng=${LONDON.lng}&radius=50`),
      callApi(`/api/loos/search?search=${encodeURIComponent(name)}`, { headers: admin }),
      callApi("/api/loos/dump?rich=true"),
      callApi(`/api/graphql?query=${encodeURIComponent(graphql)}`),
    ]);

    const texts = [createdText];
    for (const response of responses) {
      expect(response.status).toBe(200);
      texts.push(await response.text());
    }
    // Sanity: each response is about this loo (history entries carry its
    // notes rather than its id).
    for (const text of texts.slice(1)) expect(text).toMatch(new RegExp(`${id}|Second`));
    for (const text of texts) {
      expect(text).not.toContain(sub);
      expect(text).not.toContain("updated_by_sub");
      expect(text).not.toContain("updatedBySub");
    }

    const exported = buildJson(
      (await new LooService(getPrismaClient()).getAllForExport())
        .filter((row) => row.id === id)
        .map(toExportToilet),
    );
    expect(exported).toContain(id);
    expect(exported).not.toContain(sub);
  });
});
