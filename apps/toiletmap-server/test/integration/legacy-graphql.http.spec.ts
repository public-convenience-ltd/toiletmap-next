/**
 * HTTP behaviour of the legacy GraphQL compatibility endpoint (/api/graphql):
 * the exact Flutter request, read-only enforcement, request limits, caching
 * and deprecation headers, CORS, rate limiting and usage logging. The
 * response-body contract is in legacy-graphql.contract.spec.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { LooService } from "../../src/services/loo";
import { logger } from "../../src/utils/logger";
import { getPrismaClient, getTestContext } from "./setup";
import { cleanupManager } from "./utils/cleanup";
import { createFixtureFactory } from "./utils/fixtures";
import { loadLegacyFixture } from "./utils/legacy-graphql-fixtures";
import { comparableSchema, expectedReadOnlySchema } from "./utils/legacy-graphql-introspection";
import { callApi, jsonRequest, readJson } from "./utils/test-client";

const fixtures = createFixtureFactory();

type Body = any;

const READ_ONLY = "This API is read-only; use the REST API.";

const post = (body: unknown, headers: Record<string, string> = {}, env = {}) =>
  callApi(
    "/api/graphql",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
    { env },
  );

const get = (query: string, headers: Record<string, string> = {}, env = {}) =>
  callApi(`/api/graphql?query=${encodeURIComponent(query)}`, { headers }, { env });

/** The Flutter app's query template (lib/.../api: loosByProximity). */
const flutterQuery = (lat: number, lng: number, radius: number) =>
  `{loosByProximity(from: {lat: ${lat}, lng: ${lng}, maxDistance: ${radius}}){ id name active location{lat lng} notes accessible allGender men women openingTimes babyChange noPayment urinalOnly radar attended}}`;

/** Dart's Uri encoding as the app uses it: only spaces and braces are escaped. */
const dartEncode = (query: string) =>
  query.replace(/ /g, "%20").replace(/\{/g, "%7B").replace(/\}/g, "%7D");

afterEach(() => {
  vi.restoreAllMocks();
});

const firstErrorOf = async (response: Response) => {
  const body: Body = await response.json();
  return body.errors?.[0]?.message as string | undefined;
};

