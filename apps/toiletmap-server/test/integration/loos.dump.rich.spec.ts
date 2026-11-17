import { describe, expect, it } from "vitest";
import { createFixtureFactory } from "./utils/fixtures";
import type { CompressedLoo, ListBody, LooResponse } from "./utils/response-types";
import { callApi, readJson } from "./utils/test-client";

const fixtures = createFixtureFactory();

describe("Loo dump endpoint (rich)", () => {
  describe("GET /api/loos/dump?rich=true", () => {
    it("returns full loo details", async () => {
      const activeLoo = await fixtures.loos.create({
        active: true,
        name: "Rich Dump Test Loo",
      });

      const response = await callApi("/api/loos/dump?rich=true");
      expect(response.status).toBe(200);
      const body = await readJson<ListBody<LooResponse>>(response);

      expect(body.count).toBeGreaterThanOrEqual(1);

      // Should contain active loo with full details
      const activeItem = body.data.find((loo) => loo.id === activeLoo.id);
      expect(activeItem).toBeDefined();
      expect(activeItem?.name).toBe("Rich Dump Test Loo");
      expect(activeItem?.geohash).toBe(activeLoo.geohash);
    });
  });

  describe("GET /api/loos/dump", () => {
    it("returns compressed details by default", async () => {
      const activeLoo = await fixtures.loos.create({
        active: true,
        name: "Compressed Dump Test Loo",
      });

      const response = await callApi("/api/loos/dump");
      expect(response.status).toBe(200);
      const body = await readJson<ListBody<CompressedLoo>>(response);

      expect(body.count).toBeGreaterThanOrEqual(1);

      // Compressed loo is an array
      const activeItem = body.data.find((row) => row[0] === activeLoo.id);
      expect(activeItem).toBeDefined();
      expect(Array.isArray(activeItem)).toBe(true);
      expect(activeItem).toHaveLength(3);
    });
  });
});
