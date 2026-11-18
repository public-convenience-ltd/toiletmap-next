import { act, renderHook, waitFor } from "@testing-library/preact";
import type L from "leaflet";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  looksLikePostcode,
  type PlaceResult,
  resultBounds,
  usePlaceSearch,
} from "./usePlaceSearch";

const RESULT: PlaceResult = {
  label: "Trafalgar Square, London",
  lat: 51.508039,
  lng: -0.128069,
  kind: "place",
};

const POSTCODE: PlaceResult = {
  label: "SW1A 1AA, Westminster",
  lat: 51.501,
  lng: -0.1416,
  kind: "postcode",
};

const OSM = "Data © OpenStreetMap contributors, ODbL 1.0. https://osm.org/copyright";

/** What `/api/geocode` answers. */
const geocodeResponse = (results: PlaceResult[], attribution: string | null = OSM, status = 200) =>
  new Response(JSON.stringify({ results, attribution }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

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
  vi.restoreAllMocks();
});

describe("usePlaceSearch", () => {
  it("pans the map to a selected suggestion and touches nothing else", () => {
    const map = fakeMap();
    const { result } = renderHook(() => usePlaceSearch({ mapRef: asMapRef(map), selectZoom: 17 }));

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
    const { result } = renderHook(() => usePlaceSearch({ mapRef: asMapRef(map) }));

    act(() => result.current.handleSuggestionSelect(RESULT));

    expect(map.setView).toHaveBeenCalledWith([51.508039, -0.128069], 15, { animate: false });
  });

  it("does not pan for a suggestion with unusable coordinates", () => {
    const map = fakeMap();
    const { result } = renderHook(() => usePlaceSearch({ mapRef: asMapRef(map) }));

    act(() => result.current.handleSuggestionSelect({ ...RESULT, lat: Number.NaN }));

    expect(map.setView).not.toHaveBeenCalled();
    expect(result.current.query).toBe("Trafalgar Square, London");
  });

  it("is safe to select before the map exists", () => {
    const { result } = renderHook(() => usePlaceSearch({ mapRef: asMapRef(null) }));
    expect(() => act(() => result.current.handleSuggestionSelect(RESULT))).not.toThrow();
  });

  it("only calls the deprecated onSelect when one is explicitly passed", () => {
    // The hook's only way to write a location is onSelect; without it, selection must be pan-only.
    const map = fakeMap();
    const onSelect = vi.fn();
    const withSetter = renderHook(() => usePlaceSearch({ mapRef: asMapRef(map), onSelect }));
    act(() => withSetter.result.current.handleSuggestionSelect(RESULT));
    expect(onSelect).toHaveBeenCalledWith(51.508039, -0.128069);

    onSelect.mockClear();
    const withoutSetter = renderHook(() => usePlaceSearch({ mapRef: asMapRef(map) }));
    act(() => withoutSetter.result.current.handleSuggestionSelect(RESULT));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("looks a typed postcode up (debounced, mode=suggest) through the same-origin /api/geocode", async () => {
    fetchMock.mockResolvedValue(geocodeResponse([POSTCODE], null));
    const { result } = renderHook(() => usePlaceSearch());

    act(() => result.current.handleSearchInput("SW1A 1AA"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetchMock).not.toHaveBeenCalled();

    await waitFor(() => expect(result.current.suggestions).toEqual([POSTCODE]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/geocode?q=SW1A+1AA&mode=suggest");
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(result.current.attribution).toBeNull();
    expect(result.current.awaitingSubmit).toBe(false);
  });

  it("looks a typed two-character outcode up too", async () => {
    fetchMock.mockResolvedValue(geocodeResponse([{ ...POSTCODE, label: "M1, Manchester" }], null));
    const { result } = renderHook(() => usePlaceSearch());
    act(() => result.current.handleSearchInput("M1"));
    await waitFor(() => expect(result.current.suggestions).toHaveLength(1));
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/geocode?q=M1&mode=suggest");
  });

  it("never searches a place name as you type (Nominatim forbids autocomplete): it waits for Enter", async () => {
    const { result } = renderHook(() => usePlaceSearch());

    act(() => result.current.handleSearchInput("Trafalgar Square"));
    expect(result.current.awaitingSubmit).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.isSearching).toBe(false);

    act(() => result.current.handleSearchInput("T"));
    expect(result.current.awaitingSubmit).toBe(false);
  });

  it("asks for Enter when a typed postcode-shaped query isn't a known postcode", async () => {
    fetchMock.mockResolvedValue(geocodeResponse([], null));
    const { result } = renderHook(() => usePlaceSearch());
    act(() => result.current.handleSearchInput("A1"));
    await waitFor(() => expect(result.current.awaitingSubmit).toBe(true));
    expect(result.current.noResults).toBe(false);
    expect(result.current.isSearching).toBe(false);
  });

  it("asks a busy geocoder (503) once more after its Retry-After, for a search only", async () => {
    const busy = () =>
      new Response(JSON.stringify({ error: "geocoder_busy" }), {
        status: 503,
        headers: { "Retry-After": "0" },
      });
    fetchMock.mockResolvedValueOnce(busy()).mockResolvedValueOnce(geocodeResponse([RESULT]));
    const { result } = renderHook(() => usePlaceSearch());
    act(() => result.current.handleSearchInput("Trafalgar"));
    act(() => result.current.searchNow());
    await waitFor(() => expect(result.current.suggestions).toEqual([RESULT]));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy());
    act(() => result.current.handleSearchInput("Leicester"));
    act(() => result.current.searchNow());
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(busy());
    act(() => result.current.handleSearchInput("SW1A 1AA"));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("searchNow searches a two-character outcode, but not one character", async () => {
    fetchMock.mockResolvedValue(geocodeResponse([], null));
    const { result } = renderHook(() => usePlaceSearch());

    act(() => result.current.handleSearchInput("M"));
    act(() => result.current.searchNow());
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => result.current.handleSearchInput("M1"));
    act(() => result.current.searchNow());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/geocode?q=M1");
    await waitFor(() => expect(result.current.noResults).toBe(true));
  });

  it("aborts a stale request when the query changes, and ignores its answer", async () => {
    const signals: AbortSignal[] = [];
    let answerFirst: (response: Response) => void = () => undefined;
    fetchMock
      .mockImplementationOnce((_input, init) => {
        if (init?.signal) signals.push(init.signal);
        return new Promise<Response>((resolve) => {
          answerFirst = resolve;
        });
      })
      .mockImplementationOnce((_input, init) => {
        if (init?.signal) signals.push(init.signal);
        return Promise.resolve(
          geocodeResponse([{ ...RESULT, label: "Trafalgar Road, Greenwich" }]),
        );
      });
    const { result } = renderHook(() => usePlaceSearch());

    act(() => result.current.handleSearchInput("Trafalgar"));
    act(() => result.current.searchNow());
    act(() => result.current.handleSearchInput("Trafalgar Rd"));
    act(() => result.current.searchNow());

    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    await waitFor(() =>
      expect(result.current.suggestions.map((s) => s.label)).toEqual(["Trafalgar Road, Greenwich"]),
    );
    answerFirst(geocodeResponse([RESULT]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.suggestions.map((s) => s.label)).toEqual(["Trafalgar Road, Greenwich"]);
  });

  it("drops malformed results and keeps no attribution for postcode results", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { label: "SW1A 1AA, Westminster", lat: 51.501, lng: -0.1416, kind: "postcode" },
            { label: "Broken" },
          ],
          attribution: null,
        }),
      ),
    );
    const { result } = renderHook(() => usePlaceSearch());
    act(() => result.current.handleSearchInput("SW1A 1AA"));
    await waitFor(() => expect(result.current.suggestions).toHaveLength(1));
    expect(result.current.suggestions[0]?.label).toBe("SW1A 1AA, Westminster");
    expect(result.current.attribution).toBeNull();
  });

  it("reports a failed search (server error or network) until the query changes", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "geocoder_unavailable" }), { status: 502 }),
    );
    const { result } = renderHook(() => usePlaceSearch());
    act(() => result.current.handleSearchInput("Trafalgar"));
    act(() => result.current.searchNow());
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.isSearching).toBe(false);

    act(() => result.current.handleSearchInput("Trafalgar S"));
    expect(result.current.failed).toBe(false);

    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    act(() => result.current.searchNow());
    await waitFor(() => expect(result.current.failed).toBe(true));
  });

  it("searches straight away with searchNow, skipping the debounce", async () => {
    fetchMock.mockResolvedValue(geocodeResponse([RESULT]));
    const { result } = renderHook(() => usePlaceSearch());

    act(() => result.current.handleSearchInput("Trafalgar"));
    act(() => result.current.searchNow());
    // No wait for the 400 ms debounce: the request is already out.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.suggestions).toEqual([RESULT]));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("says when a search found nothing, until the query changes", async () => {
    fetchMock.mockResolvedValue(geocodeResponse([]));
    const { result } = renderHook(() => usePlaceSearch());

    act(() => result.current.handleSearchInput("Zzzzqx"));
    act(() => result.current.searchNow());
    expect(result.current.noResults).toBe(false);
    await waitFor(() => expect(result.current.noResults).toBe(true));
    expect(result.current.awaitingSubmit).toBe(false);
    expect(result.current.isSearching).toBe(false);

    act(() => result.current.handleSearchInput("Zzzzq"));
    expect(result.current.noResults).toBe(false);
  });

  it("dismiss closes the results and drops a pending search, keeping the query", async () => {
    fetchMock.mockResolvedValue(geocodeResponse([POSTCODE], null));
    const { result } = renderHook(() => usePlaceSearch());
    act(() => result.current.handleSearchInput("SW1A 1AA"));
    await waitFor(() => expect(result.current.suggestions).toEqual([POSTCODE]));

    act(() => result.current.dismiss());
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.query).toBe("SW1A 1AA");

    act(() => result.current.handleSearchInput("SW1A 2AA"));
    act(() => result.current.dismiss());
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.suggestions).toEqual([]);
  });

  describe("fitResultBounds", () => {
    const WITH_BOX: PlaceResult = {
      ...RESULT,
      bbox: [-0.1291, 51.5076, -0.127, 51.5085],
    };

    it("fits the map to the result's bounding box, never closer than maxZoom", () => {
      const map = fakeMap();
      const { result } = renderHook(() =>
        usePlaceSearch({ mapRef: asMapRef(map), fitResultBounds: true }),
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
        usePlaceSearch({ mapRef: asMapRef(map), fitResultBounds: true, maxZoom: 16 }),
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
        usePlaceSearch({ mapRef: asMapRef(map), fitResultBounds: true, selectZoom: 17 }),
      );
      act(() => result.current.handleSuggestionSelect(RESULT));
      expect(map.fitBounds).not.toHaveBeenCalled();
      expect(map.setView).toHaveBeenCalledWith([51.508039, -0.128069], 17, { animate: false });
    });

    it("ignores the box unless asked to fit it", () => {
      const map = fakeMap();
      const { result } = renderHook(() => usePlaceSearch({ mapRef: asMapRef(map) }));
      act(() => result.current.handleSuggestionSelect(WITH_BOX));
      expect(map.fitBounds).not.toHaveBeenCalled();
      expect(map.setView).toHaveBeenCalledTimes(1);
    });
  });
});

describe("looksLikePostcode", () => {
  it.each(["SW1A 1AA", "sw1a1aa", " m1 ", "M1", "SW1A", "EC1A 1BB", "B33 8TH"])(
    "%s is looked up while typing",
    (value) => expect(looksLikePostcode(value)).toBe(true),
  );
  it.each(["Trafalgar", "London Bridge", "SW1A 1", "M", "Bath", "A1 road"])(
    "%s waits for Enter",
    (value) => expect(looksLikePostcode(value)).toBe(false),
  );
});

describe("resultBounds", () => {
  it("converts a [west, south, east, north] box to Leaflet bounds", () => {
    expect(resultBounds({ bbox: [-1, 50, 0.5, 51] })).toEqual([
      [50, -1],
      [51, 0.5],
    ]);
  });

  it.each([
    ["missing", undefined],
    ["too short", [-1, 50, 0]],
    ["not numbers", [-1, Number.NaN, 0, 51]],
    ["inverted", [-1, 52, 0, 51]],
    ["out of range", [-1, 50, 0, 95]],
  ])("rejects a %s box", (_label, bbox) => {
    expect(resultBounds({ bbox: bbox as PlaceResult["bbox"] })).toBeNull();
  });
});