describe("legacy GraphQL: the Flutter request", () => {
  it("serves the exact Flutter GET with the fields the app requires", async () => {
    const loo = await fixtures.loos.create({
      name: "Flutter compat loo",
      location: { lat: 51.50733, lng: -0.12765 },
      openingTimes: [["09:00", "24:00"], [], [], [], [], [], ["00:00", "00:00"]],
      noPayment: true,
    });
    const query = flutterQuery(51.50733, -0.12765, 2000);

    const response = await callApi(`/api/graphql?query=${dartEncode(query)}`, {
      headers: { "user-agent": "Dart/3.5 (dart:io)" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const body: Body = await response.json();
    expect(body.errors).toBeUndefined();
    for (const item of body.data.loosByProximity) {
      expect(typeof item.id).toBe("string");
      expect(typeof item.active).toBe("boolean");
      expect(item.location).toEqual({ lat: expect.any(Number), lng: expect.any(Number) });
    }
    expect(body.data.loosByProximity.find((item: Body) => item.id === loo.id)).toEqual({
      id: loo.id,
      name: "Flutter compat loo",
      active: true,
      location: { lat: 51.50733, lng: -0.12765 },
      notes: null,
      accessible: true,
      allGender: null,
      men: null,
      women: null,
      // 24:00 is the current API's midnight; the legacy scalar spells it 00:00.
      openingTimes: [["09:00", "00:00"], [], [], [], [], [], ["00:00", "00:00"]],
      babyChange: null,
      noPayment: true,
      urinalOnly: null,
      radar: null,
      attended: null,
    });
  });
});

describe("legacy GraphQL: introspection", () => {
  it("matches the legacy schema except for the removed mutations", async () => {
    const fixture = loadLegacyFixture("introspection");
    const response = await post({ query: fixture.query });
    expect(response.status).toBe(200);
    const body: Body = await response.json();
    expect(body.errors).toBeUndefined();
    expect(comparableSchema(body.data.__schema)).toEqual(
      expectedReadOnlySchema(fixture.body.data.__schema),
    );
  });

  it("describes the schema as deprecated", async () => {
    const body: Body = await (await post({ query: "{ __schema { description } }" })).json();
    expect(body.data.__schema.description).toMatch(/^DEPRECATED/);
  });
});

describe("legacy GraphQL: read-only", () => {
  it.each([
    [
      "POST mutation",
      () => post({ query: 'mutation { submitVerificationReport(id: "x") { code } }' }),
    ],
    ["GET mutation", () => get('mutation { submitVerificationReport(id: "x") { code } }')],
    ["subscription", () => post({ query: "subscription { loos }" })],
    [
      "mutation beside a selected query",
      () =>
        post({
          query: "query q { areas { name } } mutation m { submitRemovalReport { code } }",
          operationName: "q",
        }),
    ],
  ])("rejects a %s at validation time", async (_label, send) => {
    const spy = vi.spyOn(LooService.prototype, "getById");
    const response = await send();
    expect(response.status).toBe(200);
    const body: Body = await response.json();
    expect(body.data).toBeUndefined();
    expect(body.errors[0].message).toBe(READ_ONLY);
    expect(body.errors[0].locations).toEqual([{ line: 1, column: expect.any(Number) }]);
    expect(spy).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("legacy GraphQL: limits", () => {
  const firstError = async (response: Response) => {
    const body: Body = await response.json();
    return body.errors?.[0]?.message as string | undefined;
  };

  it("limits depth", async () => {
    const query = `{ reportsForLoo(id: "x") { loo { reports { loo { reports { loo { reports { loo { id } } } } } } } } }`;
    expect(await firstError(await post({ query }))).toBe(
      "Query is too complex: depth 9 exceeds the maximum of 8.",
    );
  });

  it("limits aliases", async () => {
    const aliases = Array.from({ length: 16 }, (_, i) => `a${i}: loo(id: "x") { id }`).join(" ");
    expect(await firstError(await post({ query: `{ ${aliases} }` }))).toBe(
      "Query is too complex: 16 aliases exceed the maximum of 15.",
    );
  });

  it("limits cost (expensive root fields)", async () => {
    const query = "{ a: statistics { total } b: statistics { total } c: statistics { total } }";
    expect(await firstError(await post({ query }))).toBe(
      "Query is too complex: cost 30 exceeds the maximum of 20.",
    );
  });

  it("limits the number of fields after expanding fragments", async () => {
    const fields = "id name active notes geohash men women children urinalOnly radar";
    const fragments = Array.from({ length: 26 }, () => `... on Loo { ${fields} }`).join(" ");
    expect(await firstError(await post({ query: `{ loo(id: "x") { ${fragments} } }` }))).toBe(
      "Query is too complex: 261 fields exceed the maximum of 250.",
    );
  });

  it("stops expanding fragment bombs", async () => {
    const fragments = ["fragment F0 on Loo { id }"];
    for (let i = 1; i <= 14; i += 1)
      fragments.push(`fragment F${i} on Loo { ...F${i - 1} ...F${i - 1} }`);
    const query = `{ loo(id: "x") { ...F14 } } ${fragments.join(" ")}`;
    expect(await firstError(await post({ query }))).toBe(
      "Query is too complex: too many selections after expanding fragments.",
    );
  });

  it("limits tokens at parse time", async () => {
    const query = `{ ${"a ".repeat(1_100)}}`;
    expect(await firstError(await post({ query }))).toBe(
      "Syntax Error: Document contains more that 1000 tokens. Parsing aborted.",
    );
  });

  it("rejects a wide sibling-field query on the field limit alone, quickly", async () => {
    // Without the two-pass validation this ran graphql-js's quadratic
    // overlap rule over every field before failing (~300 ms of CPU).
    for (const query of [
      `{ loo(id: "a") { ${"id ".repeat(990)} } }`,
      `{ statistics { ${"total ".repeat(990)} } }`,
      `{ ${"__typename ".repeat(800)} }`,
    ]) {
      const started = performance.now();
      const response = await get(query);
      const elapsed = performance.now() - started;
      const body: Body = await response.json();
      expect(body.errors).toEqual([
        {
          message: expect.stringMatching(/^Query is too complex: \d+ fields exceed the maximum/),
          locations: [{ line: 1, column: 1 }],
        },
      ]);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(elapsed).toBeLessThan(100);
    }
  });

  it("allows only one broad (short-prefix) geohash read per request", async () => {
    const two = await post({
      query: '{ a: loosByGeohash(geohash: "g", active: null) b: loosByGeohash(geohash: "gc") }',
    });
    const body: Body = await two.json();
    expect(body.data).toBeNull();
    expect(body.errors).toEqual([
      expect.objectContaining({
        message:
          "Only 1 geohash query with a prefix shorter than 4 characters is allowed per request.",
      }),
    ]);

    // Variables count too, and fullLoosByGeohash shares the allowance.
    const viaVariables = await post({
      query:
        "query($g: String!) { a: fullLoosByGeohash(geohash: $g) b: loosByGeohash(geohash: $g) }",
      variables: { g: "gcp" },
    });
    expect(await firstError(viaVariables)).toBe(
      "Only 1 geohash query with a prefix shorter than 4 characters is allowed per request.",
    );

    // One broad read (what the zoomed-out legacy web map sends) is fine, and
    // precise cells are not limited beyond the cost budget.
    const one = await post({
      query:
        '{ a: loosByGeohash(geohash: "zz") b: loosByGeohash(geohash: "zzzz") c: loosByGeohash(geohash: "zzzy") }',
    });
    expect(await one.json()).toEqual({ data: { a: [], b: [], c: [] } });
  });

  it("rejects oversized queries and bodies with 413", async () => {
    const longQuery = `{ __typename } # ${"x".repeat(10_000)}`;
    expect((await post({ query: longQuery })).status).toBe(413);
    expect((await get(longQuery)).status).toBe(413);
    const bigBody = await post({ query: "{ __typename }", variables: { pad: "x".repeat(40_000) } });
    expect(bigBody.status).toBe(413);
    expect(await firstError(bigBody)).toBe("Request body is too large.");
  });

  it("caps maxDistance at the REST proximity maximum", async () => {
    const response = await post({
      query: "{ loosByProximity(from: { lat: 51.5, lng: -0.1, maxDistance: 50001 }) { id } }",
    });
    const body: Body = await response.json();
    expect(body.data).toBeNull();
    expect(body.errors[0]).toMatchObject({
      message: "maxDistance must be at most 50000 metres.",
      path: ["loosByProximity"],
    });
  });

  it("refuses looNamesByIds without a list, or with too many ids", async () => {
    expect(await firstError(await post({ query: "{ looNamesByIds { id } }" }))).toBe(
      "idList is required.",
    );
    const ids = Array.from({ length: 101 }, (_, i) => i.toString(16).padStart(24, "0"));
    const response = await post({
      query: "query($ids: [ID]) { looNamesByIds(idList: $ids) { id } }",
      variables: { ids },
    });
    expect(await firstError(response)).toBe("idList may contain at most 100 ids.");
  });

  it("refuses an empty geohash prefix (it would match every toilet)", async () => {
    expect(await firstError(await post({ query: '{ loosByGeohash(geohash: "") }' }))).toBe(
      "geohash must not be empty.",
    );
  });

  it("allows the standard introspection query and the legacy client operations", async () => {
    for (const name of ["introspection", "loo-24h", "loosByProximity-full-shrewsbury"]) {
      const fixture = loadLegacyFixture(name);
      const body: Body = await (
        await post({ query: fixture.query, variables: fixture.variables })
      ).json();
      // Resolver errors (unknown ids here) carry a path; validation errors do not.
      const validationErrors = (body.errors ?? []).filter((error: Body) => !error.path);
      expect(validationErrors, name).toEqual([]);
    }
  });
});

describe("legacy GraphQL: pagination like legacy", () => {
  it("serves a count-only loos page with limit 0, failing only `pages`", async () => {
    const response = await post({
      query:
        "{ loos(filters: {}, pagination: { limit: 0, page: 1 }) { loos { id } total page limit pages } }",
    });
    const body: Body = await response.json();
    expect(body.data.loos).toMatchObject({ loos: [], page: 1, limit: 0, pages: null });
    expect(typeof body.data.loos.total).toBe("number");
    expect(body.errors).toEqual([
      expect.objectContaining({
        message: expect.stringMatching(/^Int cannot represent non-integer value: (Infinity|NaN)$/),
        path: ["loos", "pages"],
      }),
    ]);

    const countOnly: Body = await (
      await post({ query: "{ loos(filters: {}, pagination: { limit: 0, page: 0 }) { total } }" })
    ).json();
    expect(countOnly.errors).toBeUndefined();
    expect(typeof countOnly.data.loos.total).toBe("number");
  });

  it("still refuses negative values, page 0 with a page size, and pages over 100", async () => {
    for (const pagination of [
      "{ limit: -1, page: 1 }",
      "{ limit: 10, page: 0 }",
      "{ limit: 101, page: 1 }",
    ]) {
      const body: Body = await (
        await post({ query: `{ loos(filters: {}, pagination: ${pagination}) { total } }` })
      ).json();
      expect(body.data, pagination).toBeNull();
      expect(body.errors[0].message, pagination).toBe("Unexpected error.");
    }
  });
});

describe("legacy GraphQL: data written by the current API", () => {
  const authHeaders = () => ({ Authorization: `Bearer ${getTestContext().issueToken()}` });

  it("maps reports for a loo created and edited through REST", async () => {
    const created = await callApi(
      "/api/loos",
      jsonRequest(
        "POST",
        { name: "REST reports loo", location: { lat: 52.70793, lng: -2.75263 }, accessible: true },
        authHeaders(),
      ),
    );
    expect(created.status).toBe(201);
    const { id } = await readJson<{ id: string }>(created);
    cleanupManager.trackLoo(id);
    const edited = await callApi(
      `/api/loos/${id}`,
      jsonRequest("PUT", { notes: "Edited through REST" }, authHeaders()),
    );
    expect(edited.status).toBe(200);

    const body: Body = await (
      await post({
        query: `{ reportsForLoo(id: "${id}") { id contributor createdAt isSystemReport name notes accessible location { lat lng } } }`,
      })
    ).json();
    expect(body.errors).toBeUndefined();
    const reports = body.data.reportsForLoo;
    const userReports = reports.filter((report: Body) => !report.isSystemReport);
    expect(userReports).toHaveLength(2);
    for (const report of reports) {
      expect(report.id).toMatch(/^\d+$/);
      expect(report.contributor).toBe("Anonymous");
      // graphql-iso-date output: UTC, trailing fraction zeros trimmed.
      expect(report.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d*[1-9])?Z$/);
    }
    const times = reports.map((report: Body) => Date.parse(report.createdAt));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(userReports[0]).toMatchObject({
      name: "REST reports loo",
      notes: null,
      accessible: true,
      location: { lat: 52.70793, lng: -2.75263 },
    });
    expect(userReports[1]).toMatchObject({
      name: "REST reports loo",
      notes: "Edited through REST",
    });
  });

  it("encodes geohash9 from the rounded location for a point on a cell edge", async () => {
    // The true longitude is 1.6e-13 degrees east of a geohash cell edge; the
    // 9-decimal GeoJSON location (which legacy encoded) is just west of it.
    const loo = await fixtures.loos.create({
      name: "Cell edge loo",
      location: { lat: 51.341701488, lng: -0.25787830352767 },
    });
    const stored = await getPrismaClient().toilets.findUnique({
      where: { id: loo.id },
      select: { geohash: true, location: true },
    });
    expect(stored?.geohash?.slice(0, 9)).toBe("gcpu44kpp");
    expect(stored?.location).toMatchObject({ coordinates: [-0.257878304, 51.341701488] });

    const body: Body = await (
      await post({
        query: '{ loosByGeohash(geohash: "gcpu44kp") fullLoosByGeohash(geohash: "gcpu44kp") }',
      })
    ).json();
    expect(body.errors).toBeUndefined();
    const line = body.data.loosByGeohash.find((item: string) => item.startsWith(`${loo.id}|`));
    expect(line?.split("|")[1]).toBe("gcpu44kpn");
    const full = body.data.fullLoosByGeohash.find((item: string) => item.startsWith(`${loo.id}|`));
    expect(full?.split("|")[1]).toBe("gcpu44kpn");
  });
});

describe("legacy GraphQL: reports never fan out", () => {
  it("resolves previous/loo/area without any lookups", async () => {
    const loo = await fixtures.loos.create({ name: "Report fan-out loo" });
    await fixtures.loos.upsert(loo.id, { notes: "second" }, "fan-out-tester");
    const snapshots = vi.spyOn(LooService.prototype, "getAuditSnapshots");
    const byId = vi.spyOn(LooService.prototype, "getById");

    const body: Body = await (
      await post({
        query: `{ reportsForLoo(id: "${loo.id}") { id previous { id previous { id } } loo { id } area { name } } }`,
      })
    ).json();

    expect(body.errors).toBeUndefined();
    expect(body.data.reportsForLoo.length).toBeGreaterThanOrEqual(2);
    for (const report of body.data.reportsForLoo) {
      expect(report).toMatchObject({ previous: null, loo: null, area: null });
    }
    expect(snapshots).toHaveBeenCalledTimes(1);
    expect(byId).not.toHaveBeenCalled();
  });
});

describe("legacy GraphQL: headers", () => {
  it("marks every response deprecated and links to the REST docs", async () => {
    for (const response of [await get("{ __typename }"), await post({ query: "{ nope }" })]) {
      expect(response.headers.get("deprecation")).toBe("true");
      expect(response.headers.get("link")).toBe(
        '<https://integration.test/api/docs>; rel="deprecation"; type="text/html"',
      );
      expect(response.headers.get("sunset")).toBeNull();
    }
  });

  it("sends Sunset only when GRAPHQL_SUNSET holds a valid date", async () => {
    const withDate = await get(
      "{ __typename }",
      {},
      { GRAPHQL_SUNSET: "Sat, 01 Jan 2028 00:00:00 GMT" },
    );
    expect(withDate.headers.get("sunset")).toBe("Sat, 01 Jan 2028 00:00:00 GMT");
    const invalid = await get("{ __typename }", {}, { GRAPHQL_SUNSET: "next year" });
    expect(invalid.headers.get("sunset")).toBeNull();
  });

  it("caches successful GETs briefly and never POSTs or errors", async () => {
    expect((await get("{ areas { name } }")).headers.get("cache-control")).toBe(
      "public, max-age=60",
    );
    expect((await post({ query: "{ areas { name } }" })).headers.get("cache-control")).toBe(
      "no-store",
    );
    expect(
      (await get('{ loo(id: "000000000000000000000000") { id } }')).headers.get("cache-control"),
    ).toBe("no-store");
  });

  it("answers HEAD without a body and without poisoning the GET cache", async () => {
    const query = encodeURIComponent('{ __type(name: "Point") { name } }');
    const head = await callApi(`/api/graphql?query=${query}`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const getResponse = await callApi(`/api/graphql?query=${query}`);
    expect(await getResponse.json()).toEqual({ data: { __type: { name: "Point" } } });
  });

  it("serves a repeated GET from the edge cache with fresh per-request headers", async () => {
    const loo = await fixtures.loos.create({ name: "Edge cached loo" });
    const query = `{ loo(id: "${loo.id}") { id name } }`;
    const first = await get(query);
    expect(first.status).toBe(200);
    // Gone from the database, but the cached body is reused for up to 60s.
    await getPrismaClient().toilets.delete({ where: { id: loo.id } });
    const second = await get(query, { origin: "https://example.com" });
    expect(await second.json()).toEqual({ data: { loo: { id: loo.id, name: "Edge cached loo" } } });
    expect(second.headers.get("deprecation")).toBe("true");
    expect(second.headers.get("access-control-allow-origin")).toBe("*");
    expect(second.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("sends Vary: Accept, since the content type depends on it", async () => {
    const plain = await get("{ __typename }");
    expect(plain.headers.get("cache-control")).toBe("public, max-age=60");
    expect(plain.headers.get("vary")).toContain("Accept");
    const graphqlResponse = await get("{ __typename }", {
      accept: "application/graphql-response+json",
    });
    expect(graphqlResponse.headers.get("content-type")).toBe(
      "application/graphql-response+json; charset=utf-8",
    );
    expect(graphqlResponse.headers.get("vary")).toContain("Accept");
    // A cache hit carries it too.
    expect((await get("{ __typename }")).headers.get("vary")).toContain("Accept");
  });

  it("accepts the other POST encodings graphql-yoga accepted", async () => {
    const raw = await callApi("/api/graphql", {
      method: "POST",
      headers: { "content-type": "application/graphql" },
      body: "{ __typename }",
    });
    expect(raw.status).toBe(200);
    expect(await raw.json()).toEqual({ data: { __typename: "Query" } });

    const form = await callApi("/api/graphql", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        query: "query q($name: String!) { __type(name: $name) { name } }",
        variables: JSON.stringify({ name: "Point" }),
        operationName: "q",
      }).toString(),
    });
    expect(form.status).toBe(200);
    expect(await form.json()).toEqual({ data: { __type: { name: "Point" } } });

    const formMutation = await callApi("/api/graphql", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        query: 'mutation { submitVerificationReport(id: "x") { code } }',
      }).toString(),
    });
    expect(await firstErrorOf(formMutation)).toBe(READ_ONLY);
  });

  it("answers the media-type variants and transport errors like the legacy server", async () => {
    const graphqlResponse = await post(
      { query: "{ statistics { nope } }" },
      { accept: "application/graphql-response+json" },
    );
    expect(graphqlResponse.status).toBe(400);
    expect(graphqlResponse.headers.get("content-type")).toBe(
      "application/graphql-response+json; charset=utf-8",
    );

    const put = await callApi("/api/graphql", { method: "PUT" });
    expect(put.status).toBe(405);
    expect(put.headers.get("allow")).toBe("GET, POST");

    const text = await callApi("/api/graphql", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{ __typename }",
    });
    expect(text.status).toBe(415);

    const badJson = await callApi("/api/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toEqual({ errors: [{ message: "POST body sent invalid JSON." }] });

    const badVariables = await callApi("/api/graphql?query=%7B__typename%7D&variables=%7B");
    expect(badVariables.status).toBe(400);
  });
});

describe("legacy GraphQL: CORS", () => {
  it("answers the explorer preflight like the legacy API, without credentials", async () => {
    const fixture = loadLegacyFixture("options-preflight-explorer");
    const response = await callApi("/api/graphql", {
      method: "OPTIONS",
      headers: fixture.requestHeaders,
    });
    expect(response.status).toBe(204);
    for (const name of [
      "access-control-allow-origin",
      "access-control-allow-methods",
      "access-control-allow-headers",
      "vary",
    ]) {
      expect(response.headers.get(name), name).toBe(fixture.headers[name]);
    }
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("does not approve preflights from other origins", async () => {
    const response = await callApi("/api/graphql", {
      method: "OPTIONS",
      headers: {
        origin: "https://example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("lets any origin read GET and POST responses, never with credentials", async () => {
    const env = { ALLOWED_ORIGINS: "https://www.toiletmap.org.uk" };
    for (const origin of ["https://example.com", "https://www.toiletmap.org.uk"]) {
      for (const response of [
        await get("{ __typename }", { origin }, env),
        await post({ query: "{ __typename }" }, { origin }, env),
      ]) {
        expect(response.headers.get("access-control-allow-origin")).toBe("*");
        expect(response.headers.get("access-control-allow-credentials")).toBeNull();
        expect(response.headers.get("access-control-expose-headers")).toBe(
          "Deprecation, Sunset, Link",
        );
      }
    }
  });
});

describe("legacy GraphQL: rate limiting, auth and logging", () => {
  const denyAll = { limit: async () => ({ success: false }) };

  it("applies the read rate limiter, introspection included", async () => {
    const env = { RATE_LIMIT_READ: denyAll };
    const introspection = await post({ query: "{ __schema { queryType { name } } }" }, {}, env);
    expect(introspection.status).toBe(429);
    expect(introspection.headers.get("access-control-allow-origin")).toBe("*");
    expect((await get("{ __typename }", {}, env)).status).toBe(429);
  });

  it("ignores credentials: a bad bearer token is not rejected", async () => {
    const response = await get("{ __typename }", { authorization: "Bearer not-a-token" });
    expect(response.status).toBe(200);
  });

  it("writes no IP or user agent to any log line, request and rate-limit logs included", async () => {
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(
          args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "),
        );
      });
    }
    const caller = { "cf-connecting-ip": "203.0.113.9", "user-agent": "Dart/3.5 (dart:io)" };
    await get("{ __typename }", caller);
    await post({ query: "{ __typename }" }, caller);
    await get("{ __typename }", caller, { RATE_LIMIT_READ: denyAll });

    expect(lines.some((line) => line.includes("Incoming request"))).toBe(true);
    expect(lines.some((line) => line.includes("Rate limit exceeded"))).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain("203.0.113.9");
      expect(line).not.toContain("Dart/3.5");
    }

    // Other routes keep their request logging unchanged.
    lines.length = 0;
    await callApi("/api/loos/000000000000000000000000", { headers: caller });
    expect(lines.some((line) => line.includes("203.0.113.9"))).toBe(true);
  });

  it("logs operation name, query shape and origin, but no IP, user agent or variables", async () => {
    const info = vi.spyOn(logger, "info");
    const query = "query findLoo($id: ID) { loo(id: $id) { id } } ";
    await post(
      { query, variables: { id: "000000000000000000000000" } },
      {
        origin: "https://explorer.toiletmap.org.uk",
        "cf-connecting-ip": "203.0.113.9",
        "user-agent": "secret-agent",
      },
    );
    await get('{ loo(id: "111111111111111111111111") { id } }');
    await get('{ loo(id: "222222222222222222222222") { id } }');

    const entries = info.mock.calls
      .filter(([message]) => message === "Legacy GraphQL request")
      .map(([, context]) => context as Record<string, unknown>);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      operationName: "findLoo",
      rootFields: ["loo"],
      origin: "https://explorer.toiletmap.org.uk",
      queryHash: expect.stringMatching(/^[0-9a-f]{8}$/),
    });
    // Literal values are not part of the shape.
    expect(entries[1]?.queryHash).toBe(entries[2]?.queryHash);
    const logged = JSON.stringify(entries);
    for (const secret of ["203.0.113.9", "secret-agent", "000000000000000000000000"]) {
      expect(logged).not.toContain(secret);
    }
  });
});
