/**
 * LooMap keeping the selected toilet in view (shared contract P1), the floating chrome
 * (developer controls gating, zoom buttons) and "Find a toilet near me".
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { useEffect } from "preact/hooks";
import { toast } from "toiletmap-design-system";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LooDetail } from "../../api/loos";
import LooMap from "./index";
import type { CompressedLoo, MapDataState } from "./useMapData";
import type { PanelLayout } from "./viewport";

const fakeMap = vi.hoisted(() => {
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
    getBounds: vi.fn(() => ({ contains: () => true })),
    on: vi.fn(() => m),
  };
  m.setView.mockReturnValue(m);
  return m;
});
const fakeLayers = vi.hoisted(() => [] as { kind: string; latlng: unknown; options: unknown }[]);
const mapOptions = vi.hoisted(() => ({ current: null as unknown }));
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
      map: (_el: unknown, options: unknown) => {
        mapOptions.current = options;
        return fakeMap;
      },
      tileLayer: () => ({ addTo: () => undefined }),
      marker: layer("marker"),
      circle: layer("circle"),
      divIcon: (options: unknown) => options,
    },
  };
});

const focusMarker = vi.hoisted(() => vi.fn(() => true));
vi.mock("./MapMarkers", () => ({
  default: function MapMarkersStub({
    data,
    onToiletSelect,
    focusMarkerRef,
  }: {
    data: CompressedLoo[];
    onToiletSelect: (loo: LooDetail) => void;
    focusMarkerRef?: { current: ((id: string) => boolean) | null };
  }) {
    if (focusMarkerRef) focusMarkerRef.current = focusMarker;
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

/**
 * What the stub panel was last rendered with, so tests can report layouts through it.
 * `firstLayout`, when set, is reported from the stub's mount effect, the way the real panel
 * reports its first measurement (before the map's fallback frame).
 */
const panel = vi.hoisted(() => ({
  props: null as null | {
    onLayoutChange?: (layout: PanelLayout) => void;
    userLocation?: { lat: number; lng: number } | null;
    onClose: () => void;
    toilet: { name: string };
  },
  firstLayout: null as null | PanelLayout,
}));
vi.mock("../ToiletDetailsPanel", () => ({
  default: function PanelStub(props: NonNullable<typeof panel.props>) {
    panel.props = props;
    useEffect(() => {
      if (panel.firstLayout) props.onLayoutChange?.(panel.firstLayout);
    }, []);
    return (
      <section data-testid="panel">
        <h2>{props.toilet.name}</h2>
        <button type="button" onClick={props.onClose}>
          Close
        </button>
      </section>
    );
  },
}));
vi.mock("../SettingsPanel", () => ({ default: () => null }));
vi.mock("../DevTools", () => ({ default: () => null }));

const mapState = vi.hoisted(() => ({ current: null as unknown as MapDataState }));
vi.mock("./useMapData", () => ({ useMapData: () => mapState.current }));

const getLooById = vi.hoisted(() => vi.fn());
vi.mock("../../api/loos", () => ({
  getLooById,
  getLooDetail: vi.fn(async () => ({ loo: null, fresh: false })),
  peekLooDetail: vi.fn(() => null),
}));

const looFor = (id: string): LooDetail =>
  ({
    id,
    name: `Toilet ${id}`,
    location: { lat: 51.5, lng: -0.1 },
    active: true,
    openingTimes: null,
  }) as unknown as LooDetail;

// A Pixel 7-ish map container (412×800 at the page origin) with the search bar across its top
// (12…68px) and, when open, a bottom sheet covering its last 300px.
const CONTAINER = { left: 0, top: 0, width: 412, height: 800 };
const rectOf = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

let sheetHeight = 300;
const ZERO = rectOf(0, 0, 0, 0);
function mockLayoutRects() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.id === "map") {
      return rectOf(CONTAINER.left, CONTAINER.top, CONTAINER.width, CONTAINER.height);
    }
    if (this.tagName === "SEARCH") return rectOf(12, 12, 388, 56);
    // The freshness notice, visually hidden while a panel is open: a 1px box, bottom left.
    if (
      this.classList.contains("map-freshness-notice") &&
      !this.classList.contains("map-freshness-notice--shown")
    )
      return rectOf(12, 767, 1, 1);
    if (this.dataset.testid === "panel") return rectOf(0, 800 - sheetHeight, 412, sheetHeight);
    // A toast, below the search bar: y 84…128.
    if (this.classList.contains("toast")) return rectOf(12, 84, 388, 44);
    return ZERO;
  });
}

