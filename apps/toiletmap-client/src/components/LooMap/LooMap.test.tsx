import { act, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LooDetail } from "../../api/loos";
import { REMOVED_MESSAGE, SAVED_MESSAGE } from "../ToiletDetailsPanel";
import LooMap from "./index";
import type { CompressedLoo, MapDataState } from "./useMapData";

// Leaflet doesn't run in happy-dom: a minimal fake map is enough for LooMap's own logic.
const fakeMap = vi.hoisted(() => {
  const m = {
    setView: vi.fn(),
    getZoom: vi.fn(() => 13),
    panBy: vi.fn(),
    remove: vi.fn(),
    getBounds: vi.fn(() => ({ contains: () => true })),
  };
  m.setView.mockReturnValue(m);
  return m;
});
vi.mock("leaflet", () => ({
  default: { map: () => fakeMap, tileLayer: () => ({ addTo: () => undefined }) },
}));

// Markers are replaced by one button per data row, calling onToiletSelect like a marker tap.
vi.mock("./MapMarkers", () => ({
  default: function MapMarkersStub({
    data,
    onToiletSelect,
  }: {
    data: CompressedLoo[];
    onToiletSelect: (loo: LooDetail) => void;
  }) {
    return (
      <div>
        {data.map(([id]) => (
          <button key={id} type="button" onClick={() => onToiletSelect(looFor(id))}>
            Marker {id}
          </button>
        ))}
      </div>
    );
  },
}));
vi.mock("../MapControlsPanel", () => ({ default: () => null }));
vi.mock("../SettingsPanel", () => ({ default: () => null }));
vi.mock("../DevTools", () => ({ default: () => null }));
vi.mock("../DevToolsButton", () => ({ default: () => null }));

const mapState = vi.hoisted(() => ({ current: null as unknown as MapDataState }));
vi.mock("./useMapData", () => ({ useMapData: () => mapState.current }));

const getLooById = vi.hoisted(() => vi.fn());
const getLooDetail = vi.hoisted(() => vi.fn());
vi.mock("../../api/loos", () => ({ getLooById, getLooDetail }));

const looFor = (id: string, overrides: Partial<LooDetail> = {}): LooDetail => ({
  id,
  name: `Toilet ${id}`,
  location: { lat: 51.5, lng: -0.1 },
  accessible: null,
  allGender: null,
  men: null,
  women: null,
  children: null,
  babyChange: null,
  radar: null,
  automatic: null,
  noPayment: null,
  paymentDetails: null,
  openingTimes: null,
  updatedAt: "2026-11-01T10:00:00.000Z",
  active: true,
  ...overrides,
});

const ROWS: CompressedLoo[] = [
  ["aaa", "gcpvj0", 1],
  ["bbb", "gcpvj1", 1],
];

const setMapData = (overrides: Partial<MapDataState> = {}) => {
  mapState.current = {
    data: ROWS,
    loading: false,
    status: "ok",
    lastSyncedAt: Date.now(),
    version: 1,
    lastChange: null,
    refresh: () => undefined,
    ...overrides,
  };
};

const panelHeading = (name: string) => screen.findByRole("heading", { name });

beforeEach(() => {
  setMapData();
  getLooById.mockReset();
  getLooById.mockImplementation(async (_api: string, id: string) => looFor(id));
  getLooDetail.mockReset();
  getLooDetail.mockImplementation(async (_api: string, id: string) => ({
    loo: looFor(id),
    fresh: true,
  }));
  for (const fn of Object.values(fakeMap)) fn.mockClear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LooMap ?saved=1", () => {
  it("shows the changes-are-live banner for the saved toilet and strips the param", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/loos/aaa?saved=1");
    render(<LooMap apiUrl="" initialToiletId="aaa" />);

    await panelHeading("Toilet aaa");
    expect(screen.getByText(SAVED_MESSAGE)).toBeInTheDocument();
    expect(window.location.pathname).toBe("/loos/aaa");
    expect(window.location.search).toBe("");

    await user.click(screen.getByRole("button", { name: "Dismiss message" }));
    expect(screen.queryByText(SAVED_MESSAGE)).not.toBeInTheDocument();
  });

  it("does not show the banner without the param, or for another toilet", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/loos/aaa?saved=1");
    render(<LooMap apiUrl="" initialToiletId="aaa" />);
    await panelHeading("Toilet aaa");

    await user.click(screen.getByRole("button", { name: "Marker bbb" }));
    await panelHeading("Toilet bbb");
    expect(screen.queryByText(SAVED_MESSAGE)).not.toBeInTheDocument();
  });
});

