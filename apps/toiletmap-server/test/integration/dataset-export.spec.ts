import { describe, expect, it, vi } from "vitest";
import worker from "../../src/index";
import { DATASET_EXPORT_CRON, type DatasetManifest } from "../../src/services/export";
import { EXPORT_JSON_COLUMNS, type ExportToilet } from "../../src/services/export/format";
import { LooService } from "../../src/services/loo";
import { getPrismaClient } from "./setup";
import { buildTestEnv } from "./utils/env";
import { createFixtureFactory } from "./utils/fixtures";
import { FakeR2Bucket } from "./utils/r2-fake";
import { createCapturingExecutionContext } from "./utils/test-client";

const fixtures = createFixtureFactory();

const controller = (scheduledTime = Date.now()): ScheduledController => ({
  cron: DATASET_EXPORT_CRON,
  scheduledTime,
  noRetry: () => undefined,
});

const PRIVATE_HANDLE = "export-spec-private-handle";
const PRIVATE_REASON = "export-spec private removal reason";

describe("Dataset export", () => {
  describe("LooService.getAllForExport", () => {
    it("returns active loos only, with the legacy columns and no private ones", async () => {
      const prisma = getPrismaClient();
      const active = await fixtures.loos.create({
        contributor: PRIVATE_HANDLE,
        notes: 'Quote " comma , newline\nend',
      });
      const removed = await fixtures.loos.create({
        contributor: PRIVATE_HANDLE,
        active: false,
        removalReason: PRIVATE_REASON,
      });

      const rows = await new LooService(prisma).getAllForExport();
      expect(rows.find((row) => row.id === removed.id)).toBeUndefined();
      const row = rows.find((candidate) => candidate.id === active.id);
      expect(row).toBeDefined();
      // toExportToilet fixes the published order; the query only has to select the same set.
      expect(Object.keys(row ?? {}).sort()).toEqual([...EXPORT_JSON_COLUMNS].sort());
      expect(row?.location).toEqual({
        type: "Point",
        coordinates: [active.location?.lng, active.location?.lat],
      });
      // The area relation carries its id (legacy `areas: { name, id }`).
      for (const candidate of rows) {
        expect(candidate.areas?.id ?? null).toBe(candidate.area_id);
      }
      expect(rows.every((candidate) => candidate.active === true)).toBe(true);
      const ids = rows.map((candidate) => candidate.id);
      expect(ids).toEqual([...ids].sort());
    });

    it("reads in id-ordered pages and returns the same rows as one read", async () => {
      const prisma = getPrismaClient();
      for (let index = 0; index < 5; index += 1) await fixtures.loos.create({});
      const service = new LooService(prisma);
      const all = await service.getAllForExport();
      expect(all.length).toBeGreaterThanOrEqual(5);
      expect(await service.getAllForExport({ batchSize: 2 })).toEqual(all);
    });

    it("asks for each page after the last id it got, and stops on a short page", async () => {
      const ids = ["a1", "a2", "a3", "a4", "a5"];
      const findMany = vi.fn(async (args: { where: { id?: { gt: string } }; take: number }) =>
        ids
          .filter((id) => !args.where.id || id > args.where.id.gt)
          .slice(0, args.take)
          .map((id) => ({ id })),
      );
      const service = new LooService({ toilets: { findMany } } as unknown as ConstructorParameters<
        typeof LooService
      >[0]);
      const rows = await service.getAllForExport({ batchSize: 2 });
      expect(rows.map((row) => row.id)).toEqual(ids);
      expect(findMany.mock.calls.map(([args]) => args.where.id?.gt ?? null)).toEqual([
        null,
        "a2",
        "a4",
      ]);
      for (const [args] of findMany.mock.calls) {
        expect(args).toMatchObject({ where: { active: true }, orderBy: { id: "asc" }, take: 2 });
      }
    });
  });

  describe("scheduled()", () => {
    it("publishes the export to the EXPORTS bucket and hands the run to waitUntil", async () => {
      const active = await fixtures.loos.create({ contributor: PRIVATE_HANDLE });
      await fixtures.loos.create({
        contributor: PRIVATE_HANDLE,
        active: false,
        removalReason: PRIVATE_REASON,
      });
      const bucket = new FakeR2Bucket();
      const { ctx, settle } = createCapturingExecutionContext();
      const waitUntil = vi.spyOn(ctx, "waitUntil");

      await worker.scheduled(controller(), buildTestEnv({ EXPORTS: bucket.asBinding() }), ctx);

      expect(waitUntil).toHaveBeenCalledTimes(1);
      const [settled] = await settle();
      expect(settled?.status).toBe("fulfilled");

      const manifest = JSON.parse(bucket.text("latest/manifest.json") ?? "null") as DatasetManifest;
      expect(manifest.rowCount).toBeGreaterThan(0);
      const json = bucket.text("latest/toilets.json") ?? "";
      const csv = bucket.text("latest/toilets.csv") ?? "";
      const toilets = JSON.parse(json) as ExportToilet[];
      expect(toilets).toHaveLength(manifest.rowCount);
      expect(toilets.some((toilet) => toilet.id === active.id)).toBe(true);
      expect(csv.split("\n")[0]).toBe(
        "id,created_at,accessible,active,attended,automatic,baby_change,men,name,no_payment,notes,payment_details,radar,women,updated_at,urinal_only,all_gender,children,geohash,verified_at,area_id,opening_times,location,areas,longitude,latitude",
      );
      for (const text of [json, csv, bucket.text("latest/manifest.json") ?? ""]) {
        expect(text).not.toContain(PRIVATE_HANDLE);
        expect(text).not.toContain(PRIVATE_REASON);
        expect(text).not.toContain("contributors");
        expect(text).not.toContain("removal_reason");
      }
    });

    it("does nothing, and does not fail, without the EXPORTS binding", async () => {
      const { ctx, settle } = createCapturingExecutionContext();
      await expect(worker.scheduled(controller(), buildTestEnv(), ctx)).resolves.toBeUndefined();
      const [settled] = await settle();
      expect(settled).toMatchObject({
        status: "fulfilled",
        value: { status: "skipped", reason: "not-configured" },
      });
    });

    it("fails the cron run when the export refuses to publish", async () => {
      const bucket = new FakeR2Bucket();
      bucket.seed(
        "latest/manifest.json",
        JSON.stringify({
          schemaVersion: 1,
          generatedAt: "2000-01-01T00:17:00.000Z",
          date: "2000-01-01",
          rowCount: 100_000_000,
          licence: "CC-BY-4.0",
          files: [],
          archives: ["2000-01-01"],
        }),
      );
      const { ctx } = createCapturingExecutionContext();
      await expect(
        worker.scheduled(controller(), buildTestEnv({ EXPORTS: bucket.asBinding() }), ctx),
      ).rejects.toThrow(/refused/);
      expect(bucket.text("latest/toilets.json")).toBeNull();
    });
  });
});
