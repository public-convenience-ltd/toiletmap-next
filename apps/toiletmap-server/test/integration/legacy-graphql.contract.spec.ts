/**
 * Contract tests: the legacy GraphQL compatibility endpoint against the golden
 * fixtures captured from the live legacy API (test/fixtures/legacy-graphql).
 *
 * Every fixture toilet is seeded into the local test database with its real
 * id, timestamps and fields (geography from the centre of its stored geohash
 * cell, which reproduces `geohash` and `location` exactly), and the report
 * fixtures' audit rows are rebuilt. Each fixture request is then replayed
 * against `/api/graphql` and the response compared with the golden body.
 *
 * Normalised before comparing, and why:
 * 1. Report `id`s are database sequence values, so they cannot match the live
 *    ones. They are checked to be numeric strings, then compared by position.
 * 2. Unordered lists (proximity, names, geohash strings, areas, statistics)
 *    are compared as sets: the legacy queries have no ORDER BY.
 * 3. List rows that are not fixture toilets are dropped before comparing:
 *    the local database is shared with other tests and may hold toilets near
 *    the same points.
 * 4. Values that depend on the whole dataset rather than on the fixture
 *    toilets (`loos` `total`/`pages`, `loos-default`, `statistics` counts,
 *    the 382-entry `areas` list trimmed to 10 in the fixture) are checked for
 *    shape and internal consistency instead of equality.
 * 5. Response headers: the status, body and content type are the contract.
 *    Caching, CORS and deprecation headers deliberately differ from the
 *    legacy Vercel ones and are asserted in legacy-graphql.http.spec.ts.
 * Nothing else is normalised: timestamps (including `verifiedAt`), opening
 * hours, flags and the compressed geohash strings are compared byte for byte.
 *
 * Deliberate deviations no fixture exercises (see the fixture README): a
 * `24:00` closing time is sent as `00:00`, a stored opening-times value the
 * current schema rejects is `null` without an error, and the hardened
 * arguments and query limits return errors where legacy returned data.
 * Reports written by the current REST API and toilets on a geohash cell edge
 * are covered in legacy-graphql.http.spec.ts, because the seeding here
 * rebuilds audit rows from the fixtures and places each toilet at the centre
 * of its stored geohash cell.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "./setup";
import {
  type LegacyFixture,
  listLegacyFixtureNames,
  loadLegacyFixture,
  loadSeedToilets,
  removeLegacySeed,
  seedLegacyReports,
  seedLegacyToilets,
} from "./utils/legacy-graphql-fixtures";
import { callApi } from "./utils/test-client";

const seedToilets = loadSeedToilets();
const seededIds = new Set(seedToilets.map((toilet) => toilet.id));

/** Replays a fixture request against the compatibility endpoint. */
const replay = (
  fixture: LegacyFixture,
  override: { variables?: Record<string, unknown> } = {},
): Promise<Response> => {
  const headers = { ...fixture.requestHeaders };
  if (fixture.method !== "POST") {
    const queryIndex = fixture.url.indexOf("?");
    const search = queryIndex >= 0 ? fixture.url.slice(queryIndex) : "";
    return callApi(`/api/graphql${search}`, { method: fixture.method, headers });
  }
  return callApi("/api/graphql", {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: fixture.query,
      variables: override.variables ?? fixture.variables,
      operationName: fixture.operationName,
    }),
  });
};

type Body = any;

const replayJson = async (name: string, override?: { variables?: Record<string, unknown> }) => {
  const fixture = loadLegacyFixture(name);
  const response = await replay(fixture, override);
  const body: Body = await response.json();
  return { fixture, response, body };
};

const sortStrings = (values: string[]) => [...values].sort();
const byId = <T extends { id: string }>(values: T[]) =>
  [...values].sort((a, b) => a.id.localeCompare(b.id));
const onlySeeded = <T extends { id: string }>(values: T[]) =>
  values.filter((value) => seededIds.has(value.id));
const onlySeededStrings = (values: string[]) =>
  values.filter((value) => seededIds.has(value.split("|")[0] ?? ""));

/** Fixtures compared exactly: status, content type and the whole body. */
const EXACT_FIXTURES = [
  "error-syntax",
  "error-unknown-field",
  "error-get-unknown-field",
  "error-missing-required-arg",
  "error-unknown-field-graphql-response-accept",
  "get-no-query",
  "get-explorer-origin",
  "get-disallowed-origin",
  "post-explorer-origin",
  "get-variables-operationName",
  "loo-24h",
  "loo-null-hours",
  "loo-no-name",
  "loo-removed",
  "loo-unknown-id",
  "loo-no-id",
  "loos-text",
  "loos-contributors-ignored",
  "loos-active-null",
  "loos-limit-exceeded",
  "loos-limit-negative",
  "loos-page-zero",
  "loos-bad-datetime",
  "loosByGeohash-unknown-cell",
  "reportsForLoo-unknown-id",
];

