import { render, waitFor } from "@testing-library/preact";
import L from "leaflet";
import ngeohash from "ngeohash";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { clearLooDetailCache, type LooDetail, primeLooDetail } from "../../api/loos";
import { DEFAULT_FILTERS } from "../../types/filters";
import MapMarkers, { diffMarkers, filterLoos } from "./MapMarkers";
import type { CompressedLoo } from "./useMapData";

const A: CompressedLoo = ["a", "gcpvj0", 0b001000]; // accessible
const B: CompressedLoo = ["b", "gcpvj1", 0b000001]; // free
const C: CompressedLoo = ["c", "gcpvj2", 0b001001]; // accessible + free

const byId = (rows: CompressedLoo[]) => new Map(rows.map((r) => [r[0], r] as const));

describe("diffMarkers", () => {
  it("reports nothing when the data is unchanged", () => {
    expect(diffMarkers(byId([A, B]), [A, B])).toEqual({ added: [], removed: [], updated: [] });
  });

  it("finds added, removed and updated ids", () => {
    const movedB: CompressedLoo = ["b", "gcpvjz", B[2]];
    const remaskedA: CompressedLoo = ["a", A[1], 0];
    expect(diffMarkers(byId([A, B]), [remaskedA, movedB, C])).toEqual({
      added: [C],
      removed: [],
      updated: [remaskedA, movedB],
    });
    expect(diffMarkers(byId([A, B, C]), [B])).toEqual({
      added: [],
      removed: ["a", "c"],
      updated: [],
    });
  });

  it("treats everything as added from empty and removed to empty", () => {
    expect(diffMarkers(new Map(), [A, B]).added).toEqual([A, B]);
    expect(diffMarkers(byId([A, B]), []).removed).toEqual(["a", "b"]);
  });

  it("lets the last duplicate id win", () => {
    const a2: CompressedLoo = ["a", "gcpvjy", 5];
    expect(diffMarkers(new Map(), [A, a2]).added).toEqual([a2]);
  });
});

describe("filterLoos", () => {
  it("returns the same array when no filter is active", () => {
    const data = [A, B, C];
    expect(filterLoos(data, DEFAULT_FILTERS)).toBe(data);
  });

  it("requires every active filter bit", () => {
    expect(filterLoos([A, B, C], { ...DEFAULT_FILTERS, ACCESSIBLE: true })).toEqual([A, C]);
    expect(
      filterLoos([A, B, C], { ...DEFAULT_FILTERS, ACCESSIBLE: true, NO_PAYMENT: true }),
    ).toEqual([C]);
  });
});

