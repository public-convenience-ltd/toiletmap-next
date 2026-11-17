import { act, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { useState } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { MAP_VIEW_STORAGE_KEY } from "../LooMap/mapView";
import type { LatLng } from "./geometry";
import LocationPicker, {
  BIG_MOVE_WARNING,
  type LocationPickerProps,
  MIN_CONFIRM_ZOOM,
  ZOOM_IN_MESSAGE,
} from "./LocationPicker";
import { describeMove } from "./LocationPicker/move";

/**
 * Leaflet does not run in happy-dom, so it is replaced with a fake that records every event
 * handler registered on the map, every layer added to it and every view change. That lets these
 * tests prove the toilet's location only changes when the user confirms it — never from
 * clicking, tapping or panning the map.
 */
type Handler = (e: unknown) => void;

const fake = vi.hoisted(() => {
  const toLatLng = (value: unknown) => {
    const [lat, lng] = Array.isArray(value)
      ? (value as [number, number])
      : [(value as { lat: number }).lat, (value as { lng: number }).lng];
    return { lat, lng };
  };

  /** Adds Leaflet-style `on`/`once`/`addEventListener` that record handlers per event name. */
  const withEvents = <T extends object>(target: T) => {
    const handlers = new Map<string, Handler[]>();
    const register = (events: string | Record<string, Handler>, fn?: Handler) => {
      const entries: [string, Handler][] =
        typeof events === "string"
          ? events
              .split(/\s+/)
              .filter(Boolean)
              .map((name) => [name, fn as Handler])
          : Object.entries(events);
      for (const [name, handler] of entries) {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      }
      return api;
    };
    const api = Object.assign(target, {
      handlers,
      on: vi.fn(register),
      once: vi.fn(register),
      addEventListener: vi.fn(register),
      off: vi.fn(() => api),
      fire(name: string, event: Record<string, unknown> = {}) {
        for (const h of handlers.get(name) ?? []) h({ type: name, target: api, ...event });
        return api;
      },
    });
    return api;
  };

  const state = {
    center: toLatLng([51.5, -0.12]),
    zoom: 13,
  };

  const handler = (enabled: boolean) => {
    const h = {
      on: enabled,
      enable: vi.fn(() => {
        h.on = true;
        return h;
      }),
      disable: vi.fn(() => {
        h.on = false;
        return h;
      }),
      enabled: () => h.on,
    };
    return h;
  };

  const createMap = (options: Record<string, unknown> = {}) => {
    const flag = (name: string) => options[name] !== false;
    const map = withEvents({
      options,
      dragging: handler(flag("dragging")),
      touchZoom: handler(flag("touchZoom")),
      scrollWheelZoom: handler(flag("scrollWheelZoom")),
      doubleClickZoom: handler(flag("doubleClickZoom")),
      boxZoom: handler(flag("boxZoom")),
      keyboard: handler(flag("keyboard")),
      layers: [] as unknown[],
      setView: vi.fn((latLng: unknown, zoom?: number) => {
        state.center = toLatLng(latLng);
        const zoomed = typeof zoom === "number" && zoom !== state.zoom;
        if (typeof zoom === "number") state.zoom = zoom;
        map.fire("movestart").fire("move");
        if (zoomed) map.fire("zoomend");
        map.fire("moveend");
        return map;
      }),
      setZoom: vi.fn((zoom: number) => {
        state.zoom = zoom;
        map.fire("move").fire("zoomend").fire("moveend");
        return map;
      }),
      fitBounds: vi.fn(() => map),
      flyTo: vi.fn(() => map),
      panTo: vi.fn(() => map),
      getCenter: vi.fn(() => state.center),
      getZoom: vi.fn(() => state.zoom),
      getSize: vi.fn(() => ({ x: 400, y: 300 })),
      latLngToContainerPoint: vi.fn(() => ({ x: 200, y: 150 })),
      addLayer: vi.fn((layer: unknown) => {
        map.layers.push(layer);
        return map;
      }),
      remove: vi.fn(),
    });
    return map;
  };

  type FakeMap = ReturnType<typeof createMap>;

  /** Something `addTo(map)`-able that remembers whether it is on the map. */
  const layer = <T extends object>(extra: T) => {
    const self = Object.assign(extra, {
      onMap: false,
      addTo: vi.fn((target: { addLayer?: (l: unknown) => unknown }) => {
        self.onMap = true;
        target.addLayer?.(self);
        return self;
      }),
      remove: vi.fn(() => {
        self.onMap = false;
        return self;
      }),
    });
    return self;
  };

  const createMarker = (initial: unknown, options: Record<string, unknown> = {}) => {
    let latLng = toLatLng(initial);
    const marker = layer(
      withEvents({
        options,
        setLatLng: vi.fn((value: unknown) => {
          latLng = toLatLng(value);
          return marker;
        }),
        getLatLng: vi.fn(() => latLng),
      }),
    );
    return marker;
  };

  const createLayerGroup = () => {
    const group = layer({
      children: [] as { latLng: { lat: number; lng: number }; options: Record<string, unknown> }[],
      addLayer: vi.fn((child: unknown) => {
        group.children.push(
          child as { latLng: { lat: number; lng: number }; options: Record<string, unknown> },
        );
        return group;
      }),
      clearLayers: vi.fn(() => {
        group.children.length = 0;
        return group;
      }),
    });
    return group;
  };

  return {
    state,
    toLatLng,
    maps: [] as FakeMap[],
    containers: [] as HTMLElement[],
    markers: [] as ReturnType<typeof createMarker>[],
    groups: [] as ReturnType<typeof createLayerGroup>[],
    zoomControls: [] as ReturnType<typeof layer>[],
    createMap,
    createMarker,
    createLayerGroup,
    layer,
  };
});

vi.mock("leaflet", () => {
  const L = {
    Icon: { Default: { prototype: {}, mergeOptions: vi.fn() } },
    map: vi.fn((container: HTMLElement, options?: Record<string, unknown>) => {
      const map = fake.createMap(options);
      fake.maps.push(map);
      fake.containers.push(container);
      return map;
    }),
    tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
    marker: vi.fn((latLng: unknown, options?: Record<string, unknown>) => {
      const marker = fake.createMarker(latLng, options);
      fake.markers.push(marker);
      return marker;
    }),
    divIcon: vi.fn((options: Record<string, unknown>) => ({ divIcon: true, options })),
    layerGroup: vi.fn(() => {
      const group = fake.createLayerGroup();
      fake.groups.push(group);
      return group;
    }),
    circleMarker: vi.fn((latLng: unknown, options: Record<string, unknown>) =>
      fake.layer({ latLng: fake.toLatLng(latLng), options }),
    ),
    control: {
      zoom: vi.fn(() => {
        const control = fake.layer({});
        fake.zoomControls.push(control);
        return control;
      }),
    },
  };
  return { default: L, ...L };
});

/** Every pointer-style event that, if handled on the map, could be used to move the pin. */
const POINTER_EVENTS = [
  "click",
  "dblclick",
  "preclick",
  "contextmenu",
  "tap",
  "mousedown",
  "mouseup",
  "touchstart",
  "touchend",
  "pointerdown",
  "pointerup",
];

/** DOM events dispatched on the map's container element, in case anything listens there directly. */
const DOM_EVENTS = [
  "click",
  "dblClick",
  "pointerDown",
  "pointerUp",
  "mouseDown",
  "mouseUp",
  "touchStart",
  "touchEnd",
] as const;

const ORIGINAL = { lat: 51.501234567, lng: -0.141234567 };
const M_PER_DEG_LAT = 111_195;
/** A point `north` and `east` metres from `from` (flat-earth approximation, fine at these scales). */
const offset = (from: LatLng, north: number, east: number): LatLng => ({
  lat: from.lat + north / M_PER_DEG_LAT,
  lng: from.lng + east / (M_PER_DEG_LAT * Math.cos((from.lat * Math.PI) / 180)),
});

const theMap = () => {
  expect(fake.maps).toHaveLength(1);
  return fake.maps[0];
};

/** Simulates the user panning (and optionally zooming) the map to `to`. */
const pan = (to: LatLng, zoom?: number) => {
  const map = theMap();
  act(() => {
    fake.state.center = fake.toLatLng(to);
    map.fire("movestart").fire("move");
    if (zoom !== undefined && zoom !== fake.state.zoom) {
      fake.state.zoom = zoom;
      map.fire("zoomend");
    }
    map.fire("moveend");
  });
};

const pinMarkers = () =>
  fake.markers.filter(
    (m) =>
      m.onMap &&
      !String(
        (m.options.icon as { options?: { className?: string } })?.options?.className,
      ).includes("muted"),
  );
const ghostMarkers = () =>
  fake.markers.filter(
    (m) =>
      m.onMap &&
      String((m.options.icon as { options?: { className?: string } })?.options?.className).includes(
        "muted",
      ),
  );
const nearbyDots = () => fake.groups.flatMap((g) => g.children);

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const queryButton = (name: string | RegExp) => screen.queryByRole("button", { name });

/** Renders the picker with a real parent holding the location, as LooForm does. */
function Harness({
  initial,
  onChange,
  ...props
}: Partial<Omit<LocationPickerProps, "onChange">> & { initial: LatLng | null; onChange: Mock }) {
  const [location, setLocation] = useState<LatLng | null>(initial);
  return (
    <LocationPicker
      mode="edit"
      apiUrl=""
      {...props}
      location={location}
      onChange={(lat, lng) => {
        onChange(lat, lng);
        setLocation({ lat, lng });
      }}
    />
  );
}

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

let fetchMock: Mock<typeof fetch>;
/** Rows the fake `/api/loos/proximity` returns. */
let proximityRows: unknown[];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const proximityCalls = () =>
  fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes("/api/loos/proximity"));

