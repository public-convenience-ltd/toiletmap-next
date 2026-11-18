#!/usr/bin/env node
/**
 * Re-capture the legacy GraphQL golden fixtures from the live legacy API.
 *
 * READ-ONLY. This script only ever sends GraphQL *queries* (plus one CORS
 * preflight OPTIONS request). Any document containing a `mutation` or
 * `subscription` operation is refused before a request is made.
 *
 * Usage (from this folder or anywhere):
 *   node apps/toiletmap-server/test/fixtures/legacy-graphql/capture.mjs [--dry-run] [--only=name,name]
 *
 * Environment:
 *   LEGACY_GRAPHQL_ORIGIN  default https://www.toiletmap.org.uk
 *   MAX_REQUESTS           default 55 (hard cap per run, redirects and OPTIONS included)
 *   MIN_INTERVAL_MS        default 1100 (never more than 1 request per second)
 *
 * No personal data is ever sent: the only identifying header is the
 * User-Agent "toiletmap-next-compat-fixtures".
 *
 * Writes <case>.json files plus seed-toilets.json next to this script.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = process.env.LEGACY_GRAPHQL_ORIGIN ?? "https://www.toiletmap.org.uk";
const MAX_REQUESTS = Number(process.env.MAX_REQUESTS ?? 55);
const MIN_INTERVAL_MS = Math.max(1000, Number(process.env.MIN_INTERVAL_MS ?? 1100));
const USER_AGENT = "toiletmap-next-compat-fixtures";
const DRY_RUN = process.argv.includes("--dry-run");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "")
  .slice("--only=".length)
  .split(",")
  .filter(Boolean);

const EXPLORER_ORIGIN = "https://explorer.toiletmap.org.uk";
const DISALLOWED_ORIGIN = "https://example.com";

// Response headers worth keeping in the fixtures (everything else is noise such as
// request ids, dates and server timing).
const HEADER_SUBSET = [
  "content-type",
  "cache-control",
  "vary",
  "location",
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "access-control-expose-headers",
  "access-control-max-age",
  "x-vercel-cache",
  "allow",
];

// Fixed inputs so fixtures are reproducible.
const SHREWSBURY = { lat: 52.7077, lng: -2.754 }; // town centre, sparse enough for 2 km
const SOUTHWARK = { lat: 51.5094, lng: -0.0906 }; // Watermark Place, City of London
const GEOHASH_SHREWSBURY = "gcq5c7"; // ~1.2 km x 0.6 km, ~6 active loos
const GEOHASH_LONDON = "gcpvjb"; // 24h, null hours, non-ASCII meta, removed loos
const LOO_24H = "694c1fc2234c63776b1805a9"; // Watermark Place (Automatic), 00:00-00:00 x7
const LOO_NULL_HOURS = "66a0a7e5a9b1590a9d222297"; // Cathedral cafe, openingTimes null
const LOO_NO_NAME = "8d846ff1154a5b79ed3f72f6"; // Shrewsbury, name null, filter mask 1
const LOO_REMOVED = "22c44a1e75743f30d729e6c1"; // Pret, active: false
const LOO_SHREWSBURY = "23113ed968c5668a947de1b0"; // Butcher Row
const UNKNOWN_ID = "000000000000000000000000";

// The exact template the Flutter app (apps/toiletmap-app/lib/util/map_util.dart) sends
// with its default feature list.
const FLUTTER_PARAMS =
  "accessible allGender men women openingTimes babyChange noPayment urinalOnly radar attended";
const flutterQuery = (lat, lng, radius) =>
  `{loosByProximity(from: {lat: ${lat}, lng: ${lng}, maxDistance: ${radius}}){ id name active location{lat lng} notes ${FLUTTER_PARAMS}}}`;

const LOO_FRAGMENT = `fragment LooFragment on Loo {
  id
  createdAt
  updatedAt
  verifiedAt
  active
  location {
    lat
    lng
  }
  name
  openingTimes
  accessible
  men
  women
  allGender
  babyChange
  children
  urinalOnly
  radar
  automatic
  noPayment
  paymentDetails
  notes
  removalReason
  attended
  geohash
  area {
    name
    type
  }
}`;

const LOO_REPORT_FRAGMENT = `fragment LooReportFragment on Report {
  id
  createdAt
  verifiedAt
  active
  location {
    lat
    lng
  }
  name
  openingTimes
  accessible
  men
  women
  allGender
  babyChange
  children
  urinalOnly
  radar
  automatic
  noPayment
  paymentDetails
  notes
  removalReason
  attended
  geohash
  isSystemReport
  contributor
}`;

const FIND_LOO_BY_ID = `query findLooById($id: ID) {
  loo(id: $id) {
    ...LooFragment
    reports {
      id
    }
  }
}
${LOO_FRAGMENT}`;

const SEARCH_LOOS = `query searchLoos(
  $filters: LooFilter!
  $pagination: PaginationInput = { limit: 10, page: 1 }
  $sort: SortOrder = NEWEST_FIRST
) {
  loos(filters: $filters, pagination: $pagination, sort: $sort) {
    loos {
      id
      name
      area {
        name
        type
      }
      updatedAt
    }
    total
    page
    limit
    pages
  }
}`;

const SEARCH_LOOS_FULL = `query searchLoosFull(
  $filters: LooFilter!
  $pagination: PaginationInput
  $sort: SortOrder
) {
  loos(filters: $filters, pagination: $pagination, sort: $sort) {
    loos {
      ...LooFragment
    }
    total
    page
    limit
    pages
  }
}
${LOO_FRAGMENT}`;

const STATISTICS = `query statistics {
  statistics {
    total
    active
    removed
    areaToiletCount {
      name
      active
      removed
    }
  }
}`;

const AREAS = `query areas {
  areas {
    name
    type
  }
}`;

const FIND_LOOS_NEARBY = `query findLoosNearby($lat: Float!, $lng: Float!, $radius: Int!) {
  loosByProximity(from: { lat: $lat, lng: $lng, maxDistance: $radius }) {
    id
    name
    location {
      lat
      lng
    }
    noPayment
    allGender
    automatic
    accessible
    babyChange
    radar
  }
}`;

const LOOS_NEARBY_FULL = `query loosNearbyFull($from: ProximityInput!) {
  loosByProximity(from: $from) {
    ...LooFragment
  }
}
${LOO_FRAGMENT}`;

const LOO_NAMES_BY_IDS = `query looNamesByIds($idList: [ID]) {
  looNamesByIds(idList: $idList) {
    id
    name
  }
}`;

const LOOS_BY_GEOHASH = `query loosByGeohash($geohash: String!, $active: Boolean = true) {
  loosByGeohash(geohash: $geohash, active: $active)
}`;

const FULL_LOOS_BY_GEOHASH = `query fullLoosByGeohash($geohash: String!, $active: Boolean = true) {
  fullLoosByGeohash(geohash: $geohash, active: $active)
}`;

const REPORT_HISTORY = `query looReportHistory($id: ID!) {
  reportsForLoo(id: $id) {
    ...LooReportFragment
  }
}
${LOO_REPORT_FRAGMENT}`;

const REPORT_HISTORY_NESTED = `query looReportHistoryNested($id: ID!) {
  reportsForLoo(id: $id) {
    id
    createdAt
    contributor
    isSystemReport
    previous {
      id
    }
    loo {
      id
    }
    area {
      name
      type
    }
  }
}`;

const INTROSPECTION = fs.readFileSync(path.join(HERE, "introspection-query.graphql"), "utf8");

/** Trim a list at `path` (dot separated, inside body.data) to `keep` entries. */
const trimList = (keep, ...paths) => (body) => {
  const notes = [];
  for (const p of paths) {
    const parts = p.split(".");
    let parent = body?.data;
    for (const part of parts.slice(0, -1)) parent = parent?.[part];
    const key = parts.at(-1);
    const list = parent?.[key];
    if (Array.isArray(list) && list.length > keep) {
      notes.push({ path: `data.${p}`, originalLength: list.length, kept: keep });
      parent[key] = list.slice(0, keep);
    }
  }
  return notes;
};

