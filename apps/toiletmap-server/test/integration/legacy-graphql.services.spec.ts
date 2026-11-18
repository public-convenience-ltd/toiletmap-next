/**
 * Service methods added for the legacy GraphQL adapter:
 * `LooService.searchLegacy`, `LooService.getAuditSnapshots` and
 * `getToiletStatistics` (area.service.ts).
 */
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getToiletStatistics } from "../../src/services/area.service";
import { LooService } from "../../src/services/loo";
import { getPrismaClient } from "./setup";
import { createFixtureFactory } from "./utils/fixtures";

const fixtures = createFixtureFactory();
const service = () => new LooService(getPrismaClient());
const token = () => `legacy${randomBytes(4).toString("hex")}`;

describe("LooService.searchLegacy", () => {
  it("matches the name only, case-insensitively", async () => {
    const tag = token();
    const named = await fixtures.loos.create({ name: `Station ${tag.toUpperCase()}` });
    await fixtures.loos.create({ name: "Something else", notes: `mentions ${tag}` });

    const { data, total } = await service().searchLegacy({
      active: true,
      nameContains: tag,
      order: "desc",
      limit: 10,
      offset: 0,
    });
    expect(total).toBe(1);
    expect(data.map((loo) => loo.id)).toEqual([named.id]);
  });

  it("treats null as IS NULL and undefined as no filter", async () => {
    const tag = token();
    const unknown = await fixtures.loos.create({ name: `${tag} unknown` });
    const free = await fixtures.loos.create({ name: `${tag} free`, noPayment: true });

    const search = (noPayment: boolean | null | undefined) =>
      service().searchLegacy({ noPayment, nameContains: tag, order: "asc", limit: 10, offset: 0 });
    expect((await search(null)).data.map((loo) => loo.id)).toEqual([unknown.id]);
    expect((await search(true)).data.map((loo) => loo.id)).toEqual([free.id]);
    expect((await search(undefined)).total).toBe(2);
  });

  it("filters by updated_at bounds and pages in updated_at order", async () => {
    const tag = token();
    const pause = () => new Promise((resolve) => setTimeout(resolve, 5));
    const first = await fixtures.loos.create({ name: `${tag} a` });
    await pause();
    const second = await fixtures.loos.create({ name: `${tag} b` });
    await pause();
    const third = await fixtures.loos.create({ name: `${tag} c` });
    const base = (params: Partial<Parameters<LooService["searchLegacy"]>[0]>) =>
      service().searchLegacy({ nameContains: tag, order: "asc", limit: 10, offset: 0, ...params });

    expect((await base({})).data.map((loo) => loo.id)).toEqual([first.id, second.id, third.id]);
    expect((await base({ order: "desc", limit: 1, offset: 1 })).data.map((loo) => loo.id)).toEqual([
      second.id,
    ]);
    // The API returns milliseconds; the column keeps microseconds.
    const secondMs = Date.parse(second.updatedAt ?? "");
    expect((await base({ updatedFrom: new Date(secondMs) })).data.map((loo) => loo.id)).toEqual([
      second.id,
      third.id,
    ]);
    expect((await base({ updatedTo: new Date(secondMs + 1) })).data.map((loo) => loo.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("matches areaName exactly", async () => {
    const tag = token();
    // Central London: the area trigger assigns Westminster in the local dataset.
    const loo = await fixtures.loos.create({ name: tag, location: { lat: 51.5007, lng: -0.1246 } });
    const areaName = loo.area[0]?.name;
    if (!areaName) throw new Error("expected the area trigger to assign an area");

    const search = (name: string) =>
      service().searchLegacy({
        nameContains: tag,
        areaName: name,
        order: "asc",
        limit: 10,
        offset: 0,
      });
    expect((await search(areaName)).total).toBe(1);
    expect((await search(areaName.slice(0, -1))).total).toBe(0);
  });
});

describe("LooService.getAuditSnapshots", () => {
  it("returns every audit row for the loo, oldest first, with raw JSON timestamps", async () => {
    const loo = await fixtures.loos.create({ name: "Audit snapshot loo" });
    await fixtures.loos.upsert(loo.id, { notes: "second" }, "snapshot-tester");

    const snapshots = await service().getAuditSnapshots(loo.id);
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    for (const snapshot of snapshots) expect(snapshot.id).toMatch(/^\d+$/);
    const records = snapshots.map((snapshot) => snapshot.record as Record<string, unknown>);
    expect(records.every((record) => record.id === loo.id)).toBe(true);
    expect(records.at(-1)?.notes).toBe("second");
    expect(records.at(-1)?.contributors).toContain("snapshot-tester");
    // Postgres JSON, not a Date: the offset form survives.
    expect(String(records[0]?.updated_at)).toMatch(/[+-]\d\d:\d\d$/);
  });

  it("returns nothing for an unknown id", async () => {
    expect(await service().getAuditSnapshots("000000000000000000000000")).toEqual([]);
  });
});

describe("getToiletStatistics", () => {
  const areaId = randomBytes(12).toString("hex");
  const areaName = `Legacy stats area ${areaId}`;
  const looIds: string[] = [];

  afterAll(async () => {
    const prisma = getPrismaClient();
    await prisma.toilets.deleteMany({ where: { id: { in: looIds } } });
    await prisma.areas.deleteMany({ where: { id: areaId } });
  });

  it("counts active and removed loos per area, every area included", async () => {
    const prisma = getPrismaClient();
    // A square of open ocean that no real area covers.
    await prisma.$executeRaw`
      INSERT INTO areas (id, name, type, priority, dataset_id, version, geometry)
      VALUES (${areaId}, ${areaName}, 'test', 1, 1, 1,
        ST_GeogFromText('POLYGON((-150 -40, -149 -40, -149 -39, -150 -39, -150 -40))'))
    `;
    for (const active of [true, true, false]) {
      const loo = await fixtures.loos.create({ active, location: { lat: -39.5, lng: -149.5 } });
      looIds.push(loo.id);
      expect(loo.area[0]?.name).toBe(areaName);
    }

    const stats = await getToiletStatistics(prisma);
    expect(stats.areaToiletCount).toHaveLength(await prisma.areas.count());
    expect(stats.areaToiletCount.find((entry) => entry.name === areaName)).toEqual({
      name: areaName,
      active: 2,
      removed: 1,
    });
    expect(stats.active + stats.removed).toBeLessThanOrEqual(stats.total);
    expect(stats.active).toBeGreaterThanOrEqual(2);
  });
});