describe("LooMap history", () => {
  it("pushes when opening the panel, replaces when switching toilets", async () => {
    const user = userEvent.setup();
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    render(<LooMap apiUrl="" />);

    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await panelHeading("Toilet aaa");
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][2]).toBe("/loos/aaa");

    await user.click(screen.getByRole("button", { name: "Marker bbb" }));
    await panelHeading("Toilet bbb");
    expect(push).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls.at(-1)?.[2]).toBe("/loos/bbb");
    expect(window.location.pathname).toBe("/loos/bbb");
  });

  it("does not add a history entry on the initial /loos/:id load", async () => {
    const push = vi.spyOn(window.history, "pushState");
    window.history.replaceState(null, "", "/loos/aaa");
    render(<LooMap apiUrl="" initialToiletId="aaa" />);
    await panelHeading("Toilet aaa");
    expect(push).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/loos/aaa");
  });

  it("steps back over its own entry when the panel is closed", async () => {
    const user = userEvent.setup();
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    render(<LooMap apiUrl="" />);

    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await panelHeading("Toilet aaa");
    await user.click(screen.getByRole("button", { name: /close/i }));

    expect(back).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "Toilet aaa" })).not.toBeInTheDocument();
  });

  it("replaces with / when closing a toilet opened directly by URL", async () => {
    const user = userEvent.setup();
    const back = vi.spyOn(window.history, "back");
    window.history.replaceState(null, "", "/loos/aaa");
    render(<LooMap apiUrl="" initialToiletId="aaa" />);
    await panelHeading("Toilet aaa");

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(back).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/");
  });

  it("follows Back/Forward (popstate) to close and reopen the panel", async () => {
    const user = userEvent.setup();
    render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await panelHeading("Toilet aaa");

    // Back to "/".
    act(() => {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Toilet aaa" })).not.toBeInTheDocument(),
    );

    // Forward to another toilet's URL.
    const push = vi.spyOn(window.history, "pushState");
    act(() => {
      window.history.replaceState(null, "", "/loos/bbb");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await panelHeading("Toilet bbb");
    expect(getLooById).toHaveBeenLastCalledWith("", "bbb");
    // Following the address bar never writes to history itself.
    expect(push).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/loos/bbb");
  });
});

describe("LooMap initial /loos/:id load", () => {
  it("a marker tapped while the initial toilet loads wins, and the URL follows it", async () => {
    const user = userEvent.setup();
    const push = vi.spyOn(window.history, "pushState");
    let resolveInitial: (loo: LooDetail) => void = () => undefined;
    getLooById.mockReturnValueOnce(
      new Promise<LooDetail>((r) => {
        resolveInitial = r;
      }),
    );
    window.history.replaceState(null, "", "/loos/aaa");
    render(<LooMap apiUrl="" initialToiletId="aaa" />);

    await user.click(screen.getByRole("button", { name: "Marker bbb" }));
    await panelHeading("Toilet bbb");
    expect(window.location.pathname).toBe("/loos/bbb");
    // Replaced, not pushed: Back/close must not reopen the never-shown initial toilet.
    expect(push).not.toHaveBeenCalled();

    await act(async () => {
      resolveInitial(looFor("aaa"));
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "Toilet bbb" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Toilet aaa" })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/loos/bbb");
    // The map was not panned to the initial toilet (only the default view was set).
    expect(fakeMap.setView).not.toHaveBeenCalledWith([51.5, -0.1], 15, { animate: false });
  });

  it("a late initial result doesn't override the same toilet tapped meanwhile", async () => {
    const user = userEvent.setup();
    let resolveInitial: (loo: LooDetail) => void = () => undefined;
    getLooById.mockReturnValueOnce(
      new Promise<LooDetail>((r) => {
        resolveInitial = r;
      }),
    );
    window.history.replaceState(null, "", "/loos/aaa");
    render(<LooMap apiUrl="" initialToiletId="aaa" />);

    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await panelHeading("Toilet aaa");
    await act(async () => {
      resolveInitial(looFor("aaa", { name: "Older copy" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "Toilet aaa" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/loos/aaa");
  });

  it("resets the address bar to / when the initial toilet can't be loaded", async () => {
    getLooById.mockResolvedValueOnce(null);
    window.history.replaceState(null, "", "/loos/aaa");
    render(<LooMap apiUrl="" initialToiletId="aaa" />);
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});

describe("LooMap freshness", () => {
  it("revalidates the open toilet when the map data changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await panelHeading("Toilet aaa");

    getLooDetail.mockResolvedValueOnce({
      loo: looFor("aaa", { name: "Renamed elsewhere" }),
      fresh: true,
    });
    setMapData({ data: [ROWS[0], ["bbb", "gcpvj1", 3]], version: 2 });
    rerender(<LooMap apiUrl="" />);

    await panelHeading("Renamed elsewhere");
    expect(getLooDetail).toHaveBeenLastCalledWith("", "aaa", { revalidate: true });
  });

  it("revalidates the open toilet when a delta names it but its row is unchanged (name edit)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await panelHeading("Toilet aaa");

    getLooDetail.mockResolvedValueOnce({
      loo: looFor("aaa", { name: "Renamed in another tab" }),
      fresh: true,
    });
    // Same data array: only the change set says "aaa" was upserted.
    setMapData({ lastChange: { upserted: ["aaa"], deleted: [] } });
    rerender(<LooMap apiUrl="" />);

    await panelHeading("Renamed in another tab");
    expect(getLooDetail).toHaveBeenLastCalledWith("", "aaa", { revalidate: true });
  });

  it("ignores a delta that names other toilets", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await panelHeading("Toilet aaa");
    setMapData({ lastChange: { upserted: ["bbb"], deleted: [] } });
    rerender(<LooMap apiUrl="" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(getLooDetail).not.toHaveBeenCalled();
  });

  it("shows the removed state when the open toilet leaves the map and 404s", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await panelHeading("Toilet aaa");

    getLooDetail.mockResolvedValueOnce({ loo: null, fresh: true });
    setMapData({ data: [ROWS[1]], version: 2 });
    rerender(<LooMap apiUrl="" />);

    expect(await screen.findByText(new RegExp(REMOVED_MESSAGE))).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Toilet aaa" })).toBeInTheDocument();
  });

  it("shows the removed state when the open toilet leaves the map and the refetch fails", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await panelHeading("Toilet aaa");

    // Network error: getLooDetail falls back to the (stale, still active) cached copy.
    getLooDetail.mockResolvedValueOnce({ loo: looFor("aaa"), fresh: false });
    setMapData({ data: [ROWS[1]], lastChange: { upserted: [], deleted: ["aaa"] }, version: 2 });
    rerender(<LooMap apiUrl="" />);

    expect(await screen.findByText(new RegExp(REMOVED_MESSAGE))).toBeInTheDocument();
  });

  it("keeps the panel as it is when the refetch fails but the toilet is still on the map", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await panelHeading("Toilet aaa");

    getLooDetail.mockResolvedValueOnce({ loo: looFor("aaa", { name: "Stale" }), fresh: false });
    setMapData({ lastChange: { upserted: ["aaa"], deleted: [] } });
    rerender(<LooMap apiUrl="" />);
    await waitFor(() => expect(getLooDetail).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "Toilet aaa" })).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(REMOVED_MESSAGE))).not.toBeInTheDocument();
  });

  it("shows the removed state when the open toilet comes back inactive", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await panelHeading("Toilet aaa");

    getLooDetail.mockResolvedValueOnce({ loo: looFor("aaa", { active: false }), fresh: true });
    setMapData({ data: [ROWS[1]], version: 2 });
    rerender(<LooMap apiUrl="" />);

    expect(await screen.findByText(new RegExp(REMOVED_MESSAGE))).toBeInTheDocument();
  });

  it("does not refetch when nothing is selected", async () => {
    const { rerender } = render(<LooMap apiUrl="" />);
    setMapData({ data: [ROWS[1]], version: 2 });
    rerender(<LooMap apiUrl="" />);
    await Promise.resolve();
    expect(getLooById).not.toHaveBeenCalled();
    expect(getLooDetail).not.toHaveBeenCalled();
  });

  it("shows a status notice when the data is stale or offline", () => {
    const at = new Date(2026, 10, 17, 14, 30).getTime();
    setMapData({ status: "stale", lastSyncedAt: at });
    const { rerender } = render(<LooMap apiUrl="" />);
    const notice = screen.getByText("Couldn't refresh — showing data from 14:30");
    expect(notice.closest('[role="status"]')).not.toBeNull();

    setMapData({ status: "offline" });
    rerender(<LooMap apiUrl="" />);
    expect(screen.getByText("Offline — showing saved data")).toBeInTheDocument();

    setMapData({ status: "ok" });
    rerender(<LooMap apiUrl="" />);
    expect(screen.queryByText(/showing saved data|Couldn't refresh/)).not.toBeInTheDocument();
  });
});