beforeEach(() => {
  fake.maps.length = 0;
  fake.containers.length = 0;
  fake.markers.length = 0;
  fake.groups.length = 0;
  fake.zoomControls.length = 0;
  fake.state.center = fake.toLatLng([51.5, -0.12]);
  fake.state.zoom = 13;
  proximityRows = [];
  fetchMock = vi.fn<typeof fetch>((input) => {
    const url = String(input);
    if (url.includes("/api/loos/proximity")) {
      return Promise.resolve(json({ data: proximityRows, count: 0 }));
    }
    return Promise.resolve(json([]));
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LocationPicker: never moves by accident", () => {
  it.each([
    ["locked", false],
    ["moving", true],
  ])("registers no click/tap/press handler on the map (%s)", async (_label, startMoving) => {
    const user = userEvent.setup();
    render(
      <LocationPicker
        mode="edit"
        apiUrl=""
        location={ORIGINAL}
        onChange={vi.fn()}
        originalLocation={ORIGINAL}
      />,
    );
    if (startMoving) await user.click(button("Move pin"));

    const registered = [...theMap().handlers.keys()];
    expect(registered.length).toBeGreaterThan(0); // sanity: the view listeners exist
    for (const event of POINTER_EVENTS) {
      expect(registered, `map has a "${event}" handler`).not.toContain(event);
    }
  });

  it.each([
    ["edit, locked", ORIGINAL, false],
    ["edit, moving", ORIGINAL, true],
    ["add, no pin", null, false],
  ])(
    "never changes the location from any map event (%s)",
    async (_label, location, startMoving) => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <LocationPicker
          mode={location ? "edit" : "add"}
          apiUrl=""
          location={location}
          originalLocation={location}
          onChange={onChange}
        />,
      );
      if (startMoving) await user.click(button("Move pin"));
      const map = theMap();
      for (const marker of fake.markers) marker.setLatLng.mockClear();

      const latlng = fake.toLatLng([51.7, -0.3]);
      const names = new Set([...map.handlers.keys(), ...POINTER_EVENTS]);
      act(() => {
        for (const name of names) {
          map.fire(name, {
            latlng,
            containerPoint: { x: 10, y: 10 },
            layerPoint: { x: 10, y: 10 },
          });
        }
      });

      // And the real DOM events, on the element the map was created on (and so bubbling from it).
      const container = fake.containers[0];
      expect(container).toBeInstanceOf(HTMLElement);
      expect(container.isConnected).toBe(true);
      const at = { clientX: 10, clientY: 10, bubbles: true };
      for (const name of DOM_EVENTS) {
        if (name.startsWith("touch")) {
          fireEvent[name](container, { touches: [at], changedTouches: [at] });
        } else {
          fireEvent[name](container, at);
        }
      }

      expect(onChange).not.toHaveBeenCalled();
      for (const marker of fake.markers) expect(marker.setLatLng).not.toHaveBeenCalled();
    },
  );

  it("panning while moving changes nothing until 'Use this location'", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={ORIGINAL} originalLocation={ORIGINAL} onChange={onChange} />);
    await user.click(button("Move pin"));

    pan(offset(ORIGINAL, 20, 0));
    pan(offset(ORIGINAL, 0, 30));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("LocationPicker: edit mode", () => {
  it("opens as a locked preview with the brand pin", () => {
    render(
      <LocationPicker
        mode="edit"
        apiUrl=""
        location={ORIGINAL}
        originalLocation={ORIGINAL}
        onChange={vi.fn()}
      />,
    );
    const map = theMap();

    for (const name of [
      "dragging",
      "touchZoom",
      "scrollWheelZoom",
      "doubleClickZoom",
      "boxZoom",
      "keyboard",
    ] as const) {
      expect(map[name].enabled(), `${name} is enabled`).toBe(false);
    }
    expect(fake.zoomControls).toHaveLength(0);
    expect(map.setView).toHaveBeenCalledWith([ORIGINAL.lat, ORIGINAL.lng], 17);

    const pins = pinMarkers();
    expect(pins).toHaveLength(1);
    expect(pins[0].getLatLng()).toEqual({ lat: ORIGINAL.lat, lng: ORIGINAL.lng });
    const icon = pins[0].options.icon as { divIcon: boolean; options: { html: string } };
    expect(icon.divIcon).toBe(true);
    expect(icon.options.html).toContain("#ED3D63");
    expect(pins[0].options.interactive).toBe(false);
    expect(ghostMarkers()).toHaveLength(0);

    expect(button("Move pin")).toBeInTheDocument();
    expect(queryButton("Use this location")).toBeNull();
    expect(queryButton("Reset to original location")).toBeNull();
  });

  it("no longer overrides Leaflet's default (unpkg) marker icon", async () => {
    const L = (await import("leaflet")).default as unknown as {
      Icon: { Default: { mergeOptions: Mock } };
    };
    render(<LocationPicker mode="edit" apiUrl="" location={ORIGINAL} onChange={vi.fn()} />);
    expect(L.Icon.Default.mergeOptions).not.toHaveBeenCalled();
    for (const marker of fake.markers) expect(marker.options.icon).toBeDefined();
  });

  it("'Move pin' unlocks the map, shows the ghost and centre pin, and focuses the map", async () => {
    const user = userEvent.setup();
    render(
      <LocationPicker
        mode="edit"
        apiUrl=""
        location={ORIGINAL}
        originalLocation={ORIGINAL}
        onChange={vi.fn()}
      />,
    );

    await user.click(button("Move pin"));
    const map = theMap();

    expect(map.dragging.enabled()).toBe(true);
    expect(map.touchZoom.enabled()).toBe(true);
    expect(map.keyboard.enabled()).toBe(true);
    expect(fake.zoomControls).toHaveLength(1);
    expect(fake.zoomControls[0].onMap).toBe(true);
    // The locked pin gives way to the fixed centre pin; the ghost marks the saved spot.
    expect(pinMarkers()).toHaveLength(0);
    const ghosts = ghostMarkers();
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].getLatLng()).toEqual({ lat: ORIGINAL.lat, lng: ORIGINAL.lng });
    expect(document.activeElement).toBe(fake.containers[0]);
    expect(button("Use this location")).toBeEnabled();
    expect(button("Cancel")).toBeInTheDocument();
  });

  it("shows a live 'Moved 23 m north-east' chip as the map pans", async () => {
    const user = userEvent.setup();
    render(
      <LocationPicker
        mode="edit"
        apiUrl=""
        location={ORIGINAL}
        originalLocation={ORIGINAL}
        onChange={vi.fn()}
      />,
    );
    await user.click(button("Move pin"));

    const to = offset(ORIGINAL, 16.3, 16.3);
    expect(describeMove(ORIGINAL, to).label).toBe("Moved 23 m north-east");
    pan(to);
    expect(screen.getByText("Moved 23 m north-east")).toBeInTheDocument();

    pan(offset(ORIGINAL, -40, 0));
    expect(screen.getByText("Moved 40 m south")).toBeInTheDocument();
  });

  it("'Use this location' sends the centre (6 dp) and locks the pin there", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={ORIGINAL} originalLocation={ORIGINAL} onChange={onChange} />);
    await user.click(button("Move pin"));
    const to = { lat: 51.50140123456, lng: -0.14109876543 };
    pan(to);

    await user.click(button("Use this location"));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith(51.501401, -0.141099);
    expect(await screen.findByRole("button", { name: "Move pin" })).toHaveFocus();
    expect(theMap().dragging.enabled()).toBe(false);
    expect(fake.zoomControls[0].onMap).toBe(false);
    const pins = pinMarkers();
    expect(pins).toHaveLength(1);
    expect(pins[0].getLatLng()).toEqual({ lat: 51.501401, lng: -0.141099 });
    // The saved spot stays visible while the pin is away from it, and can be restored.
    expect(ghostMarkers()).toHaveLength(1);
    expect(button("Reset to original location")).toBeInTheDocument();
  });

  it("Cancel keeps the pin where it was and re-centres the map on it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={ORIGINAL} originalLocation={ORIGINAL} onChange={onChange} />);
    await user.click(button("Move pin"));
    pan(offset(ORIGINAL, 100, 100));

    await user.click(button("Cancel"));

    expect(onChange).not.toHaveBeenCalled();
    expect(theMap().setView).toHaveBeenLastCalledWith([ORIGINAL.lat, ORIGINAL.lng], 17, {
      animate: false,
    });
    expect(theMap().dragging.enabled()).toBe(false);
    expect(button("Move pin")).toHaveFocus();
    expect(ghostMarkers()).toHaveLength(0);
  });

  it("reset while moving puts the pin back and ends the move, with no change sent", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={ORIGINAL} originalLocation={ORIGINAL} onChange={onChange} />);
    await user.click(button("Move pin"));
    pan(offset(ORIGINAL, 30, 0), 18);

    await user.click(button("Reset to original location"));
    expect(theMap().setView).toHaveBeenCalledWith([ORIGINAL.lat, ORIGINAL.lng], 18, {
      animate: false,
    });
    // No second "Use this location" needed: back in the locked preview, focus on Move pin.
    expect(queryButton("Use this location")).toBeNull();
    expect(button("Move pin")).toHaveFocus();
    expect(theMap().dragging.enabled()).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent(
      "The pin is back at the original location.",
    );
    expect(queryButton("Reset to original location")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("returning to the original after a confirmed move sends the exact original back", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={ORIGINAL} originalLocation={ORIGINAL} onChange={onChange} />);
    await user.click(button("Move pin"));
    pan(offset(ORIGINAL, 30, 0));
    await user.click(button("Use this location"));
    await screen.findByRole("button", { name: "Move pin" });

    // Locked: reset straight away, keeping focus in the picker (the Reset button goes away).
    await user.click(button("Reset to original location"));
    expect(onChange).toHaveBeenLastCalledWith(ORIGINAL.lat, ORIGINAL.lng);
    expect(queryButton("Reset to original location")).toBeNull();
    expect(button("Move pin")).toHaveFocus();

    // Moving: reset sends the original straight away too.
    await user.click(button("Move pin"));
    pan(offset(ORIGINAL, 0, 25));
    await user.click(button("Use this location"));
    await screen.findByRole("button", { name: "Move pin" });
    await user.click(button("Move pin"));
    onChange.mockClear();
    await user.click(button("Reset to original location"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(ORIGINAL.lat, ORIGINAL.lng);
    expect(button("Move pin")).toHaveFocus();
  });

  it("warns about a move over 50 m and offers to add a new toilet instead", async () => {
    const user = userEvent.setup();
    render(
      <LocationPicker
        mode="edit"
        apiUrl=""
        location={ORIGINAL}
        originalLocation={ORIGINAL}
        onChange={vi.fn()}
      />,
    );
    await user.click(button("Move pin"));

    pan(offset(ORIGINAL, 45, 0));
    expect(screen.queryByText(BIG_MOVE_WARNING)).toBeNull();

    const far = offset(ORIGINAL, 60, 0);
    pan(far, 17);
    expect(screen.getByText(BIG_MOVE_WARNING)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Add as a new toilet instead" });
    const href = new URL(link.getAttribute("href") ?? "", "https://example.test");
    expect(href.pathname).toBe("/loos/add");
    expect(Number(href.searchParams.get("lat"))).toBeCloseTo(far.lat, 6);
    expect(Number(href.searchParams.get("lng"))).toBeCloseTo(far.lng, 6);
    expect(href.searchParams.get("zoom")).toBe("17");
    // Still a single confirm.
    expect(button("Use this location")).toBeEnabled();
  });

  it("starts moving (with no ghost) when the toilet has no location yet", () => {
    render(
      <LocationPicker
        mode="edit"
        apiUrl=""
        location={null}
        originalLocation={null}
        onChange={vi.fn()}
      />,
    );
    expect(theMap().dragging.enabled()).toBe(true);
    expect(ghostMarkers()).toHaveLength(0);
    expect(queryButton("Cancel")).toBeNull();
  });

  it("tells the form when a move is in progress", async () => {
    const user = userEvent.setup();
    const onMovingChange = vi.fn();
    render(
      <Harness
        initial={ORIGINAL}
        originalLocation={ORIGINAL}
        onChange={vi.fn()}
        onMovingChange={onMovingChange}
      />,
    );
    expect(onMovingChange).toHaveBeenLastCalledWith(false);
    await user.click(button("Move pin"));
    expect(onMovingChange).toHaveBeenLastCalledWith(true);
    await user.click(button("Cancel"));
    expect(onMovingChange).toHaveBeenLastCalledWith(false);
  });
});