const setReducedMotion = (reduce: boolean) => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query === "(prefers-reduced-motion: reduce)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
};

/** Lets the reveal's requestAnimationFrame run. */
const nextFrame = () =>
  act(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

beforeEach(() => {
  mapState.current = {
    data: [
      ["aaa", "gcpvj0", 1],
      ["bbb", "gcpvj1", 1],
    ],
    loading: false,
    status: "ok",
    lastSyncedAt: Date.now(),
    version: 1,
    lastChange: null,
    refresh: () => undefined,
  };
  getLooById.mockReset();
  getLooById.mockImplementation(async (_api: string, id: string) => looFor(id));
  for (const fn of Object.values(fakeMap)) if (vi.isMockFunction(fn)) fn.mockClear();
  fakeMap.getZoom.mockReturnValue(13);
  fakeLayers.length = 0;
  focusMarker.mockClear();
  panel.props = null;
  panel.firstLayout = null;
  sheetHeight = 300;
  setReducedMotion(false);
  mockLayoutRects();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  act(() => toast.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "geolocation");
});

// Padding the marker needs (see viewport.ts panPadding): the bar's 68px + 16px margin + the
// 44px icon above its tip; 16px + half the 28px icon at the sides; the sheet + 16px below.
const SIDE = 30;
const TOP = 128;

describe("LooMap keeps the selected marker in view", () => {
  it("centres a deep-linked toilet in the map left free by the bar and the panel", async () => {
    window.history.replaceState(null, "", "/loos/aaa");
    render(<LooMap apiUrl="" initialToiletId="aaa" />);
    await screen.findByRole("heading", { name: "Toilet aaa" });
    await waitFor(() => expect(fakeMap.panBy).toHaveBeenCalled());
    await nextFrame();

    expect(fakeMap.setView).toHaveBeenCalledWith([51.5, -0.1], 15, { animate: false });
    // Free area: y 128…484 (centre 306) in an 800px container (centre 400).
    expect(fakeMap.panBy).toHaveBeenCalledTimes(1);
    expect(fakeMap.panBy).toHaveBeenCalledWith([0, 94], { animate: false });
  });

  it("uses the layout the panel reports over its measured box", async () => {
    window.history.replaceState(null, "", "/loos/aaa");
    render(<LooMap apiUrl="" initialToiletId="aaa" />);
    await screen.findByRole("heading", { name: "Toilet aaa" });
    // The panel reports (from its ResizeObserver) before the map's own fallback frame.
    act(() =>
      panel.props?.onLayoutChange?.({
        mode: "sheet",
        state: "peek",
        occludes: { top: 0, right: 0, bottom: 200, left: 0 },
      }),
    );
    await nextFrame();
    // Free area: y 128…584, centre 356.
    expect(fakeMap.panBy).toHaveBeenCalledTimes(1);
    expect(fakeMap.panBy).toHaveBeenCalledWith([0, 44], { animate: false });
  });

  it("pans just enough when a marker is tapped (measuring the panel until it reports)", async () => {
    const user = userEvent.setup();
    render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker bbb" }));
    await screen.findByRole("heading", { name: "Toilet bbb" });
    await waitFor(() => expect(fakeMap.panInside).toHaveBeenCalled());
    await nextFrame();

    expect(fakeMap.panBy).not.toHaveBeenCalled();
    expect(fakeMap.panInside).toHaveBeenCalledTimes(1);
    expect(fakeMap.panInside).toHaveBeenLastCalledWith([51.5, -0.1], {
      paddingTopLeft: [SIDE, TOP],
      paddingBottomRight: [SIDE, 316],
      animate: true,
    });
  });

  // The panel opens expanded: its first report is the expanded size (the sheet's 70% cap of
  // this 800px map). The measured box stays the default 300px sheet, so a pan from the
  // measurement instead would show as 316 below.
  const EXPANDED_SHEET: PanelLayout = {
    mode: "sheet",
    state: "expanded",
    occludes: { top: 0, right: 0, bottom: 560, left: 0 },
  };

  it("keeps a tapped marker above the expanded sheet from the first open, and on collapse", async () => {
    panel.firstLayout = EXPANDED_SHEET;
    const user = userEvent.setup();
    render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker bbb" }));
    await screen.findByRole("heading", { name: "Toilet bbb" });
    await waitFor(() => expect(fakeMap.panInside).toHaveBeenCalled());
    await nextFrame();

    // One pan, already clear of the 70% sheet: never a peek-sized pan first.
    expect(fakeMap.panBy).not.toHaveBeenCalled();
    expect(fakeMap.panInside).toHaveBeenCalledTimes(1);
    expect(fakeMap.panInside).toHaveBeenLastCalledWith([51.5, -0.1], {
      paddingTopLeft: [SIDE, TOP],
      paddingBottomRight: [SIDE, 576],
      animate: true,
    });

    // Sub-pixel jitter from the ResizeObserver doesn't move the map again.
    act(() =>
      panel.props?.onLayoutChange?.({
        ...EXPANDED_SHEET,
        occludes: { ...EXPANDED_SHEET.occludes, bottom: 561 },
      }),
    );
    expect(fakeMap.panInside).toHaveBeenCalledTimes(1);

    // Collapsed to the summary: re-checked against the smaller sheet.
    act(() =>
      panel.props?.onLayoutChange?.({
        mode: "sheet",
        state: "peek",
        occludes: { top: 0, right: 0, bottom: 200, left: 0 },
      }),
    );
    expect(fakeMap.panInside).toHaveBeenCalledTimes(2);
    expect(fakeMap.panInside).toHaveBeenLastCalledWith([51.5, -0.1], {
      paddingTopLeft: [SIDE, TOP],
      paddingBottomRight: [SIDE, 216],
      animate: true,
    });
  });

  it("keeps the marker clear of the expanded sheet when switching toilets", async () => {
    panel.firstLayout = EXPANDED_SHEET;
    const user = userEvent.setup();
    render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await screen.findByRole("heading", { name: "Toilet aaa" });
    await waitFor(() => expect(fakeMap.panInside).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Marker bbb" }));
    await screen.findByRole("heading", { name: "Toilet bbb" });
    await waitFor(() => expect(fakeMap.panInside).toHaveBeenCalledTimes(2));
    await nextFrame();
    expect(fakeMap.panInside).toHaveBeenCalledTimes(2);
    expect(fakeMap.panInside).toHaveBeenLastCalledWith([51.5, -0.1], {
      paddingTopLeft: [SIDE, TOP],
      paddingBottomRight: [SIDE, 576],
      animate: true,
    });
  });

  it("centres a deep-linked toilet above the expanded sheet it opens with", async () => {
    panel.firstLayout = EXPANDED_SHEET;
    window.history.replaceState(null, "", "/loos/aaa");
    render(<LooMap apiUrl="" initialToiletId="aaa" />);
    await screen.findByRole("heading", { name: "Toilet aaa" });
    await waitFor(() => expect(fakeMap.panBy).toHaveBeenCalled());
    await nextFrame();
    // Free area: y 128…224 (centre 176) in an 800px container (centre 400).
    expect(fakeMap.panBy).toHaveBeenCalledTimes(1);
    expect(fakeMap.panBy).toHaveBeenCalledWith([0, 224], { animate: false });
  });

  it("keeps a deep-linked toilet clear of the 'changes are live' toast it opens with", async () => {
    panel.firstLayout = EXPANDED_SHEET;
    window.history.replaceState(null, "", "/loos/aaa?saved=1");
    render(<LooMap apiUrl="" initialToiletId="aaa" />);
    await screen.findByRole("heading", { name: "Toilet aaa" });
    await screen.findByText("Thanks — your changes are live.");
    await waitFor(() => expect(fakeMap.panBy).toHaveBeenCalled());
    await nextFrame();
    // As above, but the free area starts below the toast: y 188…224 (centre 206).
    expect(fakeMap.panBy).toHaveBeenCalledTimes(1);
    expect(fakeMap.panBy).toHaveBeenCalledWith([0, 194], { animate: false });
  });

  it("ignores the freshness notice while it is hidden in the panel (no phantom left inset)", async () => {
    mapState.current = { ...mapState.current, status: "offline" };
    const user = userEvent.setup();
    render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await screen.findByRole("heading", { name: "Toilet aaa" });
    await waitFor(() => expect(fakeMap.panInside).toHaveBeenCalled());
    const notice = document.querySelector(".map-freshness-notice");
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).not.toHaveClass("map-freshness-notice--shown");
    expect(notice).not.toHaveAttribute("data-map-control");
    expect(fakeMap.panInside).toHaveBeenLastCalledWith([51.5, -0.1], {
      paddingTopLeft: [SIDE, TOP],
      paddingBottomRight: [SIDE, 316],
      animate: true,
    });
  });

  it("keeps the marker clear of the expanded desktop card on the left from the first open", async () => {
    panel.firstLayout = {
      mode: "card",
      state: "expanded",
      occludes: { top: 0, right: 0, bottom: 0, left: 412 - 100 },
    };
    const user = userEvent.setup();
    render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await screen.findByRole("heading", { name: "Toilet aaa" });
    await waitFor(() => expect(fakeMap.panInside).toHaveBeenCalled());
    await nextFrame();
    expect(fakeMap.panInside).toHaveBeenCalledTimes(1);
    expect(fakeMap.panInside).toHaveBeenLastCalledWith([51.5, -0.1], {
      paddingTopLeft: [312 + SIDE, TOP],
      paddingBottomRight: [SIDE, 16],
      animate: true,
    });
  });

  it("doesn't animate with reduced motion", async () => {
    setReducedMotion(true);
    const user = userEvent.setup();
    render(<LooMap apiUrl="" />);
    expect(mapOptions.current).toMatchObject({ zoomAnimation: false, fadeAnimation: false });
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await screen.findByRole("heading", { name: "Toilet aaa" });
    await waitFor(() =>
      expect(fakeMap.panInside).toHaveBeenLastCalledWith(
        [51.5, -0.1],
        expect.objectContaining({ animate: false }),
      ),
    );
  });

  it("re-selecting the same toilet (a revalidated copy) doesn't pan again", async () => {
    const user = userEvent.setup();
    render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await screen.findByRole("heading", { name: "Toilet aaa" });
    await waitFor(() => expect(fakeMap.panInside).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await nextFrame();
    await nextFrame();
    expect(fakeMap.panInside).toHaveBeenCalledTimes(1);
  });

  it("puts focus back on the toilet's marker when the panel closes", async () => {
    const user = userEvent.setup();
    render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await screen.findByRole("heading", { name: "Toilet aaa" });
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(focusMarker).toHaveBeenCalledWith("aaa"));
  });

  it("Escape in the search bar doesn't close the panel; elsewhere it does", async () => {
    const user = userEvent.setup();
    render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await screen.findByRole("heading", { name: "Toilet aaa" });

    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search for a location" }), {
      key: "Escape",
    });
    expect(screen.getByRole("heading", { name: "Toilet aaa" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("heading", { name: "Toilet aaa" }), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Toilet aaa" })).not.toBeInTheDocument(),
    );
  });

  it("Escape on the zoom and 'Add a toilet here' controls closes the panel", async () => {
    const user = userEvent.setup();
    render(<LooMap apiUrl="" />);
    for (const control of [
      () => screen.getByRole("button", { name: "Zoom in" }),
      () => screen.getByRole("link", { name: "Add a toilet here" }),
    ]) {
      await user.click(screen.getByRole("button", { name: "Marker aaa" }));
      await screen.findByRole("heading", { name: "Toilet aaa" });
      fireEvent.keyDown(control(), { key: "Escape" });
      await waitFor(() =>
        expect(screen.queryByRole("heading", { name: "Toilet aaa" })).not.toBeInTheDocument(),
      );
    }
  });

  it("Escape on the search bar's buttons closes the panel", async () => {
    const user = userEvent.setup();
    render(<LooMap apiUrl="" />);
    for (const name of [/^Filters/, "Find a toilet near me"]) {
      await user.click(screen.getByRole("button", { name: "Marker aaa" }));
      await screen.findByRole("heading", { name: "Toilet aaa" });
      fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Escape" });
      await waitFor(() =>
        expect(screen.queryByRole("heading", { name: "Toilet aaa" })).not.toBeInTheDocument(),
      );
    }
  });

  it("Escape with nothing focused closes the panel", async () => {
    const user = userEvent.setup();
    render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await screen.findByRole("heading", { name: "Toilet aaa" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Toilet aaa" })).not.toBeInTheDocument(),
    );
  });

  it("Escape outside the map (the page header's menu) leaves the panel open", async () => {
    const user = userEvent.setup();
    // The header and its menu drawer are siblings of the map, not inside it.
    const header = document.createElement("header");
    header.innerHTML = '<div class="drawer"><a href="/about">About</a></div>';
    document.body.insertBefore(header, document.body.firstChild);
    try {
      render(<LooMap apiUrl="" />);
      await user.click(screen.getByRole("button", { name: "Marker aaa" }));
      await screen.findByRole("heading", { name: "Toilet aaa" });
      fireEvent.keyDown(screen.getByRole("link", { name: "About" }), { key: "Escape" });
      await nextFrame();
      expect(screen.getByRole("heading", { name: "Toilet aaa" })).toBeInTheDocument();
      expect(window.location.pathname).toBe("/loos/aaa");
    } finally {
      header.remove();
    }
  });
});

describe("LooMap floating controls", () => {
  // Vitest runs as a dev build, where the developer controls always show.
  beforeEach(() => {
    vi.stubEnv("DEV", false);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hides the settings gear and developer tools in production", () => {
    render(<LooMap apiUrl="" />);
    expect(screen.queryByRole("button", { name: "Open settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Developer Tools" })).not.toBeInTheDocument();

    render(<LooMap apiUrl="" environment="production" />);
    expect(screen.queryByRole("button", { name: "Open settings" })).not.toBeInTheDocument();
  });

  it.each(["preview", "development"])(
    "shows them in %s, beside the search bar",
    async (environment) => {
      render(<LooMap apiUrl="" environment={environment} />);
      // Loaded on demand (see LooMap.devcontrols.test.tsx).
      const gear = await screen.findByRole("button", { name: "Open settings" });
      const devTools = screen.getByRole("button", { name: "Developer Tools" });
      // One group in the same flex row as the search bar, so they can't overlap it.
      const group = gear.parentElement;
      expect(group).toBe(devTools.parentElement);
      const search = document.querySelector('search[aria-label="Map search and filters"]');
      expect(search).not.toBeNull();
      expect(group?.parentElement).toBe(search?.parentElement);
    },
  );

  it("zooms with the + and − buttons, without animating under reduced motion", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(fakeMap.zoomIn).toHaveBeenCalledWith(1, { animate: true });
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(fakeMap.zoomOut).toHaveBeenCalledWith(1, { animate: true });
    unmount();

    setReducedMotion(true);
    render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(fakeMap.zoomIn).toHaveBeenLastCalledWith(1, { animate: false });
  });
});

describe("LooMap 'Find a toilet near me'", () => {
  type Success = (position: GeolocationPosition) => void;
  const stubGeolocation = () => {
    const watch: { success?: Success; failure?: (e: GeolocationPositionError) => void } = {};
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        watchPosition: vi.fn((success: Success, failure: (e: GeolocationPositionError) => void) => {
          watch.success = success;
          watch.failure = failure;
          return 7;
        }),
        clearWatch: vi.fn(),
      },
    });
    return watch;
  };
  const at = (latitude: number, longitude: number) =>
    ({ coords: { latitude, longitude, accuracy: 20 } }) as GeolocationPosition;

  it("centres on the viewer, shows the dot, follows them and tells the panel", async () => {
    const user = userEvent.setup();
    const watch = stubGeolocation();
    render(<LooMap apiUrl="" />);

    await user.click(screen.getByRole("button", { name: "Find a toilet near me" }));
    act(() => watch.success?.(at(52.2, 0.12)));
    expect(fakeMap.setView).toHaveBeenLastCalledWith([52.2, 0.12], 16, { animate: true });
    const dot = fakeLayers.find((l) => l.kind === "marker");
    expect(dot?.latlng).toEqual([52.2, 0.12]);
    expect(dot?.options).toMatchObject({ interactive: false, keyboard: false });

    // A later fix moves the dot but leaves the map where the user put it.
    fakeMap.setView.mockClear();
    act(() => watch.success?.(at(52.21, 0.13)));
    expect(dot?.latlng).toEqual([52.21, 0.13]);
    expect(fakeMap.setView).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Marker aaa" }));
    await screen.findByRole("heading", { name: "Toilet aaa" });
    expect(panel.props?.userLocation).toEqual({ lat: 52.21, lng: 0.13, accuracy: 20 });
  });

  it("shows why the location couldn't be found", async () => {
    const user = userEvent.setup();
    const watch = stubGeolocation();
    render(<LooMap apiUrl="" />);
    await user.click(screen.getByRole("button", { name: "Find a toilet near me" }));
    act(() => watch.failure?.({ code: 1 } as GeolocationPositionError));
    expect(screen.getByRole("alert")).toHaveTextContent(/Location access is blocked/);
  });
});
