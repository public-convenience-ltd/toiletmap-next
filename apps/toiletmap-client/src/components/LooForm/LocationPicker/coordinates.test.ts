import { describe, expect, it } from "vitest";
import { formatCoordinates, isInUk, parseCoordinates } from "./coordinates";

const ok = (lat: number, lng: number) => ({ ok: true, lat, lng });

describe("parseCoordinates", () => {
  it.each([
    ["51.5034, -0.1276", ok(51.5034, -0.1276)],
    ["51.5034,-0.1276", ok(51.5034, -0.1276)],
    ["  51.5034 , -0.1276  ", ok(51.5034, -0.1276)],
    ["51.5034 -0.1276", ok(51.5034, -0.1276)],
    ["51.5034; -0.1276", ok(51.5034, -0.1276)],
    ["(51.5034, -0.1276)", ok(51.5034, -0.1276)],
    ["[51.5034, -0.1276]", ok(51.5034, -0.1276)],
    ["+51.5034, +0.1276", ok(51.5034, 0.1276)],
    ["51.5034, −0.1276", ok(51.5034, -0.1276)], // Unicode minus, as some sites copy it
    ["51.5034° N, 0.1276° W", ok(51.5034, -0.1276)],
    ["51.5034N 0.1276W", ok(51.5034, -0.1276)],
    ["0.1276° W, 51.5034° N", ok(51.5034, -0.1276)],
    ["55, -3", ok(55, -3)],
  ])("reads %j", (input, expected) => {
    expect(parseCoordinates(input)).toEqual(expected);
  });

  it.each([
    ["https://www.google.com/maps/@51.5007292,-0.1246254,17z", ok(51.5007292, -0.1246254)],
    [
      "https://www.google.com/maps/place/Big+Ben/@51.5007292,-0.1268141,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d51.5007292!4d-0.1246254",
      ok(51.5007292, -0.1246254),
    ],
    ["https://maps.google.com/?q=51.5034,-0.1276", ok(51.5034, -0.1276)],
    ["https://www.google.com/maps/search/?api=1&query=51.5034%2C-0.1276", ok(51.5034, -0.1276)],
    ["https://www.google.co.uk/maps?ll=53.4808,-2.2426&z=15", ok(53.4808, -2.2426)],
    ["www.google.com/maps/@51.5007,-0.1246,18z", ok(51.5007, -0.1246)],
  ])("reads the Google Maps link %s", (input, expected) => {
    expect(parseCoordinates(input)).toEqual(expected);
  });

  it("prefers the place (!3d!4d) over the view centre (@) in a place link", () => {
    const result = parseCoordinates(
      "https://www.google.com/maps/place/X/@51.6,-0.2,17z/data=!3d51.5!4d-0.1",
    );
    expect(result).toEqual(ok(51.5, -0.1));
  });

  it("asks for something when empty", () => {
    expect(parseCoordinates("   ")).toEqual({
      ok: false,
      error: expect.stringMatching(/^Enter a latitude/),
    });
  });

  it.each(["hello", "51.5", "51.5, -0.12, 3", "51.5, abc", "1,2,3,4", "51.5,,-0.1"])(
    "rejects the unreadable %j",
    (input) => {
      expect(parseCoordinates(input)).toEqual({
        ok: false,
        error: expect.stringMatching(/separated by a comma/),
      });
    },
  );

  it("rejects a link without coordinates", () => {
    expect(parseCoordinates("https://www.google.com/maps/place/Big+Ben")).toEqual({
      ok: false,
      error: expect.stringMatching(/couldn't find coordinates in that link/),
    });
  });

  it.each([
    ["48.8566, 2.3522"], // Paris
    ["40.7128, -74.006"], // New York
    ["61.1, -0.5"],
    ["51.5, 2.6"],
    ["91, 0"],
  ])("rejects %j as outside the UK", (input) => {
    expect(parseCoordinates(input)).toEqual({
      ok: false,
      error: expect.stringMatching(/aren't in the UK/),
    });
  });

  it("spots longitude-first input", () => {
    expect(parseCoordinates("-0.1276, 51.5034")).toEqual({
      ok: false,
      error: expect.stringMatching(/wrong way round/),
    });
  });
});

describe("isInUk", () => {
  it("covers the corners of the box and nothing beyond", () => {
    expect(isInUk(49, -9)).toBe(true);
    expect(isInUk(61, 2.5)).toBe(true);
    expect(isInUk(60.15, -1.15)).toBe(true); // Lerwick
    expect(isInUk(49.91, -6.31)).toBe(true); // Isles of Scilly
    expect(isInUk(54.6, -5.93)).toBe(true); // Belfast
    expect(isInUk(48.99, 0)).toBe(false);
    expect(isInUk(55, -9.01)).toBe(false);
    expect(isInUk(Number.NaN, 0)).toBe(false);
  });
});

describe("formatCoordinates", () => {
  it("rounds to 6 dp without trailing zeros", () => {
    expect(formatCoordinates({ lat: 51.501234567, lng: -0.1 })).toBe("51.501235, -0.1");
    expect(formatCoordinates(null)).toBe("");
  });

  it("round-trips through parseCoordinates", () => {
    const text = formatCoordinates({ lat: 53.4808, lng: -2.2426 });
    expect(parseCoordinates(text)).toEqual(ok(53.4808, -2.2426));
  });
});