describe("LocationPicker: add mode", () => {
  it("opens at the initial view, moving, with confirm gated on zoom 17", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        mode="add"
        initial={null}
        onChange={onChange}
        initialView={{ lat: 53.48, lng: -2.24, zoom: 15 }}
      />,
    );
    const map = theMap();
    expect(map.setView).toHaveBeenCalledWith([53.48, -2.24], 15);
    expect(map.dragging.enabled()).toBe(true);
    expect(pinMarkers()).toHaveLength(0);

    expect(button("Use this location")).toBeDisabled();
    expect(screen.getByText(ZOOM_IN_MESSAGE, { exact: false })).toBeInTheDocument();

    await user.click(button("Zoom in"));
    expect(map.setZoom).toHaveBeenCalledWith(MIN_CONFIRM_ZOOM);
    expect(button("Use this location")).toBeEnabled();
    expect(screen.queryByText(ZOOM_IN_MESSAGE, { exact: false })).toBeNull();

    await user.click(button("Use this location"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(53.48, -2.24));
    expect(await screen.findByRole("button", { name: "Move pin" })).toHaveFocus();
    expect(pinMarkers()).toHaveLength(1);
  });

  it("re-gates confirm when the user zooms back out", () => {
    render(
      <LocationPicker
        mode="add"
        apiUrl=""
        location={null}
        onChange={vi.fn()}
        initialView={{ lat: 51.5, lng: -0.12, zoom: 18 }}
      />,
    );
    expect(button("Use this location")).toBeEnabled();
    pan({ lat: 51.5, lng: -0.12 }, 16);
    expect(button("Use this location")).toBeDisabled();
  });

  it("opens at ?lat&lng&zoom from the page URL", () => {
    window.history.replaceState(null, "", "/loos/add?lat=52.2&lng=0.12&zoom=18");
    render(<LocationPicker mode="add" apiUrl="" location={null} onChange={vi.fn()} />);
    expect(theMap().setView).toHaveBeenCalledWith([52.2, 0.12], 18);
  });

  it("otherwise opens at the main map's last view", () => {
    localStorage.setItem(
      MAP_VIEW_STORAGE_KEY,
      JSON.stringify({ lat: 55.95, lng: -3.19, zoom: 14 }),
    );
    render(<LocationPicker mode="add" apiUrl="" location={null} onChange={vi.fn()} />);
    expect(theMap().setView).toHaveBeenCalledWith([55.95, -3.19], 14);
  });

  it("falls back to central London", () => {
    render(<LocationPicker mode="add" apiUrl="" location={null} onChange={vi.fn()} />);
    expect(theMap().setView).toHaveBeenCalledWith([51.505, -0.09], 13);
  });

  it("has no ghost, chip or reset", () => {
    render(
      <LocationPicker
        mode="add"
        apiUrl=""
        location={null}
        onChange={vi.fn()}
        initialView={{ lat: 51.5, lng: -0.12, zoom: 17 }}
      />,
    );
    pan({ lat: 51.501, lng: -0.12 });
    expect(ghostMarkers()).toHaveLength(0);
    expect(screen.queryByText(/^Moved /)).toBeNull();
    expect(queryButton("Reset to original location")).toBeNull();
  });
});