/** Unordered list fixtures: `[fixture, root field]`. */
const SET_FIXTURES: [string, string][] = [
  ["get-flutter-loosByProximity-shrewsbury", "loosByProximity"],
  ["get-flutter-loosByProximity-london-150m", "loosByProximity"],
  ["get-flutter-loosByProximity-removed-25m", "loosByProximity"],
  ["loosByProximity-findLoosNearby", "loosByProximity"],
  ["loosByProximity-full-shrewsbury", "loosByProximity"],
  ["loosByProximity-default-distance", "loosByProximity"],
  ["looNamesByIds", "looNamesByIds"],
  ["get-loosByGeohash", "loosByGeohash"],
  ["loosByGeohash-shrewsbury", "loosByGeohash"],
  ["loosByGeohash-london-removed", "loosByGeohash"],
  ["fullLoosByGeohash-shrewsbury", "fullLoosByGeohash"],
  ["fullLoosByGeohash-london", "fullLoosByGeohash"],
  ["fullLoosByGeohash-london-removed", "fullLoosByGeohash"],
];

const REPORT_FIXTURES = ["reportsForLoo-24h", "reportsForLoo-shrewsbury", "reportsForLoo-nested"];

/** Fixtures whose `loos` page is reproducible but whose totals are dataset-wide. */
const PAGE_FIXTURES = ["loos-inactive-area", "loos-date-range"];

/** Covered by legacy-graphql.http.spec.ts (headers only) or by the shape checks below. */
const OTHER_FIXTURES = [
  "options-preflight-explorer",
  "introspection",
  "statistics",
  "areas",
  "loos-default",
  "loos-area-nopayment-oldest-page2",
];

