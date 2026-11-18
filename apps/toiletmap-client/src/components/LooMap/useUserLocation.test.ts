import { act, renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GEOLOCATION_DENIED,
  GEOLOCATION_FAILED,
  GEOLOCATION_UNSUPPORTED,
  geolocationErrorMessage,
  toUserLocation,
  useUserLocation,
} from "./useUserLocation";

type Success = (position: GeolocationPosition) => void;
type Failure = (error: GeolocationPositionError) => void;

const position = (latitude: number, longitude: number, accuracy = 25) =>
  ({ coords: { latitude, longitude, accuracy } }) as GeolocationPosition;

/** A navigator.geolocation stub whose watch callbacks the test drives. */
function stubGeolocation() {
  const watches: { success: Success; failure: Failure }[] = [];
  const geolocation = {
    watchPosition: vi.fn((success: Success, failure: Failure) => {
      watches.push({ success, failure });
      return watches.length;
    }),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn(),
  };
  Object.defineProperty(navigator, "geolocation", { value: geolocation, configurable: true });
  return {
    geolocation,
    fix: (p: GeolocationPosition) => act(() => watches.at(-1)?.success(p)),
    fail: (code: number) =>
      act(() => watches.at(-1)?.failure({ code } as GeolocationPositionError)),
  };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "geolocation");
});

describe("toUserLocation", () => {
  it("keeps real coordinates and the accuracy", () => {
    expect(toUserLocation(position(51.5, -0.12, 30))).toEqual({
      lat: 51.5,
      lng: -0.12,
      accuracy: 30,
    });
  });

  it("rejects impossible coordinates", () => {
    expect(toUserLocation(position(Number.NaN, 0))).toBeNull();
    expect(toUserLocation(position(91, 0))).toBeNull();
    expect(toUserLocation(position(0, 181))).toBeNull();
  });

  it("drops a missing accuracy", () => {
    expect(toUserLocation({ coords: { latitude: 1, longitude: 2, accuracy: null } })).toEqual({
      lat: 1,
      lng: 2,
    });
  });
});

describe("geolocationErrorMessage", () => {
  it("explains a blocked permission separately", () => {
    expect(geolocationErrorMessage({ code: 1 })).toBe(GEOLOCATION_DENIED);
    expect(geolocationErrorMessage({ code: 3 })).toBe(GEOLOCATION_FAILED);
    expect(geolocationErrorMessage(null)).toBe(GEOLOCATION_FAILED);
  });
});

describe("useUserLocation", () => {
  beforeEach(() => {
    Reflect.deleteProperty(navigator, "geolocation");
  });

  it("asks for nothing until locate is called", () => {
    const { geolocation } = stubGeolocation();
    const { result } = renderHook(() => useUserLocation());
    expect(result.current.location).toBeNull();
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
  });

  it("watches after locate, hands the first fix to onFix, then keeps tracking", () => {
    const { geolocation, fix } = stubGeolocation();
    const { result } = renderHook(() => useUserLocation());
    const onFix = vi.fn();

    act(() => result.current.locate(onFix));
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1);
    fix(position(51.5, -0.1));
    expect(onFix).toHaveBeenCalledWith({ lat: 51.5, lng: -0.1, accuracy: 25 });
    expect(result.current.location).toEqual({ lat: 51.5, lng: -0.1, accuracy: 25 });

    // The dot follows the viewer, but the map isn't re-centred on every fix.
    fix(position(51.51, -0.11));
    expect(onFix).toHaveBeenCalledTimes(1);
    expect(result.current.location).toMatchObject({ lat: 51.51, lng: -0.11 });
  });

  it("a second locate re-uses the watch and the current fix", () => {
    const { geolocation, fix } = stubGeolocation();
    const { result } = renderHook(() => useUserLocation());
    act(() => result.current.locate());
    fix(position(51.5, -0.1));

    const onFix = vi.fn();
    act(() => result.current.locate(onFix));
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(onFix).toHaveBeenCalledWith({ lat: 51.5, lng: -0.1, accuracy: 25 });
  });

  it("stops and explains when permission is denied", () => {
    const { geolocation, fail } = stubGeolocation();
    const { result } = renderHook(() => useUserLocation());
    act(() => result.current.locate(vi.fn()));
    fail(1);
    expect(result.current.error).toBe(GEOLOCATION_DENIED);
    expect(result.current.location).toBeNull();
    expect(geolocation.clearWatch).toHaveBeenCalledWith(1);
  });

  it("keeps the last fix through a later timeout", () => {
    const { geolocation, fix, fail } = stubGeolocation();
    const { result } = renderHook(() => useUserLocation());
    act(() => result.current.locate());
    fix(position(51.5, -0.1));
    fail(3);
    expect(result.current.error).toBeNull();
    expect(result.current.location).toMatchObject({ lat: 51.5 });
    expect(geolocation.clearWatch).not.toHaveBeenCalled();
  });

  it("says so when the browser has no geolocation", () => {
    const { result } = renderHook(() => useUserLocation());
    act(() => result.current.locate(vi.fn()));
    expect(result.current.error).toBe(GEOLOCATION_UNSUPPORTED);
  });

  it("stops watching on unmount", () => {
    const { geolocation } = stubGeolocation();
    const { result, unmount } = renderHook(() => useUserLocation());
    act(() => result.current.locate());
    unmount();
    expect(geolocation.clearWatch).toHaveBeenCalledWith(1);
  });
});
