import { act, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { toast } from "toiletmap-design-system";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LooDetail } from "../../api/loos";
import { REMOVED_MESSAGE } from "../ToiletDetailsPanel";
import LooMap from "./index";
import {
  ADDED_MESSAGE,
  EMPTY_FILTERED_MESSAGE,
  EMPTY_MESSAGE,
  NOT_FOUND_MESSAGE,
  SAVED_MESSAGE,
} from "./messages";
import type { CompressedLoo, MapDataState } from "./useMapData";

// Leaflet doesn't run in happy-dom: a minimal fake map is enough for LooMap's own logic.
const fakeMap = vi.hoisted(() => {
  const handlers = new Map<string, (() => void)[]>();
  const m = {
    setView: vi.fn(),
    getZoom: vi.fn(() => 13),
    getCenter: vi.fn(() => ({ lat: 51.505, lng: -0.09 })),
    panBy: vi.fn(),
    panInside: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    remove: vi.fn(),
    getBounds: vi.fn(() => ({ contains: (_point: unknown): boolean => true })),
    on: vi.fn((name: string, fn: () => void) => {
      handlers.set(name, [...(handlers.get(name) ?? []), fn]);
      return m;
    }),
    /** Runs the handlers LooMap registered for `name` (e.g. "moveend" after a pan). */
    fire: (name: string) => {
      for (const fn of handlers.get(name) ?? []) fn();
    },
    handlers,
  };
  m.setView.mockReturnValue(m);
  return m;
});
/** Layers LooMap draws itself ("you are here"), recorded by kind. */
const fakeLayers = vi.hoisted(() => [] as { kind: string; latlng: unknown; options: unknown }[]);
vi.mock("leaflet", () => {
  const layer = (kind: string) => (latlng: unknown, options: unknown) => {
    const entry = { kind, latlng, options };
    fakeLayers.push(entry);
    const self = {
      addTo: () => self,
      setLatLng: (next: unknown) => {
        entry.latlng = next;
        return self;
      },
      setRadius: () => self,
    };
    return self;
  };
  return {
    default: {
      map: vi.fn(() => fakeMap),
      tileLayer: () => ({ addTo: () => undefined }),
      marker: layer("marker"),
      circle: layer("circle"),
      divIcon: (options: unknown) => options,
    },
  };
});

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
const peekLooDetail = vi.hoisted(() => vi.fn());
vi.mock("../../api/loos", () => ({ getLooById, getLooDetail, peekLooDetail }));

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
  peekLooDetail.mockReset();
  peekLooDetail.mockReturnValue(null);
  getLooDetail.mockReset();
  getLooDetail.mockImplementation(async (_api: string, id: string) => ({
    loo: looFor(id),
    fresh: true,
  }));
  for (const fn of Object.values(fakeMap)) if (vi.isMockFunction(fn)) fn.mockClear();
  fakeMap.handlers.clear();
  fakeMap.getCenter.mockReturnValue({ lat: 51.505, lng: -0.09 });
  fakeMap.getZoom.mockReturnValue(13);
  fakeMap.getBounds.mockReturnValue({ contains: () => true });
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
  // The toast store is shared by the whole page (module level).
  act(() => toast.clear());
});

