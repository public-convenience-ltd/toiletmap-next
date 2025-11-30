import { describe, expect, it } from "vitest";
import { getTestContext } from "./setup";
import { createFixtureFactory } from "./utils/fixtures";
import { callApi } from "./utils/test-client";

const fixtures = createFixtureFactory();
const adminHeaders = () => {
  const { issueToken } = getTestContext();
  return {
    Authorization: `Bearer ${issueToken({
      permissions: ["access:admin"],
    })}`,
  };
};

const authHeaders = () => {
  const { issueToken } = getTestContext();
  return {
    Authorization: `Bearer ${issueToken()}`,
  };
};

describe("Loo read endpoints", () => {
  describe("GET /api/loos/:id", () => {
    it("returns a persisted loo with area metadata", async () => {
      const { prisma } = getTestContext();
      const existingArea = await prisma.areas.findFirst();
      const loo = await fixtures.loos.create({
        areaId: existingArea?.id ?? undefined,
        location: { lat: 51.501, lng: -0.124 },
      });

      const response = await callApi(`/api/loos/${loo.id}`, { headers: authHeaders() });
      if (response.status !== 200) {
        console.log("DEBUG ERROR BODY:", await response.text());
      }
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe(loo.id);
      if (existingArea) {
        expect(Array.isArray(body.area)).toBe(true);
        expect(body.area.length).toBeGreaterThan(0);
      } else {
        expect(body.area).toEqual([]);
      }
      expect(body.location).toMatchObject({
        lat: expect.any(Number),
        lng: expect.any(Number),
      });
    });

    it("returns 404 when a loo is missing", async () => {
      const response = await callApi("/api/loos/ffffffffffffffffffffffff", {
        headers: authHeaders(),
      });
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.message).toMatch(/not found/i);
    });

    it("allows unauthenticated requests", async () => {
      const loo = await fixtures.loos.create();
      const response = await callApi(`/api/loos/${loo.id}`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe(loo.id);
    });
  });

  describe("GET /api/loos (ids)", () => {
    it("returns loos matching provided ids and preserves order", async () => {
      const first = await fixtures.loos.create();
      const second = await fixtures.loos.create();

      const response = await callApi(`/api/loos?ids=${first.id}&ids=${second.id}`, {
        headers: authHeaders(),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.count).toBe(2);
      expect(body.data.map((item: { id: string }) => item.id)).toEqual([first.id, second.id]);
    });

    it("rejects requests without ids", async () => {
      const response = await callApi("/api/loos", { headers: authHeaders() });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.message).toBe("Invalid ids query parameter");
      expect(body.issues).toBeDefined();
    });
  });

  describe("GET /api/loos/:id/reports", () => {
    it("returns audit history summaries and hydrated reports with contributor details redacted", async () => {
      const loo = await fixtures.loos.create({ notes: "Original notes" });
      await fixtures.loos.upsert(loo.id, { notes: "Updated notes", radar: true }, "reports-test");

      const summaryResponse = await callApi(`/api/loos/${loo.id}/reports`, {
        headers: authHeaders(),
      });
      expect(summaryResponse.status).toBe(200);
      const summary = await summaryResponse.json();
      expect(summary.count).toBeGreaterThan(0);
      expect(summary.data[0]).toMatchObject({
        id: expect.any(String),
      });
      expect(summary.data[0].contributor).toBeNull();
      expect(summary.data[0]).not.toHaveProperty("notes");

      const hydratedResponse = await callApi(`/api/loos/${loo.id}/reports?hydrate=true`, {
        headers: authHeaders(),
      });
      expect(hydratedResponse.status).toBe(200);
      const hydrated = await hydratedResponse.json();
      expect(hydrated.data[0]).toHaveProperty("notes");
      expect(hydrated.data[0].contributor).toBeNull();
    });

    it("returns contributor details when the caller has the admin role", async () => {
      const loo = await fixtures.loos.create({ notes: "Original notes" });
      await fixtures.loos.upsert(loo.id, { notes: "Updated notes", radar: true }, "reports-test");

      const summaryResponse = await callApi(`/api/loos/${loo.id}/reports`, {
        headers: adminHeaders(),
      });
      expect(summaryResponse.status).toBe(200);
      const summary = await summaryResponse.json();
      const latestSummary = summary.data[summary.data.length - 1];
      expect(latestSummary.contributor).toBe("reports-test");

      const hydratedResponse = await callApi(`/api/loos/${loo.id}/reports?hydrate=true`, {
        headers: adminHeaders(),
      });
      expect(hydratedResponse.status).toBe(200);
      const hydrated = await hydratedResponse.json();
      const latestHydrated = hydrated.data[hydrated.data.length - 1];
      expect(latestHydrated.contributor).toBe("reports-test");
    });

    it("returns reports in chronological ascending order with correct timestamps", async () => {
      // Create initial loo
      const loo = await fixtures.loos.create({
        notes: "First version",
        accessible: true,
      });

      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Make first update
      await fixtures.loos.upsert(loo.id, { notes: "Second version", radar: true }, "user-one");

      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Make second update
      await fixtures.loos.upsert(loo.id, { notes: "Third version", babyChange: true }, "user-two");

      // Fetch the loo to get its created_at and updated_at
      const looResponse = await callApi(`/api/loos/${loo.id}`, { headers: authHeaders() });
      const looData = await looResponse.json();

      // Fetch reports
      const response = await callApi(`/api/loos/${loo.id}/reports?hydrate=true`, {
        headers: authHeaders(),
      });
      expect(response.status).toBe(200);
      const body = await response.json();

      // Should have 3 reports (initial creation + 2 updates)
      expect(body.count).toBe(3);
      expect(body.data).toHaveLength(3);

      // Verify chronological ordering (oldest first)
      const timestamps = body.data.map((r: { createdAt: string }) =>
        new Date(r.createdAt).getTime(),
      );
      expect(timestamps[0]).toBeLessThan(timestamps[1]);
      expect(timestamps[1]).toBeLessThan(timestamps[2]);

      // Verify report contents are in chronological order
      expect(body.data[0].notes).toBe("First version");
      expect(body.data[1].notes).toBe("Second version");
      expect(body.data[2].notes).toBe("Third version");

      // First report should use the loo's created_at
      expect(body.data[0].createdAt).toBe(looData.createdAt);

      // Subsequent reports should use their respective updated_at
      // (which for the last report matches the loo's current updated_at)
      expect(body.data[2].createdAt).toBe(looData.updatedAt);

      // Verify isSystemReport field is NOT present
      expect(body.data[0]).not.toHaveProperty("isSystemReport");
      expect(body.data[1]).not.toHaveProperty("isSystemReport");
      expect(body.data[2]).not.toHaveProperty("isSystemReport");

      // Verify diff information is present
      expect(body.data[0].diff).toBeTruthy();
      expect(body.data[1].diff).toBeTruthy();
      expect(body.data[2].diff).toBeTruthy();
    });

    it("orders reports by derived timestamps even when audit rows are out of order", async () => {
      const { prisma } = getTestContext();
      const loo = await fixtures.loos.create({
        notes: "Baseline version",
      });

      await fixtures.loos.upsert(loo.id, { notes: "Second version" }, "user-one");
      await fixtures.loos.upsert(loo.id, { notes: "Third version" }, "user-two");

      const versions = await prisma.record_version.findMany({
        where: { record: { path: ["id"], equals: loo.id } },
        orderBy: { ts: "asc" },
      });
      expect(versions.length).toBeGreaterThanOrEqual(3);

      const reversed = versions.slice().reverse();
      const baseTime = Date.now();
      for (const [index, version] of reversed.entries()) {
        await prisma.record_version.update({
          where: { id: version.id },
          data: { ts: new Date(baseTime + index * 1000) },
        });
      }

      const response = await callApi(`/api/loos/${loo.id}/reports?hydrate=true`, {
        headers: authHeaders(),
      });
      expect(response.status).toBe(200);
      const body = await response.json();

      const notesTimeline = body.data.map((report: { notes: string | null }) => report.notes);
      expect(notesTimeline).toEqual(["Baseline version", "Second version", "Third version"]);
    });

    it("includes name changes in the diff payload", async () => {
      const loo = await fixtures.loos.create({ name: "Original Name" });
      await fixtures.loos.upsert(loo.id, { name: "Updated Name" }, "name-tester");

      const response = await callApi(`/api/loos/${loo.id}/reports?hydrate=true`, {
        headers: authHeaders(),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      const latest = body.data[body.data.length - 1];

      expect(latest.diff).toBeTruthy();
      expect(latest.diff.name).toEqual({
        previous: "Original Name",
        current: "Updated Name",
      });
    });

    it("ensures summary reports also don't include isSystemReport", async () => {
      const loo = await fixtures.loos.create({ notes: "Test" });
      await fixtures.loos.upsert(loo.id, { radar: true }, "test-user");

      const response = await callApi(`/api/loos/${loo.id}/reports`, { headers: authHeaders() });
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.count).toBeGreaterThan(0);
      for (const report of body.data) {
        expect(report).not.toHaveProperty("isSystemReport");
      }
    });
  });

  describe("GET /api/loos/geohash/:geohash", () => {
    it("filters loos by geohash prefix and active flag", async () => {
      const sharedLocation = { lat: 51.504, lng: -0.11 };
      const activeLoo = await fixtures.loos.create({
        active: true,
        location: { ...sharedLocation },
      });
      const inactiveLoo = await fixtures.loos.create({
        active: false,
        location: { ...sharedLocation },
      });
      const prefix = activeLoo.geohash?.slice(0, 6);
      if (!prefix) {
        throw new Error("Fixture geohash was not generated");
      }

      const activeResponse = await callApi(`/api/loos/geohash/${prefix}?active=true`, {
        headers: authHeaders(),
      });
      expect(activeResponse.status).toBe(200);
      const activeBody = await activeResponse.json();
      expect(activeBody.data.map((row: { id: string }) => row.id)).toContain(activeLoo.id);

      const inactiveResponse = await callApi(`/api/loos/geohash/${prefix}?active=false`, {
        headers: authHeaders(),
      });
      expect(inactiveResponse.status).toBe(200);
      const inactiveBody = await inactiveResponse.json();
      expect(inactiveBody.data.map((row: { id: string }) => row.id)).toContain(inactiveLoo.id);
    });

    it("returns compressed data when compressed=true", async () => {
      const loo = await fixtures.loos.create({
        active: true,
        noPayment: true,
        allGender: true,
        automatic: false,
        accessible: false,
        babyChange: false,
        radar: false,
      });
      const prefix = loo.geohash?.slice(0, 6);
      if (!prefix) {
        throw new Error("Fixture geohash was not generated");
      }

      const response = await callApi(`/api/loos/geohash/${prefix}?compressed=true`, {
        headers: authHeaders(),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      const item = body.data.find((row: [string, string, number]) => row[0] === loo.id);
      expect(item).toBeDefined();
      expect(Array.isArray(item)).toBe(true);
      expect(item).toHaveLength(3);

      const [id, geohash, filter] = item;
      expect(id).toBe(loo.id);
      expect(typeof geohash).toBe("string");
      expect(geohash).toBe(loo.geohash);

      // Check filter bitmask
      // NO_PAYMENT (1) | ALL_GENDER (2) = 3
      expect(filter).toBe(3);
    });
  });

  describe("GET /api/loos/proximity", () => {
    it("returns loos within the requested radius", async () => {
      const near = await fixtures.loos.create({
        location: { lat: 51.5, lng: -0.12 },
      });
      await fixtures.loos.create({
        location: { lat: 53.0, lng: -2.0 },
      });

      const response = await callApi("/api/loos/proximity?lat=51.5&lng=-0.12&radius=800", {
        headers: authHeaders(),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.some((entry: { id: string }) => entry.id === near.id)).toBe(true);
      expect(body.data.every((entry: { distance: number }) => entry.distance >= 0)).toBe(true);
    });

    it("validates query parameters", async () => {
      const response = await callApi("/api/loos/proximity?lat=foo&lng=bar", {
        headers: authHeaders(),
      });
      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/loos/search", () => {
    it("supports pagination, sorting, and hasLocation filters", async () => {
      const suffix = Date.now().toString(36);
      const makeName = (label: string) => `${label} ${suffix}`;

      await fixtures.loos.create({
        name: makeName("Alpha Searchable"),
        location: { lat: 51.5, lng: -0.1 },
      });
      await fixtures.loos.create({
        name: makeName("Bravo Searchable"),
        location: { lat: 51.6, lng: -0.11 },
      });
      await fixtures.loos.create({
        name: makeName("Charlie Searchable"),
        location: { lat: 51.7, lng: -0.12 },
      });
      const noLocation = await fixtures.loos.create({
        name: makeName("Delta Searchable"),
        location: null,
      });

      const response = await callApi(
        `/api/loos/search?search=${suffix}&limit=2&page=1&sort=name-asc&hasLocation=true`,
        { headers: authHeaders() },
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(2);
      expect(body.hasMore).toBe(true);
      expect(body.data.map((row: { name: string }) => row.name)).toEqual([
        makeName("Alpha Searchable"),
        makeName("Bravo Searchable"),
      ]);

      const noLocationResponse = await callApi(
        `/api/loos/search?search=${suffix}&hasLocation=false&limit=10&page=1`,
        { headers: authHeaders() },
      );
      const noLocationBody = await noLocationResponse.json();
      expect(noLocationBody.data.map((row: { id: string }) => row.id)).toContain(noLocation.id);
    });

    it("rejects invalid pagination arguments", async () => {
      const response = await callApi("/api/loos/search?limit=5000&page=0", {
        headers: authHeaders(),
      });
      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/loos/metrics", () => {
    it("summarises filtered counts", async () => {
      const marker = `metrics-${Date.now()}`;
      await fixtures.loos.create({
        active: true,
        accessible: true,
        babyChange: true,
        radar: true,
        noPayment: true,
        notes: marker,
      });
      await fixtures.loos.create({
        active: false,
        accessible: false,
        babyChange: false,
        radar: false,
        noPayment: false,
        notes: marker,
      });

      const response = await callApi(
        `/api/loos/metrics?active=true&search=${encodeURIComponent(marker)}`,
        { headers: authHeaders() },
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.totals.filtered).toBe(1);
      expect(body.totals.accessible).toBe(1);
      expect(body.totals.babyChange).toBe(1);
      expect(body.totals.radar).toBe(1);
      expect(body.totals.freeAccess).toBe(1);
      expect(Array.isArray(body.areas)).toBe(true);
    });

    it("respects the recentWindowDays override", async () => {
      const response = await callApi("/api/loos/metrics?recentWindowDays=5", {
        headers: authHeaders(),
      });
      if (response.status !== 200) {
        console.error("DEBUG METRICS ERROR:", await response.text());
      }
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.recentWindowDays).toBe(5);
    });
  });
});
