import { describe, expect, it } from "vitest";
import { getTestContext } from "./setup";
import { createFixtureFactory } from "./utils/fixtures";
import type { CompressedLoo, ListBody } from "./utils/response-types";
import { callApi, readJson } from "./utils/test-client";

const authHeaders = () => {
  const { issueToken } = getTestContext();
  return {
    Authorization: `Bearer ${issueToken()}`,
  };
};

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
      const body = await readJson<ListBody<CompressedLoo>>(response);

      expect(body.count).toBeGreaterThanOrEqual(1);

      // Should contain active loo
      const activeItem = body.data.find((row) => row[0] === activeLoo.id);
      expect(activeItem).toBeDefined();
      expect(activeItem?.[1]).toBe(activeLoo.geohash);
      // NO_PAYMENT (1) | ALL_GENDER (2) | ACCESSIBLE (8) = 11
      expect(activeItem?.[2]).toBe(11);

      // Should NOT contain inactive loo
      const inactiveItem = body.data.find((row) => row[0] === inactiveLoo.id);
      expect(inactiveItem).toBeUndefined();

      // Short browser caching; freshness comes from the cursor + /updates.
      // See loos.caching.spec.ts for the full caching contract.
      expect(response.headers.get("Cache-Control")).toBe(
        "public, max-age=60, stale-while-revalidate=300",
      );

      // A second request for the same dataset version (here authenticated)
      // is served from the (mocked) edge cache with an identical body.
      const cachedResponse = await callApi("/api/loos/dump", {
        headers: authHeaders(),
      });
      expect(cachedResponse.status).toBe(200);
      expect(cachedResponse.headers.get("ETag")).toBe(response.headers.get("ETag"));
      const cachedBody = await readJson<ListBody<CompressedLoo>>(cachedResponse);
      expect(cachedBody).toEqual(body);
    });
  });
});
