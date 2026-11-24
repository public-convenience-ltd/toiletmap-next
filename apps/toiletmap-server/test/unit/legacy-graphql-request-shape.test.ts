/**
 * The legacy GraphQL cache key is built from the parsed request (not the raw
 * URL), and wide reads are recognised for the stricter rate limit.
 */
import { parse } from "graphql";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  isWideLegacyQuery,
  legacyGraphqlCacheKey,
} from "../../src/routes/legacy-graphql/request-shape";

const ORIGIN = "https://api.test";

const keyOf = (query: string, operationName?: string, variables?: Record<string, unknown>) =>
  legacyGraphqlCacheKey(ORIGIN, parse(query), operationName, variables);

describe("legacyGraphqlCacheKey", () => {
  it("is a URL under the reserved cache path", async () => {
    expect(await keyOf("{ areas { name } }")).toMatch(
      /^https:\/\/api\.test\/__cache\/graphql\/v1\/[0-9a-f]{64}$/,
    );
  });

  it("ignores whitespace, comments and commas", async () => {
    const base = await keyOf('{ loo(id: "abc") { id name } }');
    expect(await keyOf('# hello\n{\n  loo(id: "abc") {\n id,\n name\n }\n}')).toBe(base);
  });

  it("ignores variables the operation does not declare, and variable order", async () => {
    const query = "query Q($id: ID!, $x: Int) { loo(id: $id) { id } }";
    const base = await keyOf(query, undefined, { id: "abc", x: 1 });
    expect(await keyOf(query, undefined, { x: 1, id: "abc", junk: "cache-bust" })).toBe(base);
    expect(await keyOf(query, undefined, { id: "abd", x: 1 })).not.toBe(base);
  });

  it("ignores operations that are not run", async () => {
    const base = await keyOf("query A { areas { name } }", "A");
    expect(await keyOf("query A { areas { name } } query B { statistics { total } }", "A")).toBe(
      base,
    );
  });

  it("tells different queries apart", async () => {
    expect(await keyOf("{ areas { name } }")).not.toBe(await keyOf("{ areas { type } }"));
  });

  it("is null when no single operation is selected", async () => {
    expect(await keyOf("query A { areas { name } } query B { areas { type } }")).toBeNull();
    expect(await keyOf("query A { areas { name } }", "Nope")).toBeNull();
  });

  it("canonicalJson sorts keys at every level", () => {
    expect(canonicalJson({ b: [{ d: 1, c: 2 }], a: null, u: undefined })).toBe(
      '{"a":null,"b":[{"c":2,"d":1}]}',
    );
  });
});

describe("isWideLegacyQuery", () => {
  const wide = (query: string, variables?: Record<string, unknown>) =>
    isWideLegacyQuery(parse(query), undefined, variables);

  it("treats the Flutter app's own request as narrow, up to its 5000 m maximum", () => {
    expect(
      wide(
        "{loosByProximity(from: {lat: 51.5, lng: -0.12, maxDistance: 5000}){ id name active location{lat lng} notes }}",
      ),
    ).toBe(false);
    expect(wide("{ loosByProximity(from: {lat: 51.5, lng: -0.12}) { id } }")).toBe(false);
  });

  it("flags proximity beyond 5000 m, inline or through variables", () => {
    expect(
      wide("{ loosByProximity(from: {lat: 51.5, lng: -0.12, maxDistance: 5001}) { id } }"),
    ).toBe(true);
    expect(
      wide("query($f: ProximityInput!) { loosByProximity(from: $f) { id } }", {
        f: { lat: 51.5, lng: -0.12, maxDistance: 50000 },
      }),
    ).toBe(true);
    expect(
      wide("query($d: Int) { loosByProximity(from: {lat: 1, lng: 2, maxDistance: $d}) { id } }", {
        d: 20000,
      }),
    ).toBe(true);
  });

  it("flags broad geohash prefixes, but not precise ones", () => {
    expect(wide('{ loosByGeohash(geohash: "gcp") }')).toBe(true);
    expect(wide("query($g: String!) { loosByGeohash(geohash: $g) }", { g: "gc" })).toBe(true);
    expect(wide('{ loosByGeohash(geohash: "gcpv") }')).toBe(false);
  });

  it("flags search, statistics and full tuples, also behind fragments", () => {
    expect(wide("{ loos(filters: {}) { total } }")).toBe(true);
    expect(wide("{ statistics { total } }")).toBe(true);
    expect(wide('{ fullLoosByGeohash(geohash: "gcpvj") }')).toBe(true);
    expect(wide("query { ...F } fragment F on Query { statistics { total } }")).toBe(true);
    expect(wide("{ ... on Query { statistics { total } } }")).toBe(true);
  });

  it("leaves single-record and small lookups alone", () => {
    expect(wide('{ loo(id: "abc") { id } }')).toBe(false);
    expect(wide("{ areas { name } }")).toBe(false);
    expect(wide("{ __schema { types { name } } }")).toBe(false);
  });
});