describe("LooMap ?saved=1", () => {
  const toasts = () => screen.getByRole("list", { name: "Notifications" });

  it("confirms the save in a toast, outside the panel, and strips the param", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/loos/aaa?saved=1");
    render(<LooMap apiUrl="" initialToiletId="aaa" />);

    const heading = await panelHeading("Toilet aaa");
    const message = await screen.findByText(SAVED_MESSAGE);
    // In the polite live region the page rendered first, not in the panel.
    expect(toasts()).toContainElement(message);
    expect(toasts()).toHaveAttribute("aria-live", "polite");
    expect(heading.closest(".toilet-panel")).not.toContainElement(message);
    expect(message.closest(".notice")).toHaveClass("notice--success");
    expect(window.location.pathname).toBe("/loos/aaa");
    expect(window.location.search).toBe("");

    await user.click(screen.getByRole("button", { name: "Dismiss message" }));
    expect(screen.queryByText(SAVED_MESSAGE)).not.toBeInTheDocument();
  });

  it("says a new toilet is on the map after saved=added", async () => {
    window.history.replaceState(null, "", "/loos/aaa?saved=added");
    render(<LooMap apiUrl="" initialToiletId="aaa" />);
    await panelHeading("Toilet aaa");
    expect(toasts()).toContainElement(await screen.findByText(ADDED_MESSAGE));
    expect(screen.queryByText(SAVED_MESSAGE)).not.toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("does not show the toast without the param", async () => {
    window.history.replaceState(null, "", "/loos/aaa");
    render(<LooMap apiUrl="" initialToiletId="aaa" />);
    await panelHeading("Toilet aaa");
    expect(screen.queryByText(SAVED_MESSAGE)).not.toBeInTheDocument();
    // The region is there all along (empty), so a later toast is announced.
    expect(toasts()).toBeEmptyDOMElement();
  });

  it("keeps the toast clear of the panel and the bottom controls: at the top of the map", async () => {
    window.history.replaceState(null, "", "/loos/aaa?saved=1");
    render(<LooMap apiUrl="" initialToiletId="aaa" />);
    await panelHeading("Toilet aaa");
    await screen.findByText(SAVED_MESSAGE);
    // Below the search bar (toastLayout covers the geometry; happy-dom has no layout).
    expect(document.querySelector(".toast-region")).toHaveClass("toast-region--top");
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

/** The map's own history entry, as pushState(PUSHED_STATE, …) leaves it. */
const PUSHED = { toiletmapSelection: true };

/**
 * Emulates the browser's session history for Back/Forward: two entries, "/" and the map's
 * pushed `/loos/<id>`, with `history.back()`/`forward()` moving between them and firing
 * popstate asynchronously, as browsers do.
 */
function fakeTwoEntryHistory(id: string) {
  const go = (to: "/" | "toilet") => {
    if (to === "/") window.history.replaceState(null, "", "/");
    else window.history.replaceState(PUSHED, "", `/loos/${id}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const back = vi.spyOn(window.history, "back").mockImplementation(() => {
    setTimeout(() => go("/"));
  });
  return { back, go };
}

/** Lets Preact render (a microtask) without running effects, which wait for the next frame. */
const renderOnly = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

describe("LooMap Back/Forward races", () => {
  it("Forward straight after Back reopens the panel (the close isn't replayed onto the new URL)", async () => {
    const user = userEvent.setup();
    render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await panelHeading("Toilet aaa");
    expect(window.location.pathname).toBe("/loos/aaa");
    const { back, go } = fakeTwoEntryHistory("aaa");

    // Back: the panel closes (rendered), but effects for that render haven't run yet when
    // Forward arrives.
    go("/");
    await renderOnly();
    expect(screen.queryByRole("heading", { name: "Toilet aaa" })).not.toBeInTheDocument();
    go("toilet");

    await panelHeading("Toilet aaa");
    // Let any deferred effect run: nothing may step back off the restored entry.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(back).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/loos/aaa");
    expect(screen.getByRole("heading", { name: "Toilet aaa" })).toBeInTheDocument();
  });

  it("a slow Forward fetch overtaken by Back doesn't reopen the panel", async () => {
    const user = userEvent.setup();
    render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await panelHeading("Toilet aaa");
    const { go } = fakeTwoEntryHistory("aaa");
    go("/");
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Toilet aaa" })).not.toBeInTheDocument(),
    );

    let resolveForward: (loo: LooDetail) => void = () => undefined;
    getLooById.mockReturnValueOnce(
      new Promise<LooDetail>((r) => {
        resolveForward = r;
      }),
    );
    act(() => go("toilet"));
    act(() => go("/"));
    await act(async () => {
      resolveForward(looFor("aaa"));
      await Promise.resolve();
    });
    expect(screen.queryByRole("heading", { name: "Toilet aaa" })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("shows the cached copy at once on Forward, then the server's", async () => {
    const user = userEvent.setup();
    render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await panelHeading("Toilet aaa");
    const { go } = fakeTwoEntryHistory("aaa");
    act(() => go("/"));

    let resolveForward: (loo: LooDetail) => void = () => undefined;
    getLooById.mockReturnValueOnce(
      new Promise<LooDetail>((r) => {
        resolveForward = r;
      }),
    );
    peekLooDetail.mockReturnValue(looFor("aaa", { name: "Cached copy" }));
    act(() => go("toilet"));
    await panelHeading("Cached copy");
    await act(async () => {
      resolveForward(looFor("aaa", { name: "Server copy" }));
      await Promise.resolve();
    });
    await panelHeading("Server copy");
    expect(window.location.pathname).toBe("/loos/aaa");
  });

  it("Escape closes a panel Forward just reopened, before its effects have run", async () => {
    const user = userEvent.setup();
    render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await panelHeading("Toilet aaa");
    const { back, go } = fakeTwoEntryHistory("aaa");
    act(() => go("/"));
    getLooById.mockReturnValueOnce(new Promise(() => undefined));
    peekLooDetail.mockReturnValue(looFor("aaa"));

    go("toilet");
    await renderOnly();
    expect(screen.getByRole("heading", { name: "Toilet aaa" })).toBeInTheDocument();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    // A second close before Back lands must not step back twice.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Toilet aaa" })).not.toBeInTheDocument(),
    );
    expect(back).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(window.location.pathname).toBe("/"));
  });

  it("resets the address bar to / when the toilet Forward lands on can't be loaded", async () => {
    const user = userEvent.setup();
    render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await panelHeading("Toilet aaa");
    const { go } = fakeTwoEntryHistory("aaa");
    act(() => go("/"));

    getLooById.mockResolvedValueOnce(null);
    act(() => go("toilet"));
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
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
    // And says why the map opened without it.
    expect(screen.getByRole("list", { name: "Notifications" })).toContainElement(
      await screen.findByText(NOT_FOUND_MESSAGE),
    );
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
    // A DS Notice in the bottom-right column, above "Add a toilet here", never over it.
    expect(notice.closest(".notice")).toHaveClass("notice--warning");
    const column = notice.closest(".map-chrome-bottom-right");
    expect(column).not.toBeNull();
    expect(column).toContainElement(screen.getByRole("link", { name: "Add a toilet here" }));

    setMapData({ status: "offline" });
    rerender(<LooMap apiUrl="" />);
    expect(screen.getByText("Offline — showing saved data")).toBeInTheDocument();

    setMapData({ status: "ok" });
    rerender(<LooMap apiUrl="" />);
    expect(screen.queryByText(/showing saved data|Couldn't refresh/)).not.toBeInTheDocument();
  });

  it("shows the notice in the open panel (which would cover it), keeping one live region", async () => {
    const user = userEvent.setup();
    setMapData({ status: "offline" });
    const { container } = render(<LooMap apiUrl="" />);
    const mapNotice = container.querySelector(".map-freshness-notice");
    expect(mapNotice).toHaveClass("map-freshness-notice--shown");

    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    const heading = await panelHeading("Toilet aaa");
    const panel = heading.closest(".toilet-panel");
    expect(panel).toHaveTextContent("Offline — showing saved data");
    // The panel's copy is visual only; the map's live region still carries it.
    expect(panel?.querySelector('div[aria-hidden="true"] .notice')).toHaveTextContent(
      "Offline — showing saved data",
    );
    expect(mapNotice).not.toHaveClass("map-freshness-notice--shown");
    expect(mapNotice).toHaveTextContent("Offline — showing saved data");

    // The panel opens expanded: the first Escape (focus is on its heading) collapses it, and
    // the notice stays in the panel; the second closes it.
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(mapNotice).not.toHaveClass("map-freshness-notice--shown");
    expect(mapNotice).toHaveTextContent("Offline — showing saved data");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(container.querySelector(".toilet-panel")).toBeNull());
    expect(mapNotice).toHaveClass("map-freshness-notice--shown");
  });
});

describe("LooMap empty state", () => {
  const nothingInView = () => fakeMap.getBounds.mockReturnValue({ contains: () => false });

  it("says so when there are no toilets in view, once the data is in", () => {
    nothingInView();
    setMapData({ loading: true });
    const { rerender } = render(<LooMap apiUrl="" />);
    expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument();

    setMapData({ loading: false });
    rerender(<LooMap apiUrl="" />);
    const notice = screen.getByText(EMPTY_MESSAGE);
    expect(notice.closest(".notice")).toHaveClass("notice--info");
    expect(notice.closest(".map-chrome-bottom-right")).not.toBeNull();
  });

  it("announces through a live region that is on the page before the message", () => {
    nothingInView();
    setMapData({ loading: true });
    const { container, rerender } = render(<LooMap apiUrl="" />);
    const region = container.querySelector(".map-empty-notice");
    expect(region).toHaveAttribute("role", "status");
    expect(region).toBeEmptyDOMElement();
    expect(region).not.toHaveClass("map-empty-notice--shown");
    expect(region).not.toHaveAttribute("data-map-control");

    setMapData({ loading: false });
    rerender(<LooMap apiUrl="" />);
    // The same element, now with the message in it (the Notice itself isn't a second region).
    expect(container.querySelector(".map-empty-notice")).toBe(region);
    expect(region).toHaveTextContent(EMPTY_MESSAGE);
    expect(region).toHaveClass("map-empty-notice--shown");
    expect(region?.querySelector(".notice")).not.toHaveAttribute("role");
  });

  it.each([
    ["offline", "Offline — showing saved data"],
    ["stale", "Couldn't refresh"],
  ] as const)(
    "doesn't claim the area is empty when the first load failed (%s) and nothing is cached",
    (status, freshness) => {
      nothingInView();
      setMapData({ loading: false, status, data: [], lastSyncedAt: null });
      render(<LooMap apiUrl="" />);
      expect(screen.getByText(new RegExp(freshness))).toBeInTheDocument();
      expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument();
      expect(screen.queryByText(EMPTY_FILTERED_MESSAGE)).not.toBeInTheDocument();
    },
  );

  it("still says the area is empty when saved data is on screen while offline", () => {
    nothingInView();
    setMapData({ loading: false, status: "offline" });
    render(<LooMap apiUrl="" />);
    expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
  });

  it("shows nothing while toilets are in view", () => {
    render(<LooMap apiUrl="" />);
    expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByText(EMPTY_FILTERED_MESSAGE)).not.toBeInTheDocument();
  });

  it("updates as the map moves", () => {
    render(<LooMap apiUrl="" />);
    expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument();
    nothingInView();
    act(() => fakeMap.fire("moveend"));
    expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
  });
});

describe("LooMap view memory and 'Add a toilet here'", () => {
  const VIEW_KEY = "toiletmap-map-view";
  /** Node's own (non-functional) localStorage shadows happy-dom's here, so use a memory one. */
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

  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const addLink = () => screen.getByRole("link", { name: "Add a toilet here" });

  it("opens at the remembered view when there is no deep link", () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: 53.48, lng: -2.24, zoom: 15 }));
    render(<LooMap apiUrl="" />);
    expect(fakeMap.setView).toHaveBeenCalledWith([53.48, -2.24], 15);
    expect(addLink()).toHaveAttribute("href", "/loos/add?lat=53.48&lng=-2.24&zoom=15");
  });

  it("opens at a ?lat&lng&zoom link (a legacy /map URL), then drops it from the address bar", () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: 53.48, lng: -2.24, zoom: 15 }));
    window.history.replaceState(null, "", "/?lat=51.539&lng=-0.1426&zoom=16&utm_source=x#top");
    render(<LooMap apiUrl="" />);
    expect(fakeMap.setView).toHaveBeenCalledWith([51.539, -0.1426], 16);
    expect(addLink()).toHaveAttribute("href", "/loos/add?lat=51.539&lng=-0.1426&zoom=16");
    // A reload (or the shared address) follows the map: the link's view is remembered for it.
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      "/?utm_source=x#top",
    );
    expect(JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null")).toEqual({
      lat: 51.539,
      lng: -0.1426,
      zoom: 16,
    });
  });

  it("ignores the remembered view for a /loos/:id deep link", () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: 53.48, lng: -2.24, zoom: 15 }));
    window.history.replaceState(null, "", "/loos/aaa");
    render(<LooMap apiUrl="" initialToiletId="aaa" />);
    expect(fakeMap.setView).toHaveBeenNthCalledWith(1, [51.505, -0.09], 13);
  });

  it("falls back to London with nothing (or junk) remembered", () => {
    localStorage.setItem(VIEW_KEY, "{junk");
    render(<LooMap apiUrl="" />);
    expect(fakeMap.setView).toHaveBeenCalledWith([51.505, -0.09], 13);
  });

  it("remembers the view and moves the add link with the map", () => {
    render(<LooMap apiUrl="" />);
    fakeMap.getCenter.mockReturnValue({ lat: 52.2053, lng: 0.1218 });
    fakeMap.getZoom.mockReturnValue(16);
    act(() => fakeMap.fire("moveend"));

    expect(JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null")).toEqual({
      lat: 52.2053,
      lng: 0.1218,
      zoom: 16,
    });
    expect(addLink()).toHaveAttribute("href", "/loos/add?lat=52.2053&lng=0.1218&zoom=16");
  });

  it("keeps working when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    });
    render(<LooMap apiUrl="" />);
    fakeMap.getCenter.mockReturnValue({ lat: 52.2, lng: 0.12 });
    expect(() => act(() => fakeMap.fire("moveend"))).not.toThrow();
    expect(addLink()).toHaveAttribute("href", "/loos/add?lat=52.2&lng=0.12&zoom=13");
  });
});
