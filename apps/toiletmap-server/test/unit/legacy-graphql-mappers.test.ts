/**
 * Pure helpers of the legacy GraphQL compatibility endpoint: scalars, the
 * compressed geohash strings (byte for byte against the golden fixtures),
 * report mapping, error masking, request limits and header values.
 */
import { GraphQLError, getIntrospectionQuery, parse } from "graphql";
import { describe, expect, it } from "vitest";
import { getLegacySchema } from "../../src/routes/legacy-graphql/executable-schema";
import {
  formatLegacyError,
  queryShapeHash,
  sunsetHeaderValue,
} from "../../src/routes/legacy-graphql/index";
import {
  LEGACY_GRAPHQL_LIMITS,
  READ_ONLY_MESSAGE,
  validateLegacyDocument,
} from "../../src/routes/legacy-graphql/limits";
import {
  compressLegacyFullLoo,
  compressLegacyLoo,
  encodeDetailMask,
  encodeGeohash,
  encodeMeta,
  toBase64Url,
  toLegacyLoo,
  toLegacyOpeningTimes,
  toLegacyReports,
} from "../../src/routes/legacy-graphql/mappers";
import {
  isValidDateTimeString,
  parseDateTimeValue,
  serializeDateTime,
  serializeDateTimeString,
  validateOpeningTimes,
} from "../../src/routes/legacy-graphql/scalars";
import type { LooResponse } from "../../src/services/loo/types";
import {
  loadLegacyFixture,
  loadSeedToilets,
  type SeedToilet,
} from "../integration/utils/legacy-graphql-fixtures";

/** A current-API loo built from a fixture's legacy record. */
const fromSeed = (seed: SeedToilet): LooResponse => ({
  id: seed.id,
  name: seed.name,
  area: seed.area.filter((area): area is { name: string | null; type: string | null } => !!area),
  createdAt: seed.createdAt,
  updatedAt: seed.updatedAt,
  verifiedAt: seed.verifiedAt,
  reports: [],
  contributorsCount: 1,
  geohash: seed.geohash,
  accessible: seed.accessible,
  active: seed.active,
  allGender: seed.allGender,
  attended: seed.attended,
  automatic: seed.automatic,
  babyChange: seed.babyChange,
  children: seed.children,
  men: seed.men,
  women: seed.women,
  urinalOnly: seed.urinalOnly,
  notes: seed.notes,
  noPayment: seed.noPayment,
  paymentDetails: seed.paymentDetails,
  removalReason: seed.removalReason,
  removalCategory: null,
  duplicateOf: null,
  radar: seed.radar,
  openingTimes: seed.openingTimes as LooResponse["openingTimes"],
  location: seed.location,
});

const seeds = new Map(loadSeedToilets().map((seed) => [seed.id, seed]));

describe("DateTime scalar (graphql-iso-date)", () => {
  it.each([
    ["2016-09-14T21:06:08.63+00:00", "2016-09-14T21:06:08.63Z"],
    ["2016-09-14T21:06:08+00:00", "2016-09-14T21:06:08Z"],
    ["2016-09-14T22:06:08.123456+01:00", "2016-09-14T21:06:08.123456Z"],
    ["2016-09-14T08:35:47.237Z", "2016-09-14T08:35:47.237Z"],
  ])("serializes %s as %s", (input, expected) => {
    expect(serializeDateTimeString(input)).toBe(expected);
    expect(serializeDateTime(input)).toBe(expected);
  });

  it("serializes Dates with toISOString and rejects junk with a TypeError", () => {
    expect(serializeDateTime(new Date(Date.UTC(2020, 0, 2, 3, 4, 5)))).toBe(
      "2020-01-02T03:04:05.000Z",
    );
    expect(() => serializeDateTime("not-a-date")).toThrow(TypeError);
    expect(() => serializeDateTime(new Date(Number.NaN))).toThrow(TypeError);
    expect(() => serializeDateTime(42)).toThrow(TypeError);
  });

  it("validates real calendar dates", () => {
    expect(isValidDateTimeString("2024-02-29T00:00:00Z")).toBe(true);
    expect(isValidDateTimeString("2023-02-29T00:00:00Z")).toBe(false);
    expect(isValidDateTimeString("2024-04-31T00:00:00Z")).toBe(false);
    expect(isValidDateTimeString("2024-01-01")).toBe(false);
    expect(parseDateTimeValue("2024-01-31T23:59:59.999Z").toISOString()).toBe(
      "2024-01-31T23:59:59.999Z",
    );
    expect(() => parseDateTimeValue(5)).toThrow(TypeError);
  });
});

