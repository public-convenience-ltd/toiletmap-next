import { describe, expect, it } from "vitest";
import { callApi } from "./utils/test-client";
import { createFixtureFactory } from "./utils/fixtures";
import { getTestContext } from "./setup";

const fixtures = createFixtureFactory();

describe("Loo read endpoints", () => {
  describe("GET /loos/:id", () => {
    it("returns a persisted loo with area metadata", async () => {
      const { prisma } = getTestContext();
      const existingArea = await prisma.areas.findFirst();
      const loo = await fixtures.loos.create({
        areaId: existingArea?.id ?? undefined,
        location: { lat: 51.501, lng: -0.124 },
      });

      const response = await callApi(`/loos/${loo.id}`);
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
      const response = await callApi("/loos/ffffffffffffffffffffffff");
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.message).toMatch(/not found/i);
    });
  });

  describe("GET /loos (ids)", () => {
    it("returns loos matching provided ids and preserves order", async () => {
      const first = await fixtures.loos.create();
      const second = await fixtures.loos.create();

      const response = await callApi(`/loos?ids=${first.id}&ids=${second.id}`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.count).toBe(2);
      expect(body.data.map((item: { id: string }) => item.id)).toEqual([
        first.id,
        second.id,
      ]);
    });

    it("rejects requests without ids", async () => {
      const response = await callApi("/loos");
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.message).toMatch(/provide ids/i);
    });
  });

  describe("GET /loos/:id/reports", () => {
    it("returns audit history summaries and hydrated reports", async () => {
      const loo = await fixtures.loos.create({ notes: "Original notes" });
      await fixtures.loos.upsert(
        loo.id,
        { notes: "Updated notes", radar: true },
        "reports-test"
      );

      const summaryResponse = await callApi(`/loos/${loo.id}/reports`);
      expect(summaryResponse.status).toBe(200);
      const summary = await summaryResponse.json();
      expect(summary.count).toBeGreaterThan(0);
      expect(summary.data[0]).toMatchObject({
        id: expect.any(String),
        contributor: expect.any(String),
      });
      expect(summary.data[0]).not.toHaveProperty("notes");

      const hydratedResponse = await callApi(
        `/loos/${loo.id}/reports?hydrate=true`
      );
      expect(hydratedResponse.status).toBe(200);
      const hydrated = await hydratedResponse.json();
      expect(hydrated.data[0]).toHaveProperty("notes");
    });

    it("returns reports in chronological ascending order with correct timestamps", async () => {
      // Create initial loo
      const loo = await fixtures.loos.create({
        notes: "First version",
        accessible: true,
      });

      // Wait a bit to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 50));

      // Make first update
      await fixtures.loos.upsert(
        loo.id,
        { notes: "Second version", radar: true },
        "user-one"
      );

      // Wait a bit to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 50));

      // Make second update
      await fixtures.loos.upsert(
        loo.id,
        { notes: "Third version", babyChange: true },
        "user-two"
      );

      // Fetch the loo to get its created_at and updated_at
      const looResponse = await callApi(`/loos/${loo.id}`);
      const looData = await looResponse.json();

      // Fetch reports
      const response = await callApi(`/loos/${loo.id}/reports?hydrate=true`);
      expect(response.status).toBe(200);
      const body = await response.json();

      // Should have 3 reports (initial creation + 2 updates)
      expect(body.count).toBe(3);
      expect(body.data).toHaveLength(3);

      // Verify chronological ordering (oldest first)
      const timestamps = body.data.map((r: { createdAt: string }) =>
        new Date(r.createdAt).getTime()
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

    it("ensures summary reports also don't include isSystemReport", async () => {
      const loo = await fixtures.loos.create({ notes: "Test" });
      await fixtures.loos.upsert(loo.id, { radar: true }, "test-user");

      const response = await callApi(`/loos/${loo.id}/reports`);
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.count).toBeGreaterThan(0);
      for (const report of body.data) {
        expect(report).not.toHaveProperty("isSystemReport");
      }
    });
  });

  describe("GET /loos/geohash/:geohash", () => {
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

      const activeResponse = await callApi(
        `/loos/geohash/${prefix}?active=true`
      );
      expect(activeResponse.status).toBe(200);
      const activeBody = await activeResponse.json();
      expect(activeBody.data.map((row: { id: string }) => row.id)).toContain(
        activeLoo.id
      );

      const inactiveResponse = await callApi(
        `/loos/geohash/${prefix}?active=false`
      );
      expect(inactiveResponse.status).toBe(200);
      const inactiveBody = await inactiveResponse.json();
      expect(inactiveBody.data.map((row: { id: string }) => row.id)).toContain(
        inactiveLoo.id
      );
    });
  });

  describe("GET /loos/proximity", () => {
    it("returns loos within the requested radius", async () => {
      const near = await fixtures.loos.create({
        location: { lat: 51.5, lng: -0.12 },
      });
      await fixtures.loos.create({
        location: { lat: 53.0, lng: -2.0 },
      });

      const response = await callApi(
        "/loos/proximity?lat=51.5&lng=-0.12&radius=800"
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(
        body.data.some((entry: { id: string }) => entry.id === near.id)
      ).toBe(true);
      expect(
        body.data.every((entry: { distance: number }) => entry.distance >= 0)
      ).toBe(true);
    });

    it("validates query parameters", async () => {
      const response = await callApi("/loos/proximity?lat=foo&lng=bar");
      expect(response.status).toBe(400);
    });
  });

  describe("GET /loos/search", () => {
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
        `/loos/search?search=${suffix}&limit=2&page=1&sort=name-asc&hasLocation=true`
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
        `/loos/search?search=${suffix}&hasLocation=false&limit=10&page=1`
      );
      const noLocationBody = await noLocationResponse.json();
      expect(
        noLocationBody.data.map((row: { id: string }) => row.id)
      ).toContain(noLocation.id);
    });

    it("rejects invalid pagination arguments", async () => {
      const response = await callApi("/loos/search?limit=5000&page=0");
      expect(response.status).toBe(400);
    });
  });
});
