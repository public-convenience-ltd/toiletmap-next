// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatasetBucket } from "../test/r2-fake";
import {
  DOWNLOADS_UNAVAILABLE_TEXT,
  formatMegabytes,
  readDatasetManifest,
  serveDatasetFile,
} from "./dataset";

const NOW = new Date("2026-11-18T09:00:00.000Z");
const CSV = '"id","name"\n"aaa","Loo"';

let bucket: FakeDatasetBucket;

const serve = (path: string, init: RequestInit = {}, { unbound = false } = {}) =>
  serveDatasetFile({
    request: new Request(`https://www.toiletmap.org.uk/dataset/${path}`, init),
    bucket: unbound ? undefined : bucket,
    path,
    now: NOW,
  });

beforeEach(() => {
  bucket = new FakeDatasetBucket();
  bucket.put("latest/toilets.csv", CSV, {
    contentType: "text/csv; charset=utf-8",
    customMetadata: { date: "2026-11-18" },
  });
  bucket.put("latest/toilets.json", "[]", { contentType: "application/json; charset=utf-8" });
  bucket.put("latest/manifest.json", "{}", { contentType: "application/json; charset=utf-8" });
  bucket.put("archive/2026-11-17/toilets.json", "[]", {
    contentType: "application/json; charset=utf-8",
  });
  bucket.put("archive/2026-11-18/toilets.csv", CSV, { contentType: "text/csv; charset=utf-8" });
  bucket.put("_state/run.json", '{"startedAt":"x"}');
});

