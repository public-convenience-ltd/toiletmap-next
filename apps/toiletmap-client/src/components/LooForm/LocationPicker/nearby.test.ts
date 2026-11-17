import { describe, expect, it } from "vitest";
import {
  buildProximityUrl,
  DUPLICATE_RADIUS_METERS,
  findNearbyMatch,
  type NearbyLoo,
  parseProximityResponse,
} from "./nearby";

const SPOT = { lat: 51.5, lng: -0.12 };
const M_PER_DEG_LAT = 111_195;
const loo = (id: string, north: number, active = true): NearbyLoo => ({
  id,
  name: id,
  location: { lat: SPOT.lat + north / M_PER_DEG_LAT, lng: SPOT.lng },
  active,
});

describe("buildProximityUrl", () => {
  it("asks for removed toilets too, within 150 m, excluding the toilet being edited", () => {
    const url = new URL(
      buildProximityUrl("https://api.test", { lat: 51.5000001234, lng: -0.12 }, "abc"),
    );
    expect(url.pathname).toBe("/api/loos/proximity");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      lat: "51.5",
      lng: "-0.12",
      radius: "150",
      includeInactive: "true",
      exclude: "abc",
    });
  });

  it("is same-origin for an empty apiUrl and omits exclude when adding", () => {
    const url = buildProximityUrl("", SPOT);
    expect(url.startsWith("/api/loos/proximity?")).toBe(true);
    expect(url).not.toContain("exclude");
  });
});

describe("parseProximityResponse", () => {
  it("keeps usable rows and defaults active to true", () => {
    expect(
      parseProximityResponse({
        data: [
          {
            id: "a",
            name: " Station ",
            location: { lat: 51.5, lng: -0.12 },
            active: true,
            distance: 3,
          },
          { id: "b", name: "", location: { lat: 51.5, lng: -0.12 } },
          { id: "c", name: "Gone", location: { lat: 51.5, lng: -0.12 }, active: false },
          { id: "d", location: null },
          { id: 5, location: { lat: 51.5, lng: -0.12 } },
          { id: "e", location: { lat: 200, lng: 0 } },
          null,
        ],
      }),
    ).toEqual([
      { id: "a", name: "Station", location: { lat: 51.5, lng: -0.12 }, active: true },
      { id: "b", name: null, location: { lat: 51.5, lng: -0.12 }, active: true },
      { id: "c", name: "Gone", location: { lat: 51.5, lng: -0.12 }, active: false },
    ]);
  });

  it.each([null, undefined, "nope", {}, { data: "x" }])("treats %j as no toilets", (body) => {
    expect(parseProximityResponse(body)).toEqual([]);
  });
});

describe("findNearbyMatch", () => {
  it(`matches an active toilet within ${DUPLICATE_RADIUS_METERS} m`, () => {
    const match = findNearbyMatch(SPOT, [loo("a", 8)]);
    expect(match?.kind).toBe("active");
    expect(match?.loo.id).toBe("a");
    expect(match?.distance).toBeCloseTo(8, 0);
  });

  it("uses an inclusive 30 m threshold", () => {
    expect(findNearbyMatch(SPOT, [loo("a", 29.9)])).not.toBeNull();
    expect(findNearbyMatch(SPOT, [loo("a", 30.1)])).toBeNull();
  });

  it("picks the nearest active toilet", () => {
    expect(findNearbyMatch(SPOT, [loo("far", 25), loo("near", 10), loo("mid", 15)])?.loo.id).toBe(
      "near",
    );
  });

  it("prefers any active match over a nearer removed one", () => {
    const match = findNearbyMatch(SPOT, [loo("gone", 2, false), loo("live", 28)]);
    expect(match).toMatchObject({ kind: "active", loo: { id: "live" } });
  });

  it("falls back to the nearest removed toilet", () => {
    const match = findNearbyMatch(SPOT, [
      loo("gone-far", 20, false),
      loo("gone", 5, false),
      loo("live-far", 60),
    ]);
    expect(match).toMatchObject({ kind: "removed", loo: { id: "gone" } });
  });

  it("never matches the excluded toilet", () => {
    expect(findNearbyMatch(SPOT, [loo("self", 0)], "self")).toBeNull();
    expect(findNearbyMatch(SPOT, [loo("self", 0), loo("other", 12)], "self")?.loo.id).toBe("other");
  });

  it("honours a custom radius", () => {
    expect(findNearbyMatch(SPOT, [loo("a", 40)], null, 50)?.loo.id).toBe("a");
  });
});

describe("findNearbyMatch when moving an existing toilet", () => {
  const at = (north: number) => ({ lat: SPOT.lat + north / M_PER_DEG_LAT, lng: SPOT.lng });

  it("ignores a neighbour the pin hasn't been moved towards", () => {
    // The toilet is at SPOT with a neighbour 10 m north; nudging the pin 3 m south asks nothing.
    expect(
      findNearbyMatch(at(-3), [loo("next door", 10)], null, undefined, { original: SPOT }),
    ).toBeNull();
    // Unmoved, too.
    expect(
      findNearbyMatch(SPOT, [loo("next door", 10)], null, undefined, { original: SPOT }),
    ).toBeNull();
  });

  it("asks about a toilet the pin has been moved onto", () => {
    const match = findNearbyMatch(at(9), [loo("next door", 10)], null, undefined, {
      original: SPOT,
    });
    expect(match).toMatchObject({ kind: "active", loo: { id: "next door" } });
  });

  it("can leave removed toilets out", () => {
    const gone = [loo("gone", 10, false)];
    expect(findNearbyMatch(at(9), gone, null, undefined, { includeRemoved: false })).toBeNull();
    expect(findNearbyMatch(at(9), gone)).toMatchObject({ kind: "removed" });
  });
});
