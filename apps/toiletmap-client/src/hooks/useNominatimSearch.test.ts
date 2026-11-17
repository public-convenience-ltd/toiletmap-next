import { act, renderHook, waitFor } from "@testing-library/preact";
import type L from "leaflet";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type NominatimResult, resultBounds, useNominatimSearch } from "./useNominatimSearch";

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

  it("searches straight away with searchNow, skipping the debounce", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([RESULT]), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { result } = renderHook(() => useNominatimSearch());

    act(() => result.current.handleSearchInput("Trafalgar"));
    act(() => result.current.searchNow());
    // No wait for the 300 ms debounce: the request is already out.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.suggestions).toEqual([RESULT]));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("says when a search found nothing, until the query changes", async () => {
    fetchMock.mockResolvedValue(
      new Response("[]", { headers: { "Content-Type": "application/json" } }),
    );
    const { result } = renderHook(() => useNominatimSearch());

    act(() => result.current.handleSearchInput("Zzzzqx"));
    expect(result.current.noResults).toBe(false);
    await waitFor(() => expect(result.current.noResults).toBe(true));
    expect(result.current.isSearching).toBe(false);

    act(() => result.current.handleSearchInput("Zzzzq"));
    expect(result.current.noResults).toBe(false);
  });

  it("dismiss closes the results and drops a pending search, keeping the query", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([RESULT]), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { result } = renderHook(() => useNominatimSearch());
    act(() => result.current.handleSearchInput("Trafalgar"));
    await waitFor(() => expect(result.current.suggestions).toEqual([RESULT]));

    act(() => result.current.dismiss());
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.query).toBe("Trafalgar");

    act(() => result.current.handleSearchInput("Trafalgar Sq"));
    act(() => result.current.dismiss());
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.suggestions).toEqual([]);
  });

  describe("fitResultBounds", () => {
    const WITH_BOX: NominatimResult = {
      ...RESULT,
      boundingbox: ["51.5076", "51.5085", "-0.1291", "-0.1270"],
    };

    it("fits the map to the result's bounding box, never closer than maxZoom", () => {
      const map = fakeMap();
      const { result } = renderHook(() =>
        useNominatimSearch({ mapRef: asMapRef(map), fitResultBounds: true }),
      );

      act(() => result.current.handleSuggestionSelect(WITH_BOX));

      expect(map.fitBounds).toHaveBeenCalledTimes(1);
      expect(map.fitBounds).toHaveBeenCalledWith(
        [
          [51.5076, -0.1291],
          [51.5085, -0.127],
        ],
        { maxZoom: 18, animate: false },
      );
      expect(map.setView).not.toHaveBeenCalled();
    });

    it("honours a custom maxZoom", () => {
      const map = fakeMap();
      const { result } = renderHook(() =>
        useNominatimSearch({ mapRef: asMapRef(map), fitResultBounds: true, maxZoom: 16 }),
      );
      act(() => result.current.handleSuggestionSelect(WITH_BOX));
      expect(map.fitBounds).toHaveBeenCalledWith(expect.anything(), {
        maxZoom: 16,
        animate: false,
      });
    });

    it("falls back to centring at selectZoom without a usable box", () => {
      const map = fakeMap();
      const { result } = renderHook(() =>
        useNominatimSearch({ mapRef: asMapRef(map), fitResultBounds: true, selectZoom: 17 }),
      );
      act(() => result.current.handleSuggestionSelect(RESULT));
      expect(map.fitBounds).not.toHaveBeenCalled();
      expect(map.setView).toHaveBeenCalledWith([51.508039, -0.128069], 17, { animate: false });
    });

    it("ignores the box unless asked to fit it", () => {
      const map = fakeMap();
      const { result } = renderHook(() => useNominatimSearch({ mapRef: asMapRef(map) }));
      act(() => result.current.handleSuggestionSelect(WITH_BOX));
      expect(map.fitBounds).not.toHaveBeenCalled();
      expect(map.setView).toHaveBeenCalledTimes(1);
    });
  });
});

describe("resultBounds", () => {
  it("converts [south, north, west, east] strings to Leaflet bounds", () => {
    expect(resultBounds({ boundingbox: ["50", "51", "-1", "0.5"] })).toEqual([
      [50, -1],
      [51, 0.5],
    ]);
  });

  it.each([
    ["missing", undefined],
    ["too short", ["50", "51", "-1"]],
    ["not numbers", ["a", "51", "-1", "0"]],
    ["inverted", ["52", "51", "-1", "0"]],
    ["out of range", ["50", "95", "-1", "0"]],
  ])("rejects a %s box", (_label, boundingbox) => {
    expect(resultBounds({ boundingbox: boundingbox as NominatimResult["boundingbox"] })).toBeNull();
  });
});
