import { describe, expect, it } from "vitest";
import {
  BIG_MOVE_METERS,
  bearingDegrees,
  compassPoint,
  describeMove,
  formatDistance,
} from "./move";

const ORIGIN = { lat: 51.5, lng: -0.12 };
const M_PER_DEG_LAT = 111_195;
const offset = (north: number, east: number) => ({
  lat: ORIGIN.lat + north / M_PER_DEG_LAT,
  lng: ORIGIN.lng + east / (M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180)),
});

describe("bearingDegrees", () => {
  it.each([
    ["north", offset(100, 0), 0],
    ["east", offset(0, 100), 90],
    ["south", offset(-100, 0), 180],
    ["west", offset(0, -100), 270],
    ["north-east", offset(100, 100), 45],
  ])("points %s", (_label, to, expected) => {
    expect(bearingDegrees(ORIGIN, to)).toBeCloseTo(expected, 0);
  });
});

describe("compassPoint", () => {
  it.each([
    [0, "north"],
    [22.4, "north"],
    [22.6, "north-east"],
    [45, "north-east"],
    [90, "east"],
    [135, "south-east"],
    [180, "south"],
    [225, "south-west"],
    [270, "west"],
    [315, "north-west"],
    [337.6, "north"],
    [359.9, "north"],
    [-90, "west"],
    [450, "east"],
  ])("%s° is %s", (bearing, expected) => {
    expect(compassPoint(bearing)).toBe(expected);
  });
});

describe("formatDistance", () => {
  it.each([
    [0.4, "under 1 m"],
    [1, "1 m"],
    [8.4, "8 m"],
    [23.5, "24 m"],
    [999.4, "999 m"],
    [1000, "1 km"],
    [1240, "1.2 km"],
    [9960, "10 km"],
    [12_400, "12 km"],
  ])("%s m reads %s", (meters, expected) => {
    expect(formatDistance(meters)).toBe(expected);
  });

  it("is empty for nonsense", () => {
    expect(formatDistance(Number.NaN)).toBe("");
    expect(formatDistance(-1)).toBe("");
  });
});

describe("describeMove", () => {
  it("reads 'Moved 23 m north-east'", () => {
    const move = describeMove(ORIGIN, offset(16.3, 16.3));
    expect(move.label).toBe("Moved 23 m north-east");
    expect(move.direction).toBe("north-east");
    expect(move.unmoved).toBe(false);
    expect(move.big).toBe(false);
  });

  it("treats jitter (≤ 0.5 m) as not moved", () => {
    const move = describeMove(ORIGIN, offset(0.3, 0.2));
    expect(move).toMatchObject({ unmoved: true, direction: null, big: false });
    expect(move.label).toBe("At the original location");
  });

  it(`flags moves over ${BIG_MOVE_METERS} m as big`, () => {
    expect(describeMove(ORIGIN, offset(49, 0)).big).toBe(false);
    expect(describeMove(ORIGIN, offset(51, 0)).big).toBe(true);
    expect(describeMove(ORIGIN, offset(0, -2000)).label).toBe("Moved 2 km west");
  });
});