describe("OpeningTimes scalar", () => {
  it("accepts 7 days of [] or [HH:MM, HH:MM] and nothing else", () => {
    const week = [["09:00", "17:00"], [], [], [], [], [], ["00:00", "00:00"]];
    expect(validateOpeningTimes(week)).toBe(week);
    expect(() => validateOpeningTimes([])).toThrow();
    expect(() => validateOpeningTimes([...week.slice(1), ["09:00", "24:00"]])).toThrow();
    expect(() => validateOpeningTimes([...week.slice(1), ["9:00", "17:00"]])).toThrow();
  });

  it("rewrites the current API's 24:00 to the legacy 00:00", () => {
    expect(
      toLegacyOpeningTimes([["09:00", "24:00"], ["00:00", "24:00"], [], [], [], [], []]),
    ).toEqual([["09:00", "00:00"], ["00:00", "00:00"], [], [], [], [], []]);
    expect(toLegacyOpeningTimes(null)).toBeNull();
  });
});

describe("toLegacyLoo", () => {
  it("fills the legacy placeholders for a missing location and area", () => {
    const seed = seeds.get("694c1fc2234c63776b1805a9");
    if (!seed) throw new Error("missing seed");
    const legacy = toLegacyLoo({ ...fromSeed(seed), location: null, area: [] });
    expect(legacy.location).toEqual({ lat: 0, lng: 0 });
    expect(legacy.area).toEqual([null]);
    expect(legacy.reports).toEqual([]);
  });

  it("reproduces the loo-24h fixture from its seed record", () => {
    const fixture = loadLegacyFixture("loo-24h");
    const seed = seeds.get("694c1fc2234c63776b1805a9");
    if (!seed) throw new Error("missing seed");
    const legacy: Record<string, unknown> = { ...toLegacyLoo(fromSeed(seed)) };
    const expected = fixture.body.data.loo;
    expect(Object.fromEntries(Object.keys(expected).map((key) => [key, legacy[key]]))).toEqual(
      expected,
    );
  });
});

