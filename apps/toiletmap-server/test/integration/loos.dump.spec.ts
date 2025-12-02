import { describe, expect, it } from "vitest";
import { createFixtureFactory } from "./utils/fixtures";
import { callApi } from "./utils/test-client";

const fixtures = createFixtureFactory();

describe("Loo dump endpoint", () => {
  describe("GET /api/loos/dump", () => {
    it("returns all active loos in compressed format", async () => {
      const activeLoo = await fixtures.loos.create({
        active: true,
        noPayment: true,
        allGender: true,
      });
      const inactiveLoo = await fixtures.loos.create({
        active: false,
      });

      const response = await callApi("/api/loos/dump");
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.count).toBeGreaterThanOrEqual(1);

      // Should contain active loo
      const activeItem = body.data.find((row: [string, string, number]) => row[0] === activeLoo.id);
      expect(activeItem).toBeDefined();
      expect(activeItem[1]).toBe(activeLoo.geohash);
      // NO_PAYMENT (1) | ALL_GENDER (2) | ACCESSIBLE (8) = 11
      expect(activeItem[2]).toBe(11);

      // Should NOT contain inactive loo
      const inactiveItem = body.data.find(
        (row: [string, string, number]) => row[0] === inactiveLoo.id,
      );
      expect(inactiveItem).toBeUndefined();

      // Check cache header
      expect(response.headers.get("Cache-Control")).toContain("public, max-age=3600");
    });
  });
});