/** @type {Array<Record<string, any>>} */
const CASES = [
  // ---- Transport, headers, CORS ----------------------------------------------------
  {
    name: "get-flutter-loosByProximity-shrewsbury",
    description:
      "EXACT Flutter request: GET /api/?query=<template> with default radius 2000 and default feature list, no Origin, Dart-style URL encoding (spaces %20, braces %7B %7D).",
    method: "GET",
    path: "/api/",
    query: flutterQuery(SHREWSBURY.lat, SHREWSBURY.lng, 2000),
  },
  {
    name: "get-flutter-loosByProximity-london-150m",
    description:
      "Flutter template (custom radius 150 m) near Watermark Place: includes a 24h loo, null-hours loos and removed loos (loosByProximity does not filter on active).",
    method: "GET",
    path: "/api/",
    query: flutterQuery(SOUTHWARK.lat, SOUTHWARK.lng, 150),
  },
  {
    name: "get-flutter-loosByProximity-removed-25m",
    description:
      "Flutter template (radius 25 m) centred on a removed loo: does loosByProximity return active: false loos?",
    method: "GET",
    path: "/api/",
    query: flutterQuery(51.505445843, -0.088849068, 25),
  },
  {
    name: "get-explorer-origin",
    description: "GET ?query= with an allow-listed Origin (explorer) to record CORS headers.",
    method: "GET",
    path: "/api",
    query: `{ loo(id: "${LOO_24H}") { id name } }`,
    headers: { origin: EXPLORER_ORIGIN },
  },
  {
    name: "get-disallowed-origin",
    description: "GET ?query= with an Origin that is not on the legacy CORS allow-list.",
    method: "GET",
    path: "/api",
    query: `{ loo(id: "${LOO_24H}") { id name } }`,
    headers: { origin: DISALLOWED_ORIGIN },
  },
  {
    name: "options-preflight-explorer",
    description: "CORS preflight for a JSON POST from explorer.toiletmap.org.uk.",
    method: "OPTIONS",
    path: "/api",
    headers: {
      origin: EXPLORER_ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  },
  {
    name: "post-explorer-origin",
    description: "POST JSON with an allow-listed Origin to record CORS headers on POST.",
    method: "POST",
    path: "/api",
    query: `{ loo(id: "${LOO_24H}") { id name } }`,
    headers: { origin: EXPLORER_ORIGIN },
  },
  {
    name: "get-variables-operationName",
    description: "GET with query, variables (JSON) and operationName URL params.",
    method: "GET",
    path: "/api",
    query: "query one($id: ID) { loo(id: $id) { id name } } query two { areas { name } }",
    variables: { id: LOO_NULL_HOURS },
    operationName: "one",
  },
  {
    name: "get-no-query",
    description: "GET /api with no query param (what does a bare GET return?).",
    method: "GET",
    path: "/api",
  },
  {
    name: "get-loosByGeohash",
    description: "loosByGeohash over GET to see whether @cacheControl(maxAge: 21600) yields a header.",
    method: "GET",
    path: "/api",
    query: LOOS_BY_GEOHASH,
    variables: { geohash: GEOHASH_SHREWSBURY },
  },

  // ---- Introspection, statistics, areas ---------------------------------------------
  {
    name: "introspection",
    description: "Standard graphql-js getIntrospectionQuery({ descriptions: true }) over POST.",
    method: "POST",
    query: INTROSPECTION,
    operationName: "IntrospectionQuery",
  },
  {
    name: "statistics",
    description: "statistics query (counts are live data; areaToiletCount trimmed).",
    method: "POST",
    query: STATISTICS,
    trim: trimList(10, "statistics.areaToiletCount"),
  },
  {
    name: "areas",
    description: "areas query (trimmed).",
    method: "POST",
    query: AREAS,
    trim: trimList(10, "areas"),
  },

  // ---- loo ---------------------------------------------------------------------------
  {
    name: "loo-24h",
    description: "loo(id) with LooFragment + reports for a loo open 24h (00:00-00:00 every day).",
    method: "POST",
    query: FIND_LOO_BY_ID,
    variables: { id: LOO_24H },
  },
  {
    name: "loo-null-hours",
    description: "loo(id) for a loo whose openingTimes is null (unknown hours).",
    method: "POST",
    query: FIND_LOO_BY_ID,
    variables: { id: LOO_NULL_HOURS },
  },
  {
    name: "loo-no-name",
    description: "loo(id) for a loo with null name and mostly-null flags.",
    method: "POST",
    query: FIND_LOO_BY_ID,
    variables: { id: LOO_NO_NAME },
  },
  {
    name: "loo-removed",
    description: "loo(id) for a removed (active: false) loo.",
    method: "POST",
    query: FIND_LOO_BY_ID,
    variables: { id: LOO_REMOVED },
  },
  {
    name: "loo-unknown-id",
    description: "loo(id) for an id that does not exist.",
    method: "POST",
    query: FIND_LOO_BY_ID,
    variables: { id: UNKNOWN_ID },
  },
  {
    name: "loo-no-id",
    description: "loo with no id argument (id is nullable in the schema).",
    method: "POST",
    query: "{ loo { id name } }",
  },

  // ---- loos (search) -----------------------------------------------------------------
  {
    name: "loos-default",
    description: "searchLoos with empty filters and default pagination/sort (live data).",
    method: "POST",
    query: SEARCH_LOOS,
    variables: { filters: {} },
  },
  {
    name: "loos-area-nopayment-oldest-page2",
    description:
      "Full fields; areaName + noPayment filters, limit 5 page 2, OLDEST_FIRST. areaName is taken from loo-24h.",
    method: "POST",
    query: SEARCH_LOOS_FULL,
    variables: (ctx) => ({
      filters: { areaName: ctx.areaName, noPayment: true },
      pagination: { limit: 5, page: 2 },
      sort: "OLDEST_FIRST",
    }),
  },
  {
    name: "loos-text",
    description: "Text filter (case-insensitive contains on name).",
    method: "POST",
    query: SEARCH_LOOS,
    variables: { filters: { text: "WATERMARK" }, pagination: { limit: 5, page: 1 } },
  },
  {
    name: "loos-inactive-area",
    description: "Removed loos in an area (active: false), limit 3.",
    method: "POST",
    query: SEARCH_LOOS,
    variables: (ctx) => ({
      filters: { active: false, areaName: ctx.areaName },
      pagination: { limit: 3, page: 1 },
    }),
  },
  {
    name: "loos-date-range",
    description: "fromDate/toDate filters (on updated_at), limit 3, OLDEST_FIRST.",
    method: "POST",
    query: SEARCH_LOOS,
    variables: {
      filters: { fromDate: "2024-01-01T00:00:00.000Z", toDate: "2024-01-31T23:59:59.999Z" },
      pagination: { limit: 3, page: 1 },
      sort: "OLDEST_FIRST",
    },
  },
  {
    name: "loos-contributors-ignored",
    description: "contributors filter is accepted by the schema but ignored by the resolver.",
    method: "POST",
    query: SEARCH_LOOS,
    variables: { filters: { contributors: ["nobody"], text: "WATERMARK" } },
  },
  {
    name: "loos-active-null",
    description: "filters.active explicitly null.",
    method: "POST",
    query: SEARCH_LOOS,
    variables: { filters: { active: null, text: "WATERMARK" }, pagination: { limit: 2 } },
  },
  {
    name: "loos-limit-exceeded",
    description: "pagination.limit 101 -> error.",
    method: "POST",
    query: SEARCH_LOOS,
    variables: { filters: {}, pagination: { limit: 101, page: 1 } },
  },
  {
    name: "loos-limit-negative",
    description: "pagination.limit -1 -> error.",
    method: "POST",
    query: SEARCH_LOOS,
    variables: { filters: {}, pagination: { limit: -1, page: 1 } },
  },
  {
    name: "loos-page-zero",
    description: "pagination.page 0 (passes the < 0 check, yields a negative skip).",
    method: "POST",
    query: SEARCH_LOOS,
    variables: { filters: { text: "WATERMARK" }, pagination: { limit: 2, page: 0 } },
  },
  {
    name: "loos-bad-datetime",
    description: "Invalid DateTime variable -> variable coercion error format.",
    method: "POST",
    query: SEARCH_LOOS,
    variables: { filters: { fromDate: "not-a-date" } },
  },

  // ---- loosByProximity ---------------------------------------------------------------
  {
    name: "loosByProximity-findLoosNearby",
    description: "Legacy web client findLoosNearby operation over POST with variables.",
    method: "POST",
    query: FIND_LOOS_NEARBY,
    variables: { lat: SOUTHWARK.lat, lng: SOUTHWARK.lng, radius: 150 },
  },
  {
    name: "loosByProximity-full-shrewsbury",
    description: "Full LooFragment fields, ProximityInput variable, maxDistance 500.",
    method: "POST",
    query: LOOS_NEARBY_FULL,
    variables: { from: { lat: SHREWSBURY.lat, lng: SHREWSBURY.lng, maxDistance: 500 } },
  },
  {
    name: "loosByProximity-default-distance",
    description: "maxDistance omitted (defaults to 1000).",
    method: "POST",
    query: "query($lat: Float!, $lng: Float!) { loosByProximity(from: { lat: $lat, lng: $lng }) { id } }",
    variables: { lat: SHREWSBURY.lat, lng: SHREWSBURY.lng },
  },

  // ---- looNamesByIds -------------------------------------------------------------------
  {
    name: "looNamesByIds",
    description: "Known ids (out of order) plus one unknown id.",
    method: "POST",
    query: LOO_NAMES_BY_IDS,
    variables: { idList: [LOO_SHREWSBURY, UNKNOWN_ID, LOO_24H, LOO_NO_NAME] },
  },

  // ---- geohash -----------------------------------------------------------------------
  {
    name: "loosByGeohash-shrewsbury",
    description: "Compressed loos (id|geohash9|filterMask), precision-6 cell, active default.",
    method: "POST",
    query: LOOS_BY_GEOHASH,
    variables: { geohash: GEOHASH_SHREWSBURY },
  },
  {
    name: "loosByGeohash-london-removed",
    description: "Compressed loos with active: false.",
    method: "POST",
    query: LOOS_BY_GEOHASH,
    variables: { geohash: GEOHASH_LONDON, active: false },
  },
  {
    name: "loosByGeohash-unknown-cell",
    description: "A cell with no loos -> empty list.",
    method: "POST",
    query: LOOS_BY_GEOHASH,
    variables: { geohash: "zzzzzz" },
  },
  {
    name: "fullLoosByGeohash-shrewsbury",
    description: "Full compressed loos (id|geohash9|combinedMask|base64urlMeta), precision-6 cell.",
    method: "POST",
    query: FULL_LOOS_BY_GEOHASH,
    variables: { geohash: GEOHASH_SHREWSBURY },
  },
  {
    name: "fullLoosByGeohash-london",
    description: "Full compressed loos incl. 24h hours, null hours, '£' in meta.",
    method: "POST",
    query: FULL_LOOS_BY_GEOHASH,
    variables: { geohash: GEOHASH_LONDON },
  },
  {
    name: "fullLoosByGeohash-london-removed",
    description: "Full compressed loos with active: false.",
    method: "POST",
    query: FULL_LOOS_BY_GEOHASH,
    variables: { geohash: GEOHASH_LONDON, active: false },
  },

  // ---- reportsForLoo -----------------------------------------------------------------
  {
    name: "reportsForLoo-24h",
    description: "Report history (legacy LooReportFragment) for the 24h loo.",
    method: "POST",
    query: REPORT_HISTORY,
    variables: { id: LOO_24H },
  },
  {
    name: "reportsForLoo-shrewsbury",
    description: "Report history (legacy LooReportFragment) for Butcher Row.",
    method: "POST",
    query: REPORT_HISTORY,
    variables: { id: LOO_SHREWSBURY },
  },
  {
    name: "reportsForLoo-nested",
    description: "previous / loo / area on Report (no resolvers in legacy: always null).",
    method: "POST",
    query: REPORT_HISTORY_NESTED,
    variables: { id: LOO_NULL_HOURS },
  },
  {
    name: "reportsForLoo-unknown-id",
    description: "Report history for an unknown id.",
    method: "POST",
    query: REPORT_HISTORY,
    variables: { id: UNKNOWN_ID },
  },

  // ---- error formats -----------------------------------------------------------------
  {
    name: "error-syntax",
    description: "Syntax error.",
    method: "POST",
    query: "{ loo(id: ",
  },
  {
    name: "error-unknown-field",
    description: "Validation error: unknown field.",
    method: "POST",
    query: "{ statistics { total nope } }",
  },
  {
    name: "error-missing-required-arg",
    description: "Validation error: missing required argument.",
    method: "POST",
    query: "{ loosByGeohash }",
  },
  {
    name: "error-unknown-field-graphql-response-accept",
    description:
      "Validation error with Accept: application/graphql-response+json (status code differs per spec).",
    method: "POST",
    query: "{ statistics { total nope } }",
    headers: { accept: "application/graphql-response+json, application/json;q=0.9" },
  },
  {
    name: "error-get-unknown-field",
    description: "Validation error over GET.",
    method: "GET",
    path: "/api",
    query: "{ statistics { total nope } }",
  },
];

// ------------------------------------------------------------------------------------

const assertReadOnly = (query) => {
  if (!query) return;
  // Strip strings and comments before looking for operation keywords.
  const stripped = query
    .replace(/"""[\s\S]*?"""/g, "")
    .replace(/"(?:\\.|[^"\\])*"/g, "")
    .replace(/#[^\n]*/g, "");
  if (/(^|[^\w$])(mutation|subscription)\b/.test(stripped)) {
    throw new Error(`Refusing to send a non-query operation:\n${query}`);
  }
};

let requestCount = 0;
let lastRequestAt = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Dart's Uri.parse percent-encodes spaces/braces in the query but keeps : , ( ) etc. */
const dartStyleEncode = (value) => encodeURI(value).replace(/[#&+=?]/g, encodeURIComponent);

async function rateLimitedFetch(url, init) {
  if (requestCount >= MAX_REQUESTS) {
    throw new Error(`Request budget of ${MAX_REQUESTS} exhausted`);
  }
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  requestCount += 1;
  return fetch(url, { ...init, redirect: "manual" });
}

const pickHeaders = (headers) => {
  const out = {};
  for (const name of HEADER_SUBSET) {
    const value = headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
};

async function send(testCase, ctx) {
  const variables =
    typeof testCase.variables === "function" ? testCase.variables(ctx) : testCase.variables;
  assertReadOnly(testCase.query);
  const method = testCase.method;
  const requestHeaders = { "user-agent": USER_AGENT, ...(testCase.headers ?? {}) };
  let url = `${ORIGIN}${testCase.path ?? "/api"}`;
  let body;

  if (method === "GET" && testCase.query !== undefined) {
    const params = [`query=${dartStyleEncode(testCase.query)}`];
    if (variables !== undefined)
      params.push(`variables=${encodeURIComponent(JSON.stringify(variables))}`);
    if (testCase.operationName)
      params.push(`operationName=${encodeURIComponent(testCase.operationName)}`);
    url += `?${params.join("&")}`;
  } else if (method === "POST") {
    requestHeaders["content-type"] = "application/json";
    body = JSON.stringify({
      query: testCase.query,
      ...(variables !== undefined ? { variables } : {}),
      ...(testCase.operationName ? { operationName: testCase.operationName } : {}),
    });
  }

  if (DRY_RUN) {
    console.log(`[dry-run] ${method} ${url}`);
    return null;
  }

  const hops = [];
  let res = await rateLimitedFetch(url, { method, headers: requestHeaders, body });
  // Follow redirects by hand (GET only) so we can record them.
  for (let i = 0; i < 2 && res.status >= 300 && res.status < 400; i++) {
    const location = res.headers.get("location");
    hops.push({ url, status: res.status, headers: pickHeaders(res.headers) });
    if (!location || method !== "GET") break;
    url = new URL(location, url).toString();
    res = await rateLimitedFetch(url, { method, headers: requestHeaders });
  }

  const headers = pickHeaders(res.headers);
  const text = await res.text();
  let responseBody;
  try {
    responseBody = JSON.parse(text);
  } catch {
    responseBody = { _nonJsonText: text.length > 2000 ? `${text.slice(0, 2000)}…` : text };
    if (text.length > 2000) responseBody._nonJsonLength = text.length;
  }

  const trimmed = testCase.trim ? testCase.trim(responseBody) : [];

  return {
    name: testCase.name,
    description: testCase.description,
    capturedAt: new Date().toISOString(),
    method,
    url: url.replace(ORIGIN, ""),
    requestHeaders,
    query: testCase.query ?? null,
    variables: variables ?? null,
    operationName: testCase.operationName ?? null,
    ...(hops.length ? { redirects: hops.map((h) => ({ ...h, url: h.url.replace(ORIGIN, "") })) } : {}),
    status: res.status,
    headers,
    body: responseBody,
    ...(trimmed.length ? { trimmed } : {}),
  };
}

// Collect every toilet id that appears in a fixture body.
const HEX_ID = /^[0-9a-f]{24}$/;
function collectLooIds(fixture, ids) {
  const visit = (value, key) => {
    if (typeof value === "string") {
      if (key === "id" && HEX_ID.test(value)) ids.add(value);
      const first = value.split("|")[0];
      if (value.includes("|") && HEX_ID.test(first)) ids.add(first);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) visit(v, k);
    }
  };
  if (fixture?.name?.startsWith("reportsForLoo")) return; // report ids are audit ids
  visit(fixture?.body?.data);
}

async function main() {
  const ctx = { areaName: undefined };
  const ids = new Set();
  const appearsIn = {};
  const selected = ONLY.length ? CASES.filter((c) => ONLY.includes(c.name)) : CASES;

  for (const testCase of selected) {
    const fixture = await send(testCase, ctx);
    if (!fixture) continue;
    fs.writeFileSync(
      path.join(HERE, `${testCase.name}.json`),
      `${JSON.stringify(fixture, null, 2)}\n`,
    );
    if (testCase.name === "loo-24h") ctx.areaName = fixture.body?.data?.loo?.area?.[0]?.name;
    const seen = new Set();
    collectLooIds(fixture, seen);
    for (const id of seen) {
      ids.add(id);
      appearsIn[id] ??= [];
      appearsIn[id].push(testCase.name);
    }
    console.log(`${requestCount.toString().padStart(2)} ${fixture.status} ${testCase.name}`);
  }

  if (DRY_RUN || ONLY.length) return;

  // Full records of every toilet seen, via aliased loo(id) lookups (50 per request).
  const all = [...ids].sort();
  const records = {};
  for (let i = 0; i < all.length; i += 50) {
    const chunk = all.slice(i, i + 50);
    const query = `query seedRecords {\n${chunk
      .map((id, n) => `  l${n}: loo(id: "${id}") { ...LooFragment }`)
      .join("\n")}\n}\n${LOO_FRAGMENT}`;
    const fixture = await send({ name: "seed", method: "POST", query }, ctx);
    for (let n = 0; n < chunk.length; n++) {
      records[chunk[n]] = fixture.body?.data?.[`l${n}`] ?? null;
    }
  }
  const seed = {
    description:
      "Full legacy Loo records (LooFragment, as returned by the live legacy API) for every toilet id that appears in these fixtures, for seeding an equivalent local test DB. appearsIn lists the fixture files that reference each id.",
    capturedAt: new Date().toISOString(),
    count: all.length,
    toilets: all.map((id) => ({ ...records[id], appearsIn: appearsIn[id] ?? [] })),
  };
  fs.writeFileSync(path.join(HERE, "seed-toilets.json"), `${JSON.stringify(seed, null, 2)}\n`);
  console.log(`Done: ${requestCount} requests, ${all.length} seed toilets.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