describe("compressed geohash strings", () => {
  it.each([
    ["loosByGeohash-shrewsbury", "loosByGeohash", compressLegacyLoo],
    ["loosByGeohash-london-removed", "loosByGeohash", compressLegacyLoo],
    ["get-loosByGeohash", "loosByGeohash", compressLegacyLoo],
    ["fullLoosByGeohash-shrewsbury", "fullLoosByGeohash", compressLegacyFullLoo],
    ["fullLoosByGeohash-london", "fullLoosByGeohash", compressLegacyFullLoo],
    ["fullLoosByGeohash-london-removed", "fullLoosByGeohash", compressLegacyFullLoo],
  ])("rebuilds %s byte for byte", (name, field, compress) => {
    const expected: string[] = loadLegacyFixture(name).body.data[field];
    expect(expected.length).toBeGreaterThan(0);
    for (const line of expected) {
      const seed = seeds.get(line.split("|")[0] ?? "");
      if (!seed) throw new Error(`no seed for ${line}`);
      expect(compress(fromSeed(seed))).toBe(line);
    }
  });

  it("encodes geohash9 from the rounded location like legacy, not from the stored column", () => {
    // A real toilet whose true longitude sits 1.6e-13 degrees east of a cell
    // edge: the stored full-precision geohash lands in the next cell, while
    // the 9-decimal GeoJSON location (what legacy encoded) stays west of it.
    const seed = seeds.get("8d846ff1154a5b79ed3f72f6");
    if (!seed) throw new Error("missing seed");
    const loo: LooResponse = {
      ...fromSeed(seed),
      id: "0022fcd2550b6a1c2fd3450f",
      location: { lat: 51.341701488, lng: -0.257878304 },
      geohash: "gcpu44kpp4b4bhbj0n20",
    };
    expect(encodeGeohash(51.341701488, -0.257878304, 9)).toBe("gcpu44kpn");
    expect(compressLegacyLoo(loo).split("|")[1]).toBe("gcpu44kpn");
    expect(compressLegacyFullLoo(loo).split("|")[1]).toBe("gcpu44kpn");
    // The stored prefix is only used when there is no location.
    expect(compressLegacyLoo({ ...loo, location: null }).split("|")[1]).toBe("gcpu44kpp");
  });

  it("matches ngeohash on a midpoint (strictly greater sets the bit)", () => {
    expect(encodeGeohash(0, 0, 9)).toBe("7zzzzzzzz");
    expect(encodeGeohash(57.64911, 10.40744, 11)).toBe("u4pruydqqvj");
  });

  it("leaves an empty meta segment when nothing applies", () => {
    const seed = seeds.get("8d846ff1154a5b79ed3f72f6");
    if (!seed) throw new Error("missing seed");
    expect(compressLegacyFullLoo(fromSeed(seed))).toBe("8d846ff1154a5b79ed3f72f6|gcq5c5nkm|1|");
  });

  it("encodes detail tri-states two bits per field", () => {
    expect(encodeDetailMask({ women: true, men: false, children: null, urinalOnly: true })).toBe(
      0b01_00_10_01,
    );
    expect(encodeDetailMask({ women: null, men: null, children: null, urinalOnly: null })).toBe(0);
  });

  it("base64url-encodes UTF-8 without padding", () => {
    expect(toBase64Url("£é’")).toBe("wqPDqeKAmQ");
    expect(toBase64Url("")).toBe("");
    const meta = encodeMeta({
      name: "a",
      paymentDetails: null,
      notes: null,
      openingTimes: [[], [], [], [], [], [], []],
    });
    expect(JSON.parse(atob(meta.replace(/-/g, "+").replace(/_/g, "/")))).toEqual({
      n: "a",
      o: "......",
    });
  });
});

describe("toLegacyReports", () => {
  const snapshot = (id: string, updatedAt: string, contributors: string[], extra = {}) => ({
    id,
    record: { id: "x", updated_at: updatedAt, contributors, ...extra },
  });

  it("orders by time, user before system at the same time, input order otherwise", () => {
    const reports = toLegacyReports([
      snapshot("3", "2016-09-14T08:35:47.239+00:00", ["a", "a-location"]),
      snapshot("1", "2016-09-14T08:35:47.239+00:00", ["a"]),
      snapshot("2", "2016-09-14T08:35:47.239+00:00", ["b", "b-location"]),
      snapshot("0", "2015-01-08T23:46:12.949+00:00", ["a"]),
    ]);
    expect(reports.map((report) => [report.id, report.isSystemReport])).toEqual([
      ["0", false],
      ["1", false],
      ["3", true],
      ["2", true],
    ]);
  });

  it("maps a snapshot the way the legacy resolver did", () => {
    const [report] = toLegacyReports([
      snapshot("7", "2016-09-14T21:06:08.63+00:00", ["someone"], {
        verified_at: null,
        location: { type: "Point", coordinates: [-2.7526333, 52.7079333] },
        opening_times: [["09:00", "24:00"], [], [], [], [], [], []],
        no_payment: true,
        all_gender: null,
      }),
    ]);
    expect(report).toMatchObject({
      id: "7",
      contributor: "Anonymous",
      createdAt: "2016-09-14T21:06:08.63+00:00",
      isSystemReport: false,
      location: { lat: 52.7079333, lng: -2.7526333 },
      openingTimes: [["09:00", "00:00"], [], [], [], [], [], []],
      noPayment: true,
      allGender: null,
      previous: null,
      loo: null,
      area: null,
    });
    // DateTime serialization later keeps the two fraction digits.
    expect(serializeDateTime(report?.createdAt)).toBe("2016-09-14T21:06:08.63Z");
  });

  it("treats a snapshot without contributors as a user report", () => {
    const [report] = toLegacyReports([snapshot("1", "2020-01-01T00:00:00+00:00", [])]);
    expect(report?.isSystemReport).toBe(false);
    expect(report?.location).toBeNull();
  });
});