describe("MapMarkers", () => {
  let container: HTMLDivElement;
  let map: L.Map;
  let fetchMock: Mock;

  const clusterGroup = () => {
    let group: L.MarkerClusterGroup | null = null;
    map.eachLayer((layer) => {
      if (layer instanceof L.MarkerClusterGroup) group = layer;
    });
    if (!group) throw new Error("no cluster group");
    return group as L.MarkerClusterGroup;
  };
  const markerFor = (id: string, rows: CompressedLoo[]) => {
    const index = rows.findIndex((r) => r[0] === id);
    return clusterGroup().getLayers()[index] as L.Marker | undefined;
  };
  const markerIds = () => clusterGroup().getLayers().length;

  beforeEach(() => {
    container = document.createElement("div");
    container.style.width = "400px";
    container.style.height = "400px";
    document.body.appendChild(container);
    map = L.map(container, { maxZoom: 19 }).setView([51.5, -0.09], 13);
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    clearLooDetailCache();
  });

  afterEach(() => {
    map.remove();
    container.remove();
    vi.restoreAllMocks();
  });

  const props = (
    data: CompressedLoo[],
    overrides: Partial<Parameters<typeof MapMarkers>[0]> = {},
  ) => ({
    map,
    data,
    activeFilters: DEFAULT_FILTERS,
    apiUrl: "",
    selectedToiletId: null,
    onToiletSelect: () => undefined,
    ...overrides,
  });

  it("does not prefetch details when the map moves", () => {
    render(<MapMarkers {...props([A, B, C])} />);
    map.fire("moveend");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updates markers incrementally instead of rebuilding the whole layer", () => {
    const { rerender } = render(<MapMarkers {...props([A, B, C])} />);
    expect(markerIds()).toBe(3);
    const group = clusterGroup();
    const markerA = markerFor("a", [A, B, C]);
    const clear = vi.spyOn(group, "clearLayers");
    const add = vi.spyOn(group, "addLayers");
    const remove = vi.spyOn(group, "removeLayers");

    const D: CompressedLoo = ["d", "gcpvj4", 0];
    rerender(<MapMarkers {...props([A, B, C, D])} />);
    expect(clear).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][0]).toHaveLength(1);
    expect(markerIds()).toBe(4);
    // Unchanged markers are the same instances.
    expect(group.getLayers()).toContain(markerA);

    rerender(<MapMarkers {...props([A, B, C])} />);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0][0]).toHaveLength(1);
    expect(markerIds()).toBe(3);
    expect(clear).not.toHaveBeenCalled();
  });

  it("moves a marker whose geohash changed and keeps it for a mask-only change", () => {
    const { rerender } = render(<MapMarkers {...props([A, B])} />);
    const group = clusterGroup();
    const before = new Set(group.getLayers());

    rerender(<MapMarkers {...props([["a", A[1], 0b111111], B])} />);
    expect(new Set(group.getLayers())).toEqual(before);

    rerender(<MapMarkers {...props([["a", "u10hb0", A[2]], B])} />);
    const after = group.getLayers() as L.Marker[];
    expect(after).toHaveLength(2);
    const moved = after.find((m) => !before.has(m));
    expect(moved).toBeDefined();
    const target = ngeohash.decode("u10hb0");
    expect(moved?.getLatLng().lat).toBeCloseTo(target.latitude, 6);
    expect(moved?.getLatLng().lng).toBeCloseTo(target.longitude, 6);
  });

  it("applies filters", () => {
    const { rerender } = render(<MapMarkers {...props([A, B, C])} />);
    rerender(
      <MapMarkers
        {...props([A, B, C], { activeFilters: { ...DEFAULT_FILTERS, ACCESSIBLE: true } })}
      />,
    );
    expect(markerIds()).toBe(2);
    rerender(<MapMarkers {...props([A, B, C])} />);
    expect(markerIds()).toBe(3);
  });

  it("marker click shows the cached detail, then the revalidated one", async () => {
    const cached = { id: "a", name: "Cached" } as unknown as LooDetail;
    primeLooDetail(cached, 'W/"loo-a-1"');
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ id: "a", name: "Fresh" }), {
          status: 200,
          headers: { ETag: 'W/"loo-a-2"' },
        }),
    );
    let selectedId: string | null = null;
    const onToiletSelect = vi.fn((loo: LooDetail) => {
      selectedId = loo.id;
      rerender(<MapMarkers {...props([A], { onToiletSelect, selectedToiletId: selectedId })} />);
    });
    const { rerender } = render(<MapMarkers {...props([A], { onToiletSelect })} />);

    clusterGroup().getLayers()[0].fire("click");
    expect(onToiletSelect).toHaveBeenNthCalledWith(1, cached);
    await waitFor(() => expect(onToiletSelect).toHaveBeenCalledTimes(2));
    expect(onToiletSelect.mock.calls[1][0]).toMatchObject({ name: "Fresh" });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("If-None-Match")).toBe(
      'W/"loo-a-1"',
    );
  });

  it("marker click with a 304 does not select twice", async () => {
    const cached = { id: "a", name: "Cached" } as unknown as LooDetail;
    primeLooDetail(cached, 'W/"loo-a-1"');
    fetchMock.mockImplementation(async () => new Response(null, { status: 304 }));
    const onToiletSelect = vi.fn();
    render(<MapMarkers {...props([A], { onToiletSelect })} />);
    clusterGroup().getLayers()[0].fire("click");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 10));
    expect(onToiletSelect).toHaveBeenCalledTimes(1);
  });
});
