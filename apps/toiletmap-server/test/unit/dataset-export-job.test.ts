import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  type DatasetManifest,
  type ExportOutcome,
  MAX_ROW_COUNT_DROP,
  runDatasetExport,
} from "../../src/services/export";
import type { ExportSourceRecord } from "../../src/services/export/format";
import { FakeR2Bucket } from "../integration/utils/r2-fake";

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const row = (index: number): ExportSourceRecord => ({
  id: index.toString(16).padStart(24, "0"),
  created_at: new Date("2024-01-01T00:00:00.000Z"),
  accessible: true,
  active: true,
  attended: null,
  automatic: null,
  baby_change: null,
  men: null,
  name: `Loo ${index}`,
  no_payment: true,
  notes: index === 1 ? 'Has "quotes", commas\nand a newline' : null,
  payment_details: null,
  radar: null,
  women: null,
  updated_at: new Date("2024-01-02T00:00:00.000Z"),
  urinal_only: null,
  all_gender: null,
  children: null,
  geohash: "gcpvj0duq53",
  verified_at: null,
  area_id: null,
  opening_times: null,
  location: { type: "Point", coordinates: [-0.1, 51.5 + index / 1000] },
  areas: null,
});

const rows = (count: number) => Array.from({ length: count }, (_, index) => row(index + 1));

const at = (iso: string) => () => new Date(iso);

const run = (
  bucket: FakeR2Bucket | undefined,
  options: { count?: number; trigger?: "scheduled" | "admin"; now?: string } = {},
) => {
  const loadRows = vi.fn(async () => rows(options.count ?? 10));
  const outcome = runDatasetExport({
    bucket,
    loadRows,
    trigger: options.trigger ?? "scheduled",
    now: at(options.now ?? "2026-11-18T00:17:00.000Z"),
    logger: silentLogger,
  });
  return { outcome, loadRows };
};

const published = (outcome: ExportOutcome) => {
  if (outcome.status !== "published") throw new Error(`Expected published, got ${outcome.status}`);
  return outcome.manifest;
};

const manifestIn = (bucket: FakeR2Bucket, key = "latest/manifest.json") =>
  JSON.parse(bucket.text(key) ?? "null") as DatasetManifest | null;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const seedManifest = (bucket: FakeR2Bucket, manifest: Partial<DatasetManifest>) =>
  bucket.seed(
    "latest/manifest.json",
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-11-17T00:17:00.000Z",
      date: "2026-11-17",
      rowCount: 10,
      licence: "CC-BY-4.0",
      files: [],
      archives: ["2026-11-17"],
      ...manifest,
    }),
  );

