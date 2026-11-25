# Legacy GraphQL golden fixtures

Golden responses from the **live legacy GraphQL API** (`https://www.toiletmap.org.uk/api`,
Next.js + graphql-yoga 3 + graphql-js 16 + graphql-iso-date 3.6), used as the contract for the
Phase 6.2 read-only GraphQL compatibility endpoint.

## How they were captured

- **Date:** 2026-11-18 (00:30 to 00:38 GMT), with the owner's approval.
- **Read-only:** only GraphQL `query` operations, plus one CORS preflight `OPTIONS`. No mutation
  was ever sent. `capture.mjs` refuses any document that contains a `mutation` or `subscription`
  operation before it makes a request.
- **Rate-limited:** no more than 1 request per second (1.1 s between request starts), and 55
  requests in total for the whole capture. That total covers two discovery probes (they found the
  geohash cells and the 24h, null-hours and removed loos used here), the main run of 48 cases, a one-case follow-up
  (`get-flutter-loosByProximity-removed-25m`), three `/api/` → `/api` redirect hops and one aliased
  "seed" lookup.
- **Headers sent:** `User-Agent: toiletmap-next-compat-fixtures`, `Content-Type: application/json`
  on POST, plus `Origin` or `Accept` where a case tests them. No email, cookie, token or other
  personal data was sent. Node's `fetch` adds `Accept: */*`. The Flutter app's Dart `http` client
  sends no `Accept` header, which yoga treats the same way.

## Re-capturing

```sh
node apps/toiletmap-server/test/fixtures/legacy-graphql/capture.mjs --dry-run   # list requests only
node apps/toiletmap-server/test/fixtures/legacy-graphql/capture.mjs             # full run (~53 requests, ~1 min)
node apps/toiletmap-server/test/fixtures/legacy-graphql/capture.mjs --only=loo-24h,areas
```

Environment variables: `LEGACY_GRAPHQL_ORIGIN` (default `https://www.toiletmap.org.uk`),
`MAX_REQUESTS` (default 55, a hard cap per run) and `MIN_INTERVAL_MS` (default 1100, floor 1000).
A run with `--only` skips the seed lookup and leaves `seed-toilets.json` alone.

The fixed inputs (ids, geohash cells, coordinates) are constants at the top of `capture.mjs`. They
point at real toilets. If one of them is edited or removed on the live site, choose a replacement
and say so here.

## File format

Each `<case>.json` is one request/response pair:

```jsonc
{
  "name": "loo-24h",
  "description": "…",
  "capturedAt": "2026-11-18T00:4x:xx.xxxZ",
  "method": "POST" | "GET" | "OPTIONS",
  "url": "/api?query=…",            // final URL after redirects (origin stripped)
  "requestHeaders": { … },
  "query": "…", "variables": { … } | null, "operationName": "…" | null,
  "redirects": [ { "url", "status", "headers" } ],   // only when a 3xx was followed
  "status": 200,
  "headers": { … },                 // subset: content-type, cache-control, vary, location,
                                    // access-control-*, x-vercel-cache, allow
  "body": { "data": …, "errors": … },  // non-JSON bodies are stored as { "_nonJsonText": "…" }
  "trimmed": [ { "path", "originalLength", "kept" } ]  // only when a list was cut
}
```

`seed-toilets.json` holds the full legacy `Loo` record (the `LooFragment` fields, as the legacy API
returns them) for **every toilet id that appears in any fixture**: 46 toilets, 10 of them removed.
Each record lists the fixtures it appears in under `appearsIn`. Use it to seed equivalent rows in
the local test DB. The legacy API never exposes `contributors`, so seed rows need an invented
contributor value. A system location report needs its last contributor to be the one before it
plus `-location`, as legacy `setLooLocation` writes it (see the reports notes below).

## Trimming and volatility

- `statistics.areaToiletCount` and `areas` were cut to their first 10 entries. Both lists had 382
  entries; `trimmed` records this. Contract tests should check shape and types, not the counts.
- Geohash cases use precision-6 cells: `gcq5c7` (Shrewsbury, 6 active loos) and `gcpvjb` (Borough,
  London: 5 active and 7 removed). Proximity cases use small radii, except the exact Flutter
  default of 2000 m in Shrewsbury, which returns 11 loos.
- `introspection.json` is kept in full (about 105 KB). It is the schema contract.
- These are **live data**: `loos-default` (newest first), `statistics` and `verifiedAt` values
  will drift. List order for `loosByProximity`, `looNamesByIds`, `areas`, `statistics` and the
  geohash queries is whatever Postgres returned, because the legacy code has no `ORDER BY`.
  Compare those lists as sets, or sort them first.
- `areaName` for `loos-area-nopayment-oldest-page2` and `loos-inactive-area` comes from the
  `loo-24h` response ("City of London").

## Observed contract (summary)

These points were checked against the fixtures, and every compressed string was reproduced byte
for byte from `seed-toilets.json`.

- **Transport:** `GET /api/?query=…` (the Flutter app) gets a `308` with `Location: /api?query=…`
  (`content-type: text/plain`). The client follows it and receives the `200` from `/api`.
  Success, field errors and validation errors all return `200` with
  `content-type: application/json; charset=utf-8`. Variable coercion errors return `400`.
  With `Accept: application/graphql-response+json`, validation errors return `400` with that
  content type. A bare GET returns `200 {"errors":[{"message":"Must provide query string."}]}`
  with `Allow: GET, POST`.
- **Caching:** every response has `cache-control: public, max-age=0, must-revalidate` and
  `vary: Origin`. `@cacheControl` has no effect.
