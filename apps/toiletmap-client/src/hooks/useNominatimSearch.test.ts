import { act, renderHook, waitFor } from "@testing-library/preact";
import type L from "leaflet";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type NominatimResult, useNominatimSearch } from "./useNominatimSearch";

const RESULT: NominatimResult = {
  place_id: 42,
  display_name: "Trafalgar Square, London",
  lat: "51.508039",
  lon: "-0.128069",
};

/** A stand-in for the picker's Leaflet map: every method that could move the view is a spy. */
const fakeMap = () => ({
  setView: vi.fn(),
  flyTo: vi.fn(),
  panTo: vi.fn(),
  fitBounds: vi.fn(),
});

const asMapRef = (map: ReturnType<typeof fakeMap> | null) => ({
  current: map as unknown as L.Map | null,
});

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useNominatimSearch", () => {
  it("pans the map to a selected suggestion and touches nothing else", () => {
    const map = fakeMap();
    const { result } = renderHook(() =>
      useNominatimSearch({ mapRef: asMapRef(map), selectZoom: 17 }),
    );

    act(() => result.current.handleSuggestionSelect(RESULT));

    expect(map.setView).toHaveBeenCalledTimes(1);
    expect(map.setView).toHaveBeenCalledWith([51.508039, -0.128069], 17, { animate: false });
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(map.panTo).not.toHaveBeenCalled();
    expect(result.current.query).toBe("Trafalgar Square, London");
    expect(result.current.suggestions).toEqual([]);
  });

  it("defaults to zoom 15 when panning", () => {
    const map = fakeMap();
    const { result } = renderHook(() => useNominatimSearch({ mapRef: asMapRef(map) }));

    act(() => result.current.handleSuggestionSelect(RESULT));

    expect(map.setView).toHaveBeenCalledWith([51.508039, -0.128069], 15, { animate: false });
  });

  it("does not pan for a suggestion with unusable coordinates", () => {
    const map = fakeMap();
    const { result } = renderHook(() => useNominatimSearch({ mapRef: asMapRef(map) }));

    act(() => result.current.handleSuggestionSelect({ ...RESULT, lat: "n/a" }));

    expect(map.setView).not.toHaveBeenCalled();
    expect(result.current.query).toBe("Trafalgar Square, London");
  });

  it("is safe to select before the map exists", () => {
    const { result } = renderHook(() => useNominatimSearch({ mapRef: asMapRef(null) }));
    expect(() => act(() => result.current.handleSuggestionSelect(RESULT))).not.toThrow();
  });

  it("only calls the deprecated onSelect when one is explicitly passed", () => {
    // The hook's only way to write a location is onSelect; without it, selection must be pan-only.
    const map = fakeMap();
    const onSelect = vi.fn();
    const withSetter = renderHook(() => useNominatimSearch({ mapRef: asMapRef(map), onSelect }));
    act(() => withSetter.result.current.handleSuggestionSelect(RESULT));
    expect(onSelect).toHaveBeenCalledWith(51.508039, -0.128069);

    onSelect.mockClear();
    const withoutSetter = renderHook(() => useNominatimSearch({ mapRef: asMapRef(map) }));
    act(() => withoutSetter.result.current.handleSuggestionSelect(RESULT));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("debounces the search and exposes the results as suggestions", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([RESULT]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { result } = renderHook(() => useNominatimSearch());

    act(() => result.current.handleSearchInput("Trafalgar"));
    expect(fetchMock).not.toHaveBeenCalled();

    await waitFor(() => expect(result.current.suggestions).toEqual([RESULT]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin).toBe("https://nominatim.openstreetmap.org");
    expect(url.searchParams.get("q")).toBe("Trafalgar");
    expect(url.searchParams.get("countrycodes")).toBe("gb");
  });

  it("does not search for queries shorter than two characters", async () => {
    const { result } = renderHook(() => useNominatimSearch());

    act(() => result.current.handleSearchInput("T"));
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.isSearching).toBe(false);
  });
});
