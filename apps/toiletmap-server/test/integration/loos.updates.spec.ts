import { expect, test } from "vitest";
import { getTestContext } from "./setup";
import { createFixtureFactory } from "./utils/fixtures";
import type { ListBody, LooResponse, UpdatesBody } from "./utils/response-types";
import { callApi, jsonRequest, readJson } from "./utils/test-client";

const fixtures = createFixtureFactory();

test("GET /loos/updates returns incremental updates", async () => {
  // 1. Create a loo. Its own updated_at (database clock) is the boundary, so
  //    the test does not depend on the test runner's clock matching the DB's.
  //    +1ms because the API truncates the stored microseconds.
  const loo1 = await fixtures.loos.create();
  const since = new Date(Date.parse(loo1.updatedAt ?? "") + 1).toISOString();

  // 2. Wait a bit to ensure timestamp difference
  await new Promise((resolve) => setTimeout(resolve, 20));

  // 3. Create another loo
  const loo2 = await fixtures.loos.create();

  // 5. Fetch updates since 'since'
  const response = await callApi(`/api/loos/updates?since=${since}`);

  expect(response.status).toBe(200);
  const updates = await readJson<UpdatesBody>(response);

  // loo2 should be in upserted because it was created after 'since'
  expect(updates.upserted.find((row) => row[0] === loo2.id)).toBeDefined();

  // loo1 should NOT be in upserted because it was created before 'since'
  expect(updates.upserted.find((row) => row[0] === loo1.id)).toBeUndefined();
});

test("GET /loos/geohash returns summary data", async () => {
  const loo = await fixtures.loos.create();
  const geohash = loo.geohash?.slice(0, 4);

  const response = await callApi(`/api/loos/geohash/${geohash}?summary=true`);

  expect(response.status).toBe(200);
  const body = await readJson<ListBody<LooResponse>>(response);
  const data = body.data;

  expect(data.length).toBeGreaterThan(0);
  const found = data.find((row) => row.id === loo.id);
  expect(found).toBeDefined();

  // Summary should have more fields than compressed but maybe not all?
  // Our implementation currently returns full LooResponse, so let's check for a field
  // that is NOT in compressed but IS in LooResponse, e.g. 'name'.
  expect(found?.name).toBeDefined();
});

test("GET /loos/updates lists a deactivated loo under deleted", async () => {
  const loo = await fixtures.loos.create({ active: true });

  // The fixture's own updated_at (database clock) is the boundary; the
  // deactivation lands strictly after it.
  const since = new Date(Date.parse(loo.updatedAt ?? "") + 1).toISOString();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const { issueToken } = getTestContext();
  const deactivate = await callApi(
    `/api/loos/${loo.id}`,
    jsonRequest(
      "PUT",
      { active: false, removalReason: "Closed permanently" },
      { Authorization: `Bearer ${issueToken()}` },
    ),
  );
  expect(deactivate.status).toBe(200);
  const body = await readJson<LooResponse>(deactivate);
  expect(body.active).toBe(false);
  expect(body.removalReason).toBe("Closed permanently");

  const response = await callApi(`/api/loos/updates?since=${since}`);
  expect(response.status).toBe(200);
  const updates = await readJson<UpdatesBody>(response);

  expect(updates.deleted).toContain(loo.id);
  expect(updates.upserted.find((row) => row[0] === loo.id)).toBeUndefined();
});