describe("runDatasetExport", () => {
  it("writes the archive copies, then the latest files, and the latest manifest last", async () => {
    const bucket = new FakeR2Bucket();
    published(await run(bucket).outcome);

    const puts = bucket.puts().filter((key) => !key.startsWith("_state/"));
    expect(puts).toHaveLength(6);
    expect(puts.slice(0, 2).sort()).toEqual([
      "archive/2026-11-18/toilets.csv",
      "archive/2026-11-18/toilets.json",
    ]);
    expect(puts[2]).toBe("archive/2026-11-18/manifest.json");
    expect(puts.slice(3, 5).sort()).toEqual(["latest/toilets.csv", "latest/toilets.json"]);
    expect(puts[5]).toBe("latest/manifest.json");
    // The run state is the only write after the manifest.
    expect(bucket.puts().at(-1)).toBe("_state/run.json");
    expect(bucket.ops.some((op) => (op.op as string) === "delete")).toBe(false);
  });

  it("describes each file in the manifest: size, sha256, content type, row count", async () => {
    const bucket = new FakeR2Bucket();
    const manifest = published(await run(bucket, { count: 12 }).outcome);
    expect(manifestIn(bucket)).toEqual(manifest);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-11-18T00:17:00.000Z",
      date: "2026-11-18",
      rowCount: 12,
      licence: "CC-BY-4.0",
      licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
      attribution: "Contains data from the Toilet Map © 2025 – CC BY 4.0",
      source: "https://www.toiletmap.org.uk/dataset",
      archives: ["2026-11-18"],
    });
    expect(manifest.files.map((file) => [file.name, file.contentType])).toEqual([
      ["toilets.json", "application/json; charset=utf-8"],
      ["toilets.csv", "text/csv; charset=utf-8"],
    ]);
    for (const file of manifest.files) {
      const latest = bucket.text(file.key) ?? "";
      expect(file.key).toBe(`latest/${file.name}`);
      expect(file.archiveKey).toBe(`archive/2026-11-18/${file.name}`);
      expect(bucket.text(file.archiveKey)).toBe(latest);
      expect(file.size).toBe(Buffer.byteLength(latest));
      expect(file.sha256).toBe(sha256(latest));
      expect(bucket.objects.get(file.key)?.contentType).toBe(file.contentType);
      expect(bucket.objects.get(file.key)?.customMetadata).toMatchObject({
        date: "2026-11-18",
        rowCount: "12",
        sha256: file.sha256,
      });
    }
    expect(JSON.parse(bucket.text("latest/toilets.json") ?? "[]")).toHaveLength(12);
    expect(bucket.text("archive/2026-11-18/manifest.json")).toBe(
      bucket.text("latest/manifest.json"),
    );
  });

  it("lists earlier archive days in the manifest, newest first", async () => {
    const bucket = new FakeR2Bucket();
    bucket.seed("archive/2026-11-16/toilets.json", "[]");
    bucket.seed("archive/2026-11-17/toilets.json", "[]");
    const manifest = published(await run(bucket).outcome);
    expect(manifest.archives).toEqual(["2026-11-18", "2026-11-17", "2026-11-16"]);
  });

  it("skips without the bucket binding and does not touch the database", async () => {
    const { outcome, loadRows } = run(undefined);
    expect(await outcome).toMatchObject({ status: "skipped", reason: "not-configured" });
    expect(loadRows).not.toHaveBeenCalled();
  });

  it("refuses to publish an empty dataset and leaves the previous files alone", async () => {
    const bucket = new FakeR2Bucket();
    seedManifest(bucket, {});
    const before = bucket.text("latest/manifest.json");
    expect(await run(bucket, { count: 0 }).outcome).toMatchObject({
      status: "refused",
      reason: "empty",
      rowCount: 0,
      previousRowCount: 10,
    });
    expect(bucket.puts().every((key) => key === "_state/run.json")).toBe(true);
    expect(bucket.text("latest/manifest.json")).toBe(before);
  });

  it("refuses a row count drop of more than 20% against the previous manifest", async () => {
    expect(MAX_ROW_COUNT_DROP).toBe(0.2);
    const refusedBucket = new FakeR2Bucket();
    seedManifest(refusedBucket, { rowCount: 100 });
    expect(await run(refusedBucket, { count: 79 }).outcome).toMatchObject({
      status: "refused",
      reason: "row-count-drop",
      rowCount: 79,
      previousRowCount: 100,
    });
    expect(refusedBucket.text("latest/toilets.json")).toBeNull();

    const allowedBucket = new FakeR2Bucket();
    seedManifest(allowedBucket, { rowCount: 100 });
    expect(published(await run(allowedBucket, { count: 80 }).outcome).rowCount).toBe(80);
  });

  it("publishes at most once per UTC day from the cron", async () => {
    const bucket = new FakeR2Bucket();
    published(await run(bucket, { now: "2026-11-18T00:17:00.000Z" }).outcome);
    const { outcome, loadRows } = run(bucket, { now: "2026-11-18T23:59:00.000Z" });
    expect(await outcome).toMatchObject({ status: "skipped", reason: "already-published-today" });
    expect(loadRows).not.toHaveBeenCalled();

    const next = published(await run(bucket, { now: "2026-11-19T00:17:00.000Z" }).outcome);
    expect(next.date).toBe("2026-11-19");
    expect(next.archives).toEqual(["2026-11-19", "2026-11-18"]);
  });

  it("skips the cron while another run is in progress", async () => {
    const bucket = new FakeR2Bucket();
    bucket.seed(
      "_state/run.json",
      JSON.stringify({ startedAt: "2026-11-18T00:15:00.000Z", trigger: "admin" }),
    );
    expect(await run(bucket).outcome).toMatchObject({ status: "skipped", reason: "in-progress" });
  });

  it("refuses an admin run within five minutes of another run starting or finishing", async () => {
    const bucket = new FakeR2Bucket();
    published(await run(bucket, { now: "2026-11-18T10:00:00.000Z", trigger: "admin" }).outcome);

    const soon = run(bucket, { now: "2026-11-18T10:04:00.000Z", trigger: "admin" });
    expect(await soon.outcome).toMatchObject({ status: "skipped", reason: "recent-run" });
    expect(soon.loadRows).not.toHaveBeenCalled();

    // An admin run is allowed on a day already published, once the window has passed.
    const later = published(
      await run(bucket, { now: "2026-11-18T10:06:00.000Z", trigger: "admin" }).outcome,
    );
    expect(later.generatedAt).toBe("2026-11-18T10:06:00.000Z");

    bucket.seed(
      "_state/run.json",
      JSON.stringify({ startedAt: "2026-11-18T11:00:00.000Z", trigger: "scheduled" }),
    );
    expect(
      await run(bucket, { now: "2026-11-18T11:01:00.000Z", trigger: "admin" }).outcome,
    ).toMatchObject({ status: "skipped", reason: "recent-run" });
  });

  it("keeps the previous manifest when a write fails part-way, and deletes nothing", async () => {
    const bucket = new FakeR2Bucket();
    published(await run(bucket, { now: "2026-11-17T00:17:00.000Z" }).outcome);
    const previousManifest = bucket.text("latest/manifest.json");
    const previousArchive = bucket.text("archive/2026-11-17/toilets.csv");

    bucket.failPutFor.add("latest/toilets.csv");
    expect(await run(bucket, { now: "2026-11-18T00:17:00.000Z" }).outcome).toMatchObject({
      status: "failed",
    });
    expect(bucket.text("latest/manifest.json")).toBe(previousManifest);
    expect(bucket.text("archive/2026-11-17/toilets.csv")).toBe(previousArchive);
    expect(JSON.parse(bucket.text("_state/run.json") ?? "{}")).toMatchObject({
      outcome: "failed",
      finishedAt: "2026-11-18T00:17:00.000Z",
    });
  });

  it("reports a database error as failed without writing any data", async () => {
    const bucket = new FakeR2Bucket();
    const outcome = await runDatasetExport({
      bucket,
      loadRows: () => Promise.reject(new Error("connection refused")),
      trigger: "scheduled",
      now: at("2026-11-18T00:17:00.000Z"),
      logger: silentLogger,
    });
    expect(outcome).toEqual({ status: "failed", message: "connection refused" });
    expect(bucket.puts().every((key) => key === "_state/run.json")).toBe(true);
  });
});
