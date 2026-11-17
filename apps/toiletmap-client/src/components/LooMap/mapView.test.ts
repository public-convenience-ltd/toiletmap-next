import { describe, expect, it } from "vitest";
import {
  addToiletHref,
  MAP_VIEW_STORAGE_KEY,
  mapViewFromSearch,
  readMapView,
  toMapView,
  writeMapView,
} from "./mapView";

const memoryStorage = (): Storage => {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, String(value));
    },
  };
};

const throwingStorage = (): Storage =>
  ({
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  }) as unknown as Storage;

describe("toMapView", () => {
  it("accepts numbers and numeric strings, rounding and clamping the zoom", () => {
    expect(toMapView(51.5, -0.12, 15)).toEqual({ lat: 51.5, lng: -0.12, zoom: 15 });
    expect(toMapView("51.5", "-0.12", "16.6")).toEqual({ lat: 51.5, lng: -0.12, zoom: 17 });
    expect(toMapView(51.5, -0.12, 40)).toEqual({ lat: 51.5, lng: -0.12, zoom: 19 });
    expect(toMapView(51.5, -0.12, -3)).toEqual({ lat: 51.5, lng: -0.12, zoom: 0 });
  });

  it.each([
    [Number.NaN, 0, 10],
    ["abc", 0, 10],
    [91, 0, 10],
    [0, 181, 10],
    [null, 0, 10],
    [0, 0, undefined],
  ])("rejects (%s, %s, %s)", (lat, lng, zoom) => {
    expect(toMapView(lat, lng, zoom)).toBeNull();
  });
});

describe("readMapView / writeMapView", () => {
  it("round-trips a view (6 dp)", () => {
    const storage = memoryStorage();
    writeMapView({ lat: 51.50123456789, lng: -0.1212121212, zoom: 15 }, storage);
    expect(JSON.parse(storage.getItem(MAP_VIEW_STORAGE_KEY) ?? "")).toEqual({
      lat: 51.501235,
      lng: -0.121212,
      zoom: 15,
    });
    expect(readMapView(storage)).toEqual({ lat: 51.501235, lng: -0.121212, zoom: 15 });
  });

  it("ignores junk, missing values and broken storage", () => {
    const storage = memoryStorage();
    expect(readMapView(storage)).toBeNull();
    storage.setItem(MAP_VIEW_STORAGE_KEY, "{not json");
    expect(readMapView(storage)).toBeNull();
    storage.setItem(MAP_VIEW_STORAGE_KEY, JSON.stringify({ lat: "x", lng: 0, zoom: 3 }));
    expect(readMapView(storage)).toBeNull();
    storage.setItem(MAP_VIEW_STORAGE_KEY, "null");
    expect(readMapView(storage)).toBeNull();
    expect(readMapView(throwingStorage())).toBeNull();
    expect(readMapView(null)).toBeNull();
    expect(() => writeMapView({ lat: 51.5, lng: 0, zoom: 3 }, throwingStorage())).not.toThrow();
  });

  it("doesn't store an invalid view", () => {
    const storage = memoryStorage();
    writeMapView({ lat: Number.NaN, lng: 0, zoom: 3 }, storage);
    expect(storage.getItem(MAP_VIEW_STORAGE_KEY)).toBeNull();
  });
});

describe("mapViewFromSearch", () => {
  it("reads ?lat&lng&zoom, defaulting the zoom to 17", () => {
    expect(mapViewFromSearch("?lat=52.2&lng=0.12&zoom=18")).toEqual({
      lat: 52.2,
      lng: 0.12,
      zoom: 18,
    });
    expect(mapViewFromSearch("?lat=52.2&lng=0.12")).toEqual({ lat: 52.2, lng: 0.12, zoom: 17 });
  });

  it("needs both coordinates", () => {
    expect(mapViewFromSearch("")).toBeNull();
    expect(mapViewFromSearch("?lat=52.2")).toBeNull();
    expect(mapViewFromSearch("?lat=abc&lng=0")).toBeNull();
  });
});

describe("addToiletHref", () => {
  it("links to the add page at the given view", () => {
    expect(addToiletHref({ lat: 51.50123456789, lng: -0.12, zoom: 16 })).toBe(
      "/loos/add?lat=51.501235&lng=-0.12&zoom=16",
    );
  });

  it("falls back to the plain add page", () => {
    expect(addToiletHref(null)).toBe("/loos/add");
    expect(addToiletHref({ lat: Number.NaN, lng: 0, zoom: 1 })).toBe("/loos/add");
  });

  it("round-trips through mapViewFromSearch", () => {
    const href = addToiletHref({ lat: 53.4808, lng: -2.2426, zoom: 15 });
    expect(mapViewFromSearch(new URL(href, "https://x.test").search)).toEqual({
      lat: 53.4808,
      lng: -2.2426,
      zoom: 15,
    });
  });
});