describe("LocationPicker: nearby toilets", () => {
  const SPOT = { lat: 51.5, lng: -0.12 };
  const near = (north: number, extra: Record<string, unknown> = {}) => ({
    id: `loo-${north}`,
    name: "Station toilets",
    location: offset(SPOT, north, 0),
    active: true,
    distance: north,
    ...extra,
  });

  const renderAdd = (props: Partial<Omit<LocationPickerProps, "onChange">> = {}) => {
    const onChange = vi.fn();
    render(
      <Harness
        mode="add"
        initial={null}
        onChange={onChange}
        apiUrl="https://api.test"
        initialView={{ ...SPOT, zoom: 18 }}
        {...props}
      />,
    );
    return onChange;
  };

  it("fetches removed ones too, excluding the toilet being edited", async () => {
    const user = userEvent.setup();
    render(
      <LocationPicker
        mode="edit"
        apiUrl="https://api.test"
        excludeId="abc123"
        location={SPOT}
        originalLocation={SPOT}
        onChange={vi.fn()}
      />,
    );
    expect(proximityCalls()).toHaveLength(0); // not while locked
    await user.click(button("Move pin"));

    await waitFor(() => expect(proximityCalls()).toHaveLength(1));
    const url = new URL(proximityCalls()[0]);
    expect(url.origin + url.pathname).toBe("https://api.test/api/loos/proximity");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      lat: "51.5",
      lng: "-0.12",
      radius: "150",
      includeInactive: "true",
      exclude: "abc123",
    });
  });

  it("draws grey dots (hollow when removed), only from zoom 15, and clears them when locked", async () => {
    const user = userEvent.setup();
    proximityRows = [near(80), near(100, { id: "gone", active: false })];
    render(<Harness initial={SPOT} originalLocation={SPOT} onChange={vi.fn()} />);
    await user.click(button("Move pin"));

    await waitFor(() => expect(nearbyDots()).toHaveLength(2));
    const [active, removed] = nearbyDots();
    expect(active.options.fillOpacity).toBeGreaterThan(0);
    expect(removed.options.fillOpacity).toBe(0);
    expect(active.options.interactive).toBe(false);

    await user.click(button("Cancel"));
    expect(nearbyDots()).toHaveLength(0);

    await user.click(button("Move pin"));
    await waitFor(() => expect(nearbyDots()).toHaveLength(2));
    const calls = proximityCalls().length;
    pan(offset(SPOT, 500, 0), 14);
    expect(nearbyDots()).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(proximityCalls()).toHaveLength(calls);
  });

  it("asks before adding a toilet next to an existing one", async () => {
    const user = userEvent.setup();
    proximityRows = [near(8, { id: "dup1" })];
    const onEditExisting = vi.fn();
    const onChange = renderAdd({ onEditExisting });

    await user.click(button("Use this location"));

    const prompt = await screen.findByRole("group", { name: /There's already a toilet/ });
    expect(prompt).toHaveTextContent(
      "There's already a toilet 8 m away: Station toilets. Is it the same one?",
    );
    expect(prompt).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    expect(queryButton("Use this location")).toBeNull();

    await user.click(button("Edit that toilet"));
    expect(onEditExisting).toHaveBeenCalledWith("dup1");
    expect(onChange).not.toHaveBeenCalled();

    await user.click(button("No, this is a different toilet"));
    expect(onChange).toHaveBeenCalledWith(51.5, -0.12);
    expect(await screen.findByRole("button", { name: "Move pin" })).toBeInTheDocument();
  });

  it("offers to restore a removed toilet recorded close by", async () => {
    const user = userEvent.setup();
    proximityRows = [near(8, { id: "old1", active: false, name: "Old toilets" })];
    const onRestoreExisting = vi.fn();
    const onChange = renderAdd({ onRestoreExisting });

    await user.click(button("Use this location"));
    await screen.findByText(
      "A removed toilet was recorded 8 m away. Is this the same toilet, back again?",
    );

    await user.click(button("Restore it"));
    expect(onRestoreExisting).toHaveBeenCalledWith("old1");

    await user.click(button("No, this is a different toilet"));
    expect(onChange).toHaveBeenCalledWith(51.5, -0.12);
  });

  it("prefers an active match over a nearer removed one", async () => {
    const user = userEvent.setup();
    proximityRows = [near(5, { id: "old", active: false }), near(20, { id: "live" })];
    renderAdd();
    await user.click(button("Use this location"));
    await screen.findByText(/There's already a toilet 20 m away/);
  });

  it("links to the existing toilet when no callback is given", async () => {
    const user = userEvent.setup();
    proximityRows = [near(8, { id: "dup1" })];
    renderAdd();
    await user.click(button("Use this location"));
    expect(await screen.findByRole("link", { name: "Edit that toilet" })).toHaveAttribute(
      "href",
      "/loos/dup1/edit",
    );
  });

  it("names an unnamed toilet sensibly", async () => {
    const user = userEvent.setup();
    proximityRows = [near(12, { name: null })];
    renderAdd();
    await user.click(button("Use this location"));
    const prompt = await screen.findByRole("group", { name: /There's already a toilet/ });
    expect(prompt).toHaveTextContent("There's already a toilet 12 m away: an unnamed toilet.");
  });

  it("doesn't ask about toilets more than 30 m away, or the toilet itself", async () => {
    const user = userEvent.setup();
    proximityRows = [near(35), near(0, { id: "self" })];
    const onChange = vi.fn();
    render(<Harness initial={SPOT} originalLocation={SPOT} excludeId="self" onChange={onChange} />);
    await user.click(button("Move pin"));
    pan(offset(SPOT, 2, 0), 18);
    await user.click(button("Use this location"));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/There's already a toilet/)).toBeNull();
  });

  describe("editing a toilet with a neighbour 10 m away", () => {
    const neighbour = () => near(10, { id: "next-door", name: "Women's toilets" });

    it("confirms an unmoved pin straight away, without asking", async () => {
      const user = userEvent.setup();
      proximityRows = [neighbour()];
      const onChange = vi.fn();
      render(<Harness initial={SPOT} originalLocation={SPOT} onChange={onChange} />);
      await user.click(button("Move pin"));
      act(() => {
        theMap().setZoom(18);
      });
      await waitFor(() => expect(nearbyDots()).toHaveLength(1));

      await user.click(button("Use this location"));
      expect(await screen.findByRole("button", { name: "Move pin" })).toBeInTheDocument();
      expect(screen.queryByText(/There's already a toilet/)).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
    });

    it("doesn't ask after a nudge away from the neighbour", async () => {
      const user = userEvent.setup();
      proximityRows = [neighbour()];
      const onChange = vi.fn();
      render(<Harness initial={SPOT} originalLocation={SPOT} onChange={onChange} />);
      await user.click(button("Move pin"));
      pan(offset(SPOT, -3, 0), 18);
      await user.click(button("Use this location"));
      await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(/There's already a toilet/)).toBeNull();
    });

    it("asks when the pin is moved onto the neighbour", async () => {
      const user = userEvent.setup();
      proximityRows = [neighbour()];
      const onChange = vi.fn();
      render(<Harness initial={SPOT} originalLocation={SPOT} onChange={onChange} />);
      await user.click(button("Move pin"));
      pan(offset(SPOT, 9, 0), 18);
      await user.click(button("Use this location"));
      expect(
        await screen.findByRole("group", { name: /There's already a toilet 1 m away/ }),
      ).toHaveTextContent("Women's toilets");
      expect(onChange).not.toHaveBeenCalled();
    });

    it("never offers to restore a removed toilet", async () => {
      const user = userEvent.setup();
      proximityRows = [near(10, { id: "gone", active: false })];
      const onChange = vi.fn();
      render(<Harness initial={SPOT} originalLocation={SPOT} onChange={onChange} />);
      await user.click(button("Move pin"));
      pan(offset(SPOT, 9, 0), 18);
      await user.click(button("Use this location"));
      await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(/A removed toilet/)).toBeNull();
      expect(queryButton("Restore it")).toBeNull();
    });
  });

  it("still confirms when the lookup fails", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(() => Promise.resolve(json({ message: "nope" }, 500)));
    const onChange = renderAdd();
    await user.click(button("Use this location"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(51.5, -0.12));
  });

  it("panning away dismisses the prompt", async () => {
    const user = userEvent.setup();
    proximityRows = [near(8)];
    const onChange = renderAdd();
    await user.click(button("Use this location"));
    await screen.findByText(/There's already a toilet/);
    pan(offset(SPOT, 200, 0));
    expect(screen.queryByText(/There's already a toilet/)).toBeNull();
    expect(button("Use this location")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("LocationPicker: enter coordinates", () => {
  const field = () => screen.getByRole("textbox", { name: "Latitude, longitude" });

  it("shows typed coordinates on the map, then 'Use this location' saves them", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={ORIGINAL} originalLocation={ORIGINAL} onChange={onChange} />);

    await user.click(screen.getByText("Enter coordinates"));
    await user.clear(field());
    await user.type(field(), "51.5034, -0.1276");
    await user.click(button("Show on map"));

    expect(theMap().setView).toHaveBeenLastCalledWith([51.5034, -0.1276], 18, { animate: false });
    expect(button("Use this location")).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();

    await user.click(button("Use this location"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(51.5034, -0.1276));
  });

  it("accepts a pasted Google Maps link", async () => {
    const user = userEvent.setup();
    render(<LocationPicker mode="add" apiUrl="" location={null} onChange={vi.fn()} />);
    await user.click(screen.getByText("Enter coordinates"));
    await user.click(field());
    await user.paste("https://www.google.com/maps/@51.5007292,-0.1246254,17z");
    await user.keyboard("{Enter}");
    expect(theMap().setView).toHaveBeenLastCalledWith([51.5007292, -0.1246254], 18, {
      animate: false,
    });
  });

  it("shows an inline error for coordinates outside the UK, and Enter never submits the form", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <LocationPicker mode="add" apiUrl="" location={null} onChange={vi.fn()} />
      </form>,
    );
    await user.click(screen.getByText("Enter coordinates"));
    await user.type(field(), "48.85, 2.35{Enter}");

    expect(screen.getByRole("alert")).toHaveTextContent(/aren't in the UK/);
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(field(), "x");
    expect(field()).not.toHaveAttribute("aria-invalid");
  });

  it("re-syncs the box when the location changes for another reason, but never over typing", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <LocationPicker
        mode="edit"
        apiUrl=""
        location={ORIGINAL}
        originalLocation={ORIGINAL}
        onChange={vi.fn()}
      />,
    );
    await user.click(screen.getByText("Enter coordinates"));
    expect(field()).toHaveValue("51.501235, -0.141235");

    // Another reason (e.g. a rebase after a conflict): the untouched box follows.
    rerender(
      <LocationPicker
        mode="edit"
        apiUrl=""
        location={{ lat: 51.6, lng: -0.2 }}
        originalLocation={ORIGINAL}
        onChange={vi.fn()}
      />,
    );
    expect(field()).toHaveValue("51.6, -0.2");

    // The user is typing: a location change must not overwrite their text (the old race).
    await user.clear(field());
    await user.type(field(), "51.7, -0.3");
    rerender(
      <LocationPicker
        mode="edit"
        apiUrl=""
        location={{ lat: 51.65, lng: -0.25 }}
        originalLocation={ORIGINAL}
        onChange={vi.fn()}
      />,
    );
    expect(field()).toHaveValue("51.7, -0.3");
  });
});

describe("LocationPicker: use my location", () => {
  const stubGeolocation = (
    impl: (success: PositionCallback, error: PositionErrorCallback) => void,
  ) => {
    const getCurrentPosition = vi.fn(impl);
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    });
    return getCurrentPosition;
  };

  afterEach(() => {
    // Remove the own-property stub so later tests see no geolocation support.
    Reflect.deleteProperty(navigator, "geolocation");
  });

  const position = (latitude: number, longitude: number, accuracy = 10) =>
    ({ coords: { latitude, longitude, accuracy } }) as GeolocationPosition;

  it("pans the map to the device's position", async () => {
    const user = userEvent.setup();
    stubGeolocation((success) => success(position(52.95, -1.15)));
    const onChange = vi.fn();
    render(<LocationPicker mode="add" apiUrl="" location={null} onChange={onChange} />);

    await user.click(button("Use my location"));

    expect(theMap().setView).toHaveBeenLastCalledWith([52.95, -1.15], 18, { animate: false });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("notes an approximate fix", async () => {
    const user = userEvent.setup();
    stubGeolocation((success) => success(position(52.95, -1.15, 400)));
    render(<LocationPicker mode="add" apiUrl="" location={null} onChange={vi.fn()} />);
    await user.click(button("Use my location"));
    expect(screen.getByRole("alert")).toHaveTextContent("accurate to about 400 m");
  });

  it("explains a blocked permission", async () => {
    const user = userEvent.setup();
    stubGeolocation((_s, error) =>
      error({ code: 1, message: "denied" } as GeolocationPositionError),
    );
    render(<LocationPicker mode="add" apiUrl="" location={null} onChange={vi.fn()} />);
    await user.click(button("Use my location"));
    expect(screen.getByRole("alert")).toHaveTextContent(/Location access is blocked/);
    expect(theMap().setView).toHaveBeenCalledTimes(1); // only the initial view
  });

  it("won't pan outside the UK", async () => {
    const user = userEvent.setup();
    stubGeolocation((success) => success(position(48.85, 2.35)));
    render(<LocationPicker mode="add" apiUrl="" location={null} onChange={vi.fn()} />);
    await user.click(button("Use my location"));
    expect(screen.getByRole("alert")).toHaveTextContent(/outside the UK/);
    expect(theMap().setView).toHaveBeenCalledTimes(1);
  });

  it("is hidden without geolocation support", () => {
    render(<LocationPicker mode="add" apiUrl="" location={null} onChange={vi.fn()} />);
    expect(queryButton("Use my location")).toBeNull();
  });
});

describe("LocationPicker: search", () => {
  it("fits the map to the chosen result and never changes the location", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes("nominatim")) {
        return Promise.resolve(
          json([
            {
              place_id: 1,
              display_name: "Leeds Station",
              lat: "53.7951",
              lon: "-1.5481",
              boundingbox: ["53.794", "53.796", "-1.549", "-1.547"],
            },
          ]),
        );
      }
      return Promise.resolve(json({ data: [] }));
    });
    const onChange = vi.fn();
    render(<LocationPicker mode="add" apiUrl="" location={null} onChange={onChange} />);

    await user.type(screen.getByRole("searchbox", { name: "Search for a place" }), "Leeds");
    await user.click(await screen.findByRole("button", { name: "Leeds Station" }));

    expect(theMap().fitBounds).toHaveBeenCalledWith(
      [
        [53.794, -1.549],
        [53.796, -1.547],
      ],
      { maxZoom: 18, animate: false },
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("LocationPicker: search keyboard and feedback", () => {
  const RESULTS = [
    { place_id: 1, display_name: "Leeds Station", lat: "53.7951", lon: "-1.5481" },
    { place_id: 2, display_name: "Leeds Market", lat: "53.7970", lon: "-1.5410" },
  ];
  /** Nominatim answers with `results`; every call is counted. */
  const nominatim = (results: unknown[] = RESULTS) => {
    const calls: string[] = [];
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes("nominatim")) {
        calls.push(url);
        return Promise.resolve(json(results));
      }
      return Promise.resolve(json({ data: [] }));
    });
    return calls;
  };
  const searchbox = () => screen.getByRole("searchbox", { name: "Search for a place" });
  const renderPicker = () =>
    render(<LocationPicker mode="add" apiUrl="" location={null} onChange={vi.fn()} />);

  it("Enter picks the first result", async () => {
    const user = userEvent.setup();
    nominatim();
    renderPicker();
    await user.type(searchbox(), "Leeds");
    await screen.findByRole("button", { name: "Leeds Station" });
    await user.keyboard("{Enter}");
    expect(theMap().setView).toHaveBeenLastCalledWith([53.7951, -1.5481], 18, { animate: false });
    expect(screen.queryByRole("list", { name: "Search results" })).toBeNull();
  });

  it("Enter before the results arrive searches straight away", async () => {
    const user = userEvent.setup();
    const calls = nominatim();
    renderPicker();
    await user.type(searchbox(), "Leeds{Enter}");
    // Sent at once, not after the debounce.
    expect(calls).toHaveLength(1);
    expect(await screen.findByRole("button", { name: "Leeds Station" })).toBeInTheDocument();
  });

  it("says when it is searching and when nothing was found", async () => {
    const user = userEvent.setup();
    nominatim([]);
    renderPicker();
    await user.type(searchbox(), "Zzqx");
    const status = await screen.findByText("Searching…");
    expect(status).toHaveAttribute("role", "status");
    expect(
      await screen.findByText("No places found. Try a postcode or street name."),
    ).toBeInTheDocument();
  });

  it("closes the results on Escape, a tap elsewhere, or the map moving", async () => {
    const user = userEvent.setup();
    nominatim();
    renderPicker();
    const results = () => screen.queryByRole("list", { name: "Search results" });

    await user.type(searchbox(), "Leeds");
    await screen.findByRole("button", { name: "Leeds Station" });
    await user.keyboard("{Escape}");
    expect(results()).toBeNull();
    expect(searchbox()).toHaveValue("Leeds");

    await user.type(searchbox(), "s");
    await screen.findByRole("button", { name: "Leeds Station" });
    // The outside-tap listener is attached by an effect, once the list is showing.
    await waitFor(() => {
      fireEvent.pointerDown(document.body);
      expect(results()).toBeNull();
    });

    await user.type(searchbox(), "x");
    await screen.findByRole("button", { name: "Leeds Station" });
    pan({ lat: 51.6, lng: -0.1 });
    expect(results()).toBeNull();
  });
});

describe("LocationPicker: map lifecycle", () => {
  it("hands its map to onMapReady, and null on unmount", () => {
    const onMapReady = vi.fn();
    const { unmount } = render(
      <LocationPicker
        mode="edit"
        apiUrl=""
        location={ORIGINAL}
        onChange={vi.fn()}
        onMapReady={onMapReady}
      />,
    );
    expect(onMapReady).toHaveBeenLastCalledWith(theMap());

    unmount();
    expect(onMapReady).toHaveBeenLastCalledWith(null);
    expect(theMap().remove).toHaveBeenCalled();
  });
});

describe("LocationPicker: initial view", () => {
  it("ignores an unusable initialView", () => {
    render(
      <LocationPicker
        mode="add"
        apiUrl=""
        location={null}
        onChange={vi.fn()}
        initialView={{ lat: Number.NaN, lng: 0, zoom: 17 }}
      />,
    );
    expect(theMap().setView).toHaveBeenCalledWith([51.505, -0.09], 13);
  });

  it("clamps an out-of-range zoom", () => {
    render(
      <LocationPicker
        mode="add"
        apiUrl=""
        location={null}
        onChange={vi.fn()}
        initialView={{ lat: 51.5, lng: -0.12, zoom: 42 }}
      />,
    );
    expect(theMap().setView).toHaveBeenCalledWith([51.5, -0.12], 19);
  });

  it("opens on the pin, not the URL view, when there is one", () => {
    window.history.replaceState(null, "", "/loos/add?lat=52.2&lng=0.12&zoom=18");
    render(<LocationPicker mode="add" apiUrl="" location={ORIGINAL} onChange={vi.fn()} />);
    expect(theMap().setView).toHaveBeenCalledWith([ORIGINAL.lat, ORIGINAL.lng], 17);
    expect(button("Move pin")).toBeInTheDocument();
  });
});