describe("serveDatasetFile", () => {
  it("serves the latest CSV as a dated download with validators and a short cache", async () => {
    const res = await serve("latest/toilets.csv");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(CSV);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="toilets-2026-11-18.csv"',
    );
    expect(res.headers.get("etag")).toBe('"etag-1"');
    expect(res.headers.get("last-modified")).toBe("Wed, 18 Nov 2026 00:17:05 GMT");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("caches past archive days for a year, immutable, and today's for an hour", async () => {
    const past = await serve("archive/2026-11-17/toilets.json");
    expect(past.status).toBe(200);
    expect(past.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(past.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(past.headers.get("content-disposition")).toBe(
      'attachment; filename="toilets-2026-11-17.json"',
    );

    const today = await serve("archive/2026-11-18/toilets.csv");
    expect(today.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("serves the manifest inline", async () => {
    const res = await serve("latest/manifest.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  it("answers 304 to a matching If-None-Match or If-Modified-Since", async () => {
    const byEtag = await serve("latest/toilets.csv", { headers: { "If-None-Match": '"etag-1"' } });
    expect(byEtag.status).toBe(304);
    expect(byEtag.body).toBeNull();
    expect(byEtag.headers.get("etag")).toBe('"etag-1"');
    expect(byEtag.headers.get("cache-control")).toBe("public, max-age=300");

    const byDate = await serve("latest/toilets.csv", {
      headers: { "If-Modified-Since": "Wed, 18 Nov 2026 00:17:05 GMT" },
    });
    expect(byDate.status).toBe(304);

    const stale = await serve("latest/toilets.csv", { headers: { "If-None-Match": '"old"' } });
    expect(stale.status).toBe(200);
  });

  it("answers 412, not 304, when If-Match or If-Unmodified-Since fails", async () => {
    const changed = await serve("latest/toilets.csv", { headers: { "If-Match": '"old-etag"' } });
    expect(changed.status).toBe(412);
    expect(changed.headers.get("etag")).toBe('"etag-1"');

    const weak = await serve("latest/toilets.csv", { headers: { "If-Match": 'W/"etag-1"' } });
    expect(weak.status).toBe(412);

    const newer = await serve("latest/toilets.csv", {
      headers: { "If-Unmodified-Since": "Wed, 18 Nov 2026 00:00:00 GMT" },
    });
    expect(newer.status).toBe(412);

    const head = await serve("latest/toilets.csv", {
      method: "HEAD",
      headers: { "If-Match": '"old-etag"' },
    });
    expect(head.status).toBe(412);
  });

  it("serves the file when If-Match or If-Unmodified-Since holds", async () => {
    const same = await serve("latest/toilets.csv", { headers: { "If-Match": '"etag-1"' } });
    expect(same.status).toBe(200);
    expect(await same.text()).toBe(CSV);

    const any = await serve("latest/toilets.csv", { headers: { "If-Match": "*" } });
    expect(any.status).toBe(200);

    const unchanged = await serve("latest/toilets.csv", {
      headers: { "If-Unmodified-Since": "Wed, 18 Nov 2026 00:17:05 GMT" },
    });
    expect(unchanged.status).toBe(200);

    // With If-Match holding, If-None-Match still applies.
    const both = await serve("latest/toilets.csv", {
      headers: { "If-Match": '"etag-1"', "If-None-Match": '"etag-1"' },
    });
    expect(both.status).toBe(304);
  });

  it("answers a single Range with 206 and Content-Range", async () => {
    const bytes = new TextEncoder().encode(CSV);
    const res = await serve("latest/toilets.csv", { headers: { Range: "bytes=5-9" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 5-9/${bytes.byteLength}`);
    expect(res.headers.get("content-length")).toBe("5");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="toilets-2026-11-18.csv"',
    );
    expect(await res.text()).toBe(new TextDecoder().decode(bytes.slice(5, 10)));

    const tail = await serve("latest/toilets.csv", { headers: { Range: "bytes=-3" } });
    expect(tail.status).toBe(206);
    expect(tail.headers.get("content-range")).toBe(
      `bytes ${bytes.byteLength - 3}-${bytes.byteLength - 1}/${bytes.byteLength}`,
    );
    expect(await tail.text()).toBe(CSV.slice(-3));
  });

  it("resumes only while If-Range still matches, and sends the whole file otherwise", async () => {
    const resumed = await serve("latest/toilets.csv", {
      headers: { Range: "bytes=5-", "If-Range": '"etag-1"' },
    });
    expect(resumed.status).toBe(206);

    const byDate = await serve("latest/toilets.csv", {
      headers: { Range: "bytes=5-", "If-Range": "Wed, 18 Nov 2026 00:17:05 GMT" },
    });
    expect(byDate.status).toBe(206);

    const replaced = await serve("latest/toilets.csv", {
      headers: { Range: "bytes=5-", "If-Range": '"etag-0"' },
    });
    expect(replaced.status).toBe(200);
    expect(replaced.headers.get("content-range")).toBeNull();
    expect(await replaced.text()).toBe(CSV);
  });

  it("sends the whole file for a range it cannot serve, or when the ranged read fails", async () => {
    for (const range of ["bytes=500-600", "bytes=0-1,4-5", "items=0-1", "bytes=0-"]) {
      const res = await serve("latest/toilets.csv", { headers: { Range: range } });
      expect(res.status, range).toBe(200);
      expect(await res.text()).toBe(CSV);
    }
    bucket.failNextGet = true;
    const retried = await serve("latest/toilets.csv", { headers: { Range: "bytes=1-2" } });
    expect(retried.status).toBe(200);
    expect(await retried.text()).toBe(CSV);
  });

  it("checks If-None-Match before Range", async () => {
    const res = await serve("latest/toilets.csv", {
      headers: { Range: "bytes=1-2", "If-None-Match": '"etag-1"' },
    });
    expect(res.status).toBe(304);
  });

  it("answers HEAD with the headers and length but no body", async () => {
    const res = await serve("latest/toilets.csv", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(new TextEncoder().encode(CSV).length));
    expect(res.body).toBeNull();
    expect(bucket.gets).toEqual([]);

    const notModified = await serve("latest/toilets.csv", {
      method: "HEAD",
      headers: { "If-None-Match": '"etag-1"' },
    });
    expect(notModified.status).toBe(304);
  });

  it("404s unknown keys without reading the bucket, and missing objects", async () => {
    for (const path of [
      "_state/run.json",
      "latest/other.json",
      "latest/../_state/run.json",
      "archive/2026-11-18/",
      "archive/latest/toilets.csv",
      "archive/2026-11-18/extra/toilets.csv",
      "",
    ]) {
      const res = await serve(path);
      expect(res.status, path).toBe(404);
    }
    expect(bucket.gets).toEqual([]);

    const missing = await serve("archive/2020-01-01/toilets.csv");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses other methods", async () => {
    const res = await serve("latest/toilets.csv", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });

  it("explains that downloads are live-site only when the bucket is not bound", async () => {
    const res = await serve("latest/toilets.csv", {}, { unbound: true });
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(DOWNLOADS_UNAVAILABLE_TEXT);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("readDatasetManifest", () => {
  const manifest = {
    schemaVersion: 1,
    generatedAt: "2026-11-18T00:17:00.000Z",
    date: "2026-11-18",
    rowCount: 3,
    licence: "CC-BY-4.0",
    files: [
      {
        name: "toilets.json",
        format: "json",
        key: "latest/toilets.json",
        archiveKey: "archive/2026-11-18/toilets.json",
        contentType: "application/json; charset=utf-8",
        size: 1_234_567,
        sha256: "ab".repeat(32),
      },
    ],
    archives: ["2026-11-18", "not-a-date", "2026-11-17"],
  };

  it("reads the manifest and drops anything that is not an archive date", async () => {
    bucket.put("latest/manifest.json", JSON.stringify(manifest));
    expect(await readDatasetManifest(bucket)).toMatchObject({
      status: "ok",
      manifest: {
        rowCount: 3,
        files: [{ key: "latest/toilets.json", size: 1_234_567 }],
        archives: ["2026-11-18", "2026-11-17"],
      },
    });
  });

  it("tells no bucket and no manifest apart from a failed or unreadable read", async () => {
    expect(await readDatasetManifest(undefined)).toEqual({ status: "unconfigured" });
    expect(await readDatasetManifest(new FakeDatasetBucket())).toEqual({ status: "missing" });

    bucket.put("latest/manifest.json", "not json");
    expect(await readDatasetManifest(bucket)).toEqual({ status: "error" });
    bucket.put("latest/manifest.json", JSON.stringify({ ...manifest, files: [{ name: 1 }] }));
    expect(await readDatasetManifest(bucket)).toEqual({ status: "error" });

    bucket.put("latest/manifest.json", JSON.stringify(manifest));
    bucket.failNextGet = true;
    expect(await readDatasetManifest(bucket)).toEqual({ status: "error" });
  });
});

describe("formatMegabytes", () => {
  it("matches the legacy page", () => {
    expect(formatMegabytes(7_944_338)).toBe("7.94 MB");
  });
});