- **CORS:** GET and POST reflect **any** `Origin` (including `https://example.com`) with
  `access-control-allow-credentials: true`. yoga's default CORS overrides the `cors` allow-list.
  The preflight is answered by the `cors` middleware: `204`, the allow-listed origin reflected,
  `access-control-allow-methods: GET,HEAD,POST`, request headers echoed,
  `vary: Origin, Access-Control-Request-Headers` and no credentials header.
- **Errors:** syntax and validation errors keep graphql-js messages. Every resolver or scalar
  exception is masked to `"Unexpected error."` with `locations` and `path`. Examples are an
  unknown id, `loo` with no id, pagination limit > 100 or < 0, and page 0. A non-null field that
  fails nulls its parent, so `loos` errors give `"data": null`.
- **DateTime:** `Loo` timestamps are `Date.toISOString()` (always 3 fraction digits, then `Z`).
  `Report.createdAt` and `Report.verifiedAt` come from audit JSON strings, normalised by
  graphql-iso-date to UTC `Z`. They keep the original fraction digits, so Postgres trailing zeros
  are already trimmed, as in `2016-09-14T21:06:08.63Z`.
- **OpeningTimes:** `null` (unknown hours), or 7 entries, each `[]` (closed) or `["HH:MM","HH:MM"]`.
  24h is `["00:00","00:00"]`.
- **Compressed geohash strings:** `loosByGeohash` returns `id|geohash9|filterMask`.
  `fullLoosByGeohash` returns `id|geohash9|(filterMask | detailMask << 6)|meta` (decimal).
  `geohash9` is recomputed from `location` (not the stored 20-character `geohash` column).
  - `filterMask` bits: noPayment 1, allGender 2, automatic 4, accessible 8, babyChange 16,
    radar 32.
  - `detailMask` uses 2 bits each, encoded true=1, false=2, null=0: women at bit 0, men at bit 2,
    children at bit 4, urinalOnly at bit 6.
  - `meta` is base64url (no padding) of the UTF-8 encoding of `JSON.stringify` of
    `{n,p,t,o}`, keys in that order, each included only when truthy, except `o`, which is
    included whenever openingTimes is an array. `o` joins the 7 days with `.`: `HHMMHHMM` for an
    open day, empty for a closed day.
  - When there is no meta, the segment is empty and the string ends in `|`.
- **Reports:** `reportsForLoo` returns every `record_version` row for the id, including system
  location rows, where `isSystemReport` is true when the record's last contributor ends with
  `-location`. The compatibility endpoint narrows this to the exact row legacy `setLooLocation`
  writes (the last contributor is the one before it plus `-location`), so an ordinary handle that
  ends in `-location` is not hidden. Rows are sorted by `createdAt` ascending, and a user report comes before a system
  report with the same timestamp. `contributor` is always `"Anonymous"`. `previous`, `loo` and
  `area` are always `null`. Report ids are numeric strings.
- **Loo quirks:** `reports` is always `[]`. `area` is `[{name,type}]` (`[null]` when there is no
  area). `loosByProximity` returns removed loos, has no ORDER BY, defaults `maxDistance` to 1000
  and inner-joins areas. `looNamesByIds` drops unknown ids. `loos` with `active: null` matches
  nothing, and `contributors` is ignored.

## Deliberate deviations in the compatibility endpoint

The compatibility endpoint differs from what these fixtures show in a few deliberate ways, none of
which any fixture exercises. The full list is in the server README ("Legacy GraphQL compatibility
endpoint"). The ones that change response bodies:

- `openingTimes` with a `24:00` closing time (stored by the current API) is sent with `00:00`
  instead, in `Loo`, `Report` and the `o` meta of `fullLoosByGeohash`. Legacy failed the field for
  such rows (`null` plus an error) and encoded `2400` in `o`.
- A stored `openingTimes` value that fails the current schema is `null` (no error), and
  `fullLoosByGeohash` omits `o` for it. Legacy returned `null` plus an error and encoded any array.
- Hardened arguments (`looNamesByIds` without a list or with over 100 ids, `maxDistance` over
  50,000 m, an empty or second short geohash prefix, the query limits) return an error with
  `data: null` where legacy returned data.
- `loosByProximity` drops loos whose area has a null name and type; `statistics` lists one entry
  per area id rather than per area name.

`geohash9` in the compressed strings follows legacy exactly: it is encoded from the 9-decimal
GeoJSON `location`, like `ngeohash.encode(lat, lng, 9)`. Truncating the stored geohash instead
gives a different 9th character for points within about 1e-9 degrees of a cell edge (583 of the
15,688 toilets in the 2025-11-04 export). The fixture toilets include none of those, so the
boundary case is covered by `test/unit/legacy-graphql-mappers.test.ts` and
`legacy-graphql.http.spec.ts` instead.

## Where these are used

- `test/integration/legacy-graphql.contract.spec.ts` seeds `seed-toilets.json` (plus audit rows rebuilt
  from the `reportsForLoo-*` fixtures) into the local test DB and replays every fixture against
  `/api/graphql`. Its header comment lists exactly what is normalised before comparing.
- `test/unit/legacy-graphql-mappers.test.ts` rebuilds every compressed geohash string from the seed
  records byte for byte.
- `test/integration/legacy-graphql.http.spec.ts` checks the introspection fixture, allowing exactly the
  removed mutation types and the `@auth` directive, plus the preflight fixture. It also covers what
  the fixtures cannot: `reportsForLoo` for a loo created and edited through the REST API (so the
  rows come from the current write path, not rebuilt from fixtures), and `geohash9` for a toilet on
  a cell edge.

After a re-capture, run those specs. A changed fixture means the live legacy API changed (or the data
did): decide whether the compatibility endpoint should follow before updating the expectations.