describe("legacy GraphQL contract (golden fixtures)", () => {
  beforeAll(async () => {
    const prisma = getPrismaClient();
    await seedLegacyToilets(prisma, seedToilets);
    for (const name of REPORT_FIXTURES) {
      const fixture = loadLegacyFixture(name);
      await seedLegacyReports(
        prisma,
        String(fixture.variables?.id),
        fixture.body.data.reportsForLoo,
      );
    }
  });

  afterAll(async () => {
    await removeLegacySeed(getPrismaClient(), [...seededIds]);
  });

  it("accounts for every captured fixture", () => {
    const covered = [
      ...EXACT_FIXTURES,
      ...SET_FIXTURES.map(([name]) => name),
      ...REPORT_FIXTURES,
      ...PAGE_FIXTURES,
      ...OTHER_FIXTURES,
    ];
    expect(sortStrings(covered)).toEqual(listLegacyFixtureNames());
  });

  it("seeds the fixture toilets with their stored geohash, location and area", async () => {
    const { body } = await replayJson("loo-24h");
    const seed = seedToilets.find((toilet) => toilet.id === "694c1fc2234c63776b1805a9");
    expect(body.data.loo.geohash).toBe(seed?.geohash);
    expect(body.data.loo.location).toEqual(seed?.location);
    expect(body.data.loo.area).toEqual(seed?.area);
  });

  it.each(EXACT_FIXTURES)("%s matches the fixture exactly", async (name) => {
    const { fixture, response, body } = await replayJson(name);
    expect(response.status).toBe(fixture.status);
    expect(response.headers.get("content-type")).toBe(fixture.headers["content-type"]);
    if (name === "get-no-query") expect(response.headers.get("allow")).toBe("GET, POST");
    expect(body).toEqual(fixture.body);
  });

  it.each(SET_FIXTURES)("%s matches the fixture as a set", async (name, field) => {
    const { fixture, response, body } = await replayJson(name);
    expect(response.status).toBe(fixture.status);
    expect(body.errors).toBeUndefined();
    const actual = body.data[field];
    const expected = fixture.body.data[field];
    if (typeof expected[0] === "string" || expected.length === 0) {
      expect(sortStrings(onlySeededStrings(actual))).toEqual(sortStrings(expected));
    } else {
      expect(byId(onlySeeded(actual))).toEqual(byId(expected));
    }
  });

  it.each(REPORT_FIXTURES)("%s matches the fixture (report ids by position)", async (name) => {
    const { fixture, response, body } = await replayJson(name);
    expect(response.status).toBe(200);
    const actual: Array<{ id: string }> = body.data.reportsForLoo;
    const expected: Array<{ id: string }> = fixture.body.data.reportsForLoo;
    expect(actual).toHaveLength(expected.length);
    for (const report of actual) expect(report.id).toMatch(/^\d+$/);
    const renumbered = actual.map((report, index) => ({ ...report, id: expected[index]?.id }));
    expect(renumbered).toEqual(expected);
  });

  it.each(PAGE_FIXTURES)("%s returns the fixture page", async (name) => {
    const { fixture, response, body } = await replayJson(name);
    expect(response.status).toBe(200);
    const actual = body.data.loos;
    const expected = fixture.body.data.loos;
    expect(actual.loos).toEqual(expected.loos);
    expect(actual.page).toBe(expected.page);
    expect(actual.limit).toBe(expected.limit);
    expect(actual.total).toBeGreaterThanOrEqual(actual.loos.length);
    expect(actual.pages).toBe(Math.ceil(actual.total / actual.limit));
  });

  it("loos-area-nopayment-oldest-page2: fixture loos match the same filter, oldest first", async () => {
    const fixture = loadLegacyFixture("loos-area-nopayment-oldest-page2");
    const { body: page } = await replayJson("loos-area-nopayment-oldest-page2");
    expect(page.data.loos).toMatchObject({ page: 2, limit: 5 });
    expect(page.data.loos.pages).toBe(Math.ceil(page.data.loos.total / 5));

    // Page 1 of the live result is not part of the seed, so check the same
    // filter over every match instead: each fixture loo is there, unchanged.
    const { body } = await replayJson("loos-area-nopayment-oldest-page2", {
      variables: { ...fixture.variables, pagination: { limit: 100, page: 1 } },
    });
    const loos: Body[] = body.data.loos.loos;
    for (const loo of loos) {
      expect(loo.area).toEqual([{ name: "City of London", type: "Local Authority" }]);
      expect(loo).toMatchObject({ noPayment: true, active: true });
    }
    const updated = loos.map((loo) => loo.updatedAt);
    expect(updated).toEqual([...updated].sort());
    for (const expected of fixture.body.data.loos.loos) {
      expect(loos.find((loo) => loo.id === expected.id)).toEqual(expected);
    }
  });

  it("loos-default: newest active loos first, with consistent paging", async () => {
    const { body } = await replayJson("loos-default");
    const result = body.data.loos;
    expect(result).toMatchObject({ page: 1, limit: 10 });
    expect(result.loos.length).toBeLessThanOrEqual(10);
    expect(result.pages).toBe(Math.ceil(result.total / 10));
    const updated: string[] = result.loos.map((loo: Body) => loo.updatedAt);
    expect(updated).toEqual([...updated].sort().reverse());
    for (const loo of result.loos) {
      expect(Object.keys(loo).sort()).toEqual(["area", "id", "name", "updatedAt"]);
    }
  });

  it("statistics: same shape, consistent counts, every area listed", async () => {
    const fixture = loadLegacyFixture("statistics");
    const { body } = await replayJson("statistics");
    const stats = body.data.statistics;
    expect(Object.keys(stats).sort()).toEqual(Object.keys(fixture.body.data.statistics).sort());
    for (const key of ["total", "active", "removed"])
      expect(Number.isInteger(stats[key])).toBe(true);
    expect(stats.active + stats.removed).toBeLessThanOrEqual(stats.total);

    const areaCount = await getPrismaClient().areas.count();
    expect(stats.areaToiletCount).toHaveLength(areaCount);
    for (const entry of stats.areaToiletCount) {
      expect(Object.keys(entry).sort()).toEqual(["active", "name", "removed"]);
    }
    // The seeded toilets are counted in their areas.
    const shropshire = stats.areaToiletCount.find((entry: Body) => entry.name === "Shropshire");
    const seededShropshire = seedToilets.filter(
      (toilet) => toilet.area[0]?.name === "Shropshire" && toilet.active === true,
    ).length;
    expect(shropshire.active).toBeGreaterThanOrEqual(seededShropshire);
  });

  it("areas: name and type for every area", async () => {
    const fixture = loadLegacyFixture("areas");
    const { body } = await replayJson("areas");
    const names = new Set(body.data.areas.map((area: Body) => area.name));
    expect(body.data.areas).toHaveLength(await getPrismaClient().areas.count());
    for (const area of body.data.areas) expect(Object.keys(area).sort()).toEqual(["name", "type"]);
    for (const area of fixture.body.data.areas) expect(names.has(area.name)).toBe(true);
  });
});