describe("error masking", () => {
  it("masks errors that did not start as GraphQLErrors, however wrapped", () => {
    const inner = new GraphQLError("Expected type DateTime", { originalError: new TypeError("x") });
    const outer = new GraphQLError("Variable got invalid value", { originalError: inner });
    expect(formatLegacyError(outer)).toEqual({ message: "Unexpected error." });
    expect(
      formatLegacyError(new GraphQLError("idList is required.", { path: ["looNamesByIds"] })),
    ).toEqual({
      message: "idList is required.",
      path: ["looNamesByIds"],
    });
  });
});

describe("validation rules", () => {
  const schema = getLegacySchema();
  const errorsFor = (query: string) =>
    validateLegacyDocument(schema, parse(query)).map((error) => error.message);

  it("rejects mutations and subscriptions with the read-only message", () => {
    expect(errorsFor("mutation { x }")[0]).toBe(READ_ONLY_MESSAGE);
    expect(errorsFor("subscription { x }")[0]).toBe(READ_ONLY_MESSAGE);
  });

  it("accepts the standard introspection query and the Flutter query", () => {
    expect(errorsFor(getIntrospectionQuery())).toEqual([]);
    expect(
      errorsFor(
        "{loosByProximity(from: {lat: 52.7, lng: -2.7, maxDistance: 2000}){ id name active location{lat lng} notes accessible allGender men women openingTimes babyChange noPayment urinalOnly radar attended}}",
      ),
    ).toEqual([]);
  });

  it("stops at the limits before graphql-js's quadratic rules run", () => {
    // ~990 sibling fields fit in the token limit. The overlap rule is
    // quadratic in them; it must not run once the field limit has failed
    // (an unknown field is only reported by graphql-js's own rules).
    const fields = "id ".repeat(LEGACY_GRAPHQL_LIMITS.maxTokens - 10);
    const query = `{ loo(id: "a") { nope ${fields} } }`;
    const started = performance.now();
    const errors = errorsFor(query);
    const elapsed = performance.now() - started;
    expect(errors).toEqual([
      expect.stringMatching(/^Query is too complex: \d+ fields exceed the maximum of 250\.$/),
    ]);
    expect(elapsed).toBeLessThan(50);
  });

  it("counts __typename and introspection fields towards the field limit", () => {
    expect(errorsFor(`{ ${"__typename ".repeat(251)} }`)).toEqual([
      "Query is too complex: 251 fields exceed the maximum of 250.",
    ]);
    expect(errorsFor(`{ __schema { types { ${"name ".repeat(250)} } } }`)).toEqual([
      "Query is too complex: 252 fields exceed the maximum of 250.",
    ]);
  });

  it("runs graphql-js's rules on documents within the limits", () => {
    expect(errorsFor('{ loo(id: "a") { nope } }')).toEqual([
      expect.stringMatching(/^Cannot query field "nope" on type "Loo"\./),
    ]);
  });

  it("does not loop on fragment cycles", () => {
    const errors = errorsFor(
      "{ loo { ...A } } fragment A on Loo { id ...B } fragment B on Loo { ...A }",
    );
    expect(errors.some((message) => message.includes("Cannot spread fragment"))).toBe(true);
  });
});

describe("request metadata", () => {
  it("hashes the query shape without its literal values", () => {
    const a = queryShapeHash(parse('{ loo(id: "a") { id } }'));
    expect(queryShapeHash(parse('{ loo(id: "b") { id } }'))).toBe(a);
    expect(queryShapeHash(parse('{ loo(id: "a") { name } }'))).not.toBe(a);
  });

  it("normalises the Sunset date and ignores invalid values", () => {
    expect(sunsetHeaderValue("2028-01-01T00:00:00Z")).toBe("Sat, 01 Jan 2028 00:00:00 GMT");
    expect(sunsetHeaderValue("Sat, 01 Jan 2028 00:00:00 GMT")).toBe(
      "Sat, 01 Jan 2028 00:00:00 GMT",
    );
    expect(sunsetHeaderValue(undefined)).toBeNull();
    expect(sunsetHeaderValue("soon")).toBeNull();
  });
});
