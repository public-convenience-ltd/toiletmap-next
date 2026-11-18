import { describe, expect, it } from "vitest";
import {
  addFormView,
  addToiletHref,
  DEFAULT_MAP_VIEW,
  initialMapView,
  MAP_VIEW_STORAGE_KEY,
  mapViewFromSearch,
  readMapView,
  toMapView,
  withoutMapViewParams,
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

describe("initialMapView", () => {
  it("opens at a ?lat&lng(&zoom) link first (legacy /map/:lng/:lat redirects land here)", () => {
    const storage = memoryStorage();
    writeMapView({ lat: 52, lng: 1, zoom: 12 }, storage);
    expect(initialMapView("?lat=53.4&lng=-2.2&zoom=16", storage)).toEqual({
      lat: 53.4,
      lng: -2.2,
      zoom: 16,
    });
  });

  it("falls back to the remembered view, then the default", () => {
    const storage = memoryStorage();
    expect(initialMapView("", storage)).toEqual(DEFAULT_MAP_VIEW);
    expect(initialMapView("?lat=999&lng=0", storage)).toEqual(DEFAULT_MAP_VIEW);
    writeMapView({ lat: 52, lng: 1, zoom: 12 }, storage);
    expect(initialMapView(null, storage)).toEqual({ lat: 52, lng: 1, zoom: 12 });
    expect(initialMapView("?utm_source=x", storage)).toEqual({ lat: 52, lng: 1, zoom: 12 });
  });
});

describe("withoutMapViewParams", () => {
  it("drops a usable ?lat&lng&zoom view, keeping other parameters and the hash", () => {
    expect(withoutMapViewParams("https://x.example/?lat=51.5&lng=-0.1&zoom=16")).toBe("/");
    expect(
      withoutMapViewParams("https://x.example/?lat=51.5&utm_source=a&lng=-0.1&zoom=16#top"),
    ).toBe("/?utm_source=a#top");
  });

  it("leaves URLs without a usable view alone", () => {
    expect(withoutMapViewParams("https://x.example/")).toBeNull();
    expect(withoutMapViewParams("https://x.example/?utm_source=a")).toBeNull();
    expect(withoutMapViewParams("https://x.example/?lat=999&lng=0")).toBeNull();
    expect(withoutMapViewParams("not a url")).toBeNull();
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

describe("addFormView", () => {
  it("opens any view at zoom 15 or closer at 17, where the pin can be placed", () => {
    expect(addFormView({ lat: 51.5, lng: -0.12, zoom: 15 })).toEqual({
      lat: 51.5,
      lng: -0.12,
      zoom: 17,
    });
    expect(addFormView({ lat: 51.5, lng: -0.12, zoom: 16 }).zoom).toBe(17);
    expect(addFormView({ lat: 51.5, lng: -0.12, zoom: 17 }).zoom).toBe(17);
    // Closer than 17 too (spec: "opens at zoom 17 when the main map was at 15 or closer").
    expect(addFormView({ lat: 51.5, lng: -0.12, zoom: 18 }).zoom).toBe(17);
    expect(addFormView({ lat: 51.5, lng: -0.12, zoom: 19 }).zoom).toBe(17);
  });

  it("leaves views further out as they are", () => {
    expect(addFormView({ lat: 51.5, lng: -0.12, zoom: 14 }).zoom).toBe(14);
    expect(addFormView({ lat: 51.5, lng: -0.12, zoom: 10 }).zoom).toBe(10);
  });
});
