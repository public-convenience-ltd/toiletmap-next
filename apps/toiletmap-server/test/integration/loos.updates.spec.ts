import { expect, test } from "vitest";
import { createFixtureFactory } from "./utils/fixtures";
import { callApi } from "./utils/test-client";

const fixtures = createFixtureFactory();

test("GET /loos/updates returns incremental updates", async () => {
  // 1. Create a loo
  const loo1 = await fixtures.loos.create();
  const since = new Date().toISOString();

  // 2. Wait a bit to ensure timestamp difference
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 3. Create another loo
  const loo2 = await fixtures.loos.create();

  // 5. Fetch updates since 'since'
  const response = await callApi(`/api/loos/updates?since=${since}`);

  expect(response.status).toBe(200);
  const updates = (await response.json()) as any;

  // loo2 should be in upserted because it was created after 'since'
  expect(updates.upserted.find((l: any) => l[0] === loo2.id)).toBeDefined();

  // loo1 should NOT be in upserted because it was created before 'since'
  expect(updates.upserted.find((l: any) => l[0] === loo1.id)).toBeUndefined();
});

test("GET /loos/geohash returns summary data", async () => {
  const loo = await fixtures.loos.create();
  const geohash = loo.geohash?.slice(0, 4);

  const response = await callApi(`/api/loos/geohash/${geohash}?summary=true`);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  const data = body.data;

  expect(data.length).toBeGreaterThan(0);
  const found = data.find((l: any) => l.id === loo.id);
  expect(found).toBeDefined();

  // Summary should have more fields than compressed but maybe not all?
  // Our implementation currently returns full LooResponse, so let's check for a field
  // that is NOT in compressed but IS in LooResponse, e.g. 'name'.
  expect(found.name).toBeDefined();
});
