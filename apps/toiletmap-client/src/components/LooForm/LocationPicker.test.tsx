import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { useState } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { MAP_VIEW_STORAGE_KEY } from "../LooMap/mapView";
import type { LatLng } from "./geometry";
import LocationPicker, {
  BIG_MOVE_HINT,
  BIG_MOVE_WARNING,
  INTRO_MESSAGE,
  INTRO_STORAGE_KEY,
  LOCKED_MESSAGE,
  type LocationPickerHandle,
  type LocationPickerProps,
  MIN_CONFIRM_ZOOM,
  type PickerResolution,
  ZOOM_IN_GUARD_MS,
  ZOOM_IN_MESSAGE,
} from "./LocationPicker";
import { describeMove } from "./LocationPicker/move";

/**
 * Leaflet does not run in happy-dom, so it is replaced with a fake that records every event
 * handler registered on the map, every layer added to it and every view change. That lets these
 * tests prove the toilet's location only changes when the user keeps it (confirming it, or
 * carrying on with the form after a safe move) — never from clicking, tapping or panning the map.
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
    resizeJitter: [0, 0] as [number, number],
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
      /** Pans by a screen offset (1 px is 1 m here, which is all these tests need). */
      panBy: vi.fn((offset: [number, number]) => {
        const [x, y] = offset;
        const metresPerDegree = 111_195;
        state.center = {
          lat: state.center.lat - y / metresPerDegree,
          lng:
            state.center.lng + x / (metresPerDegree * Math.cos((state.center.lat * Math.PI) / 180)),
        };
        map.fire("move").fire("moveend");
        return map;
      }),
      /**
       * Like Leaflet's: the new size moves the centre by Leaflet's half-pixel rounding (here
       * `fake.resizeJitter`: metres north and east), then fires move and resize. The moveend a
       * window resize debounces comes later (fire it with `map.fire("moveend")`).
       */
      invalidateSize: vi.fn((_options?: { debounceMoveend?: boolean }) => {
        const [north, east] = state.resizeJitter;
        const metresPerDegree = 111_195;
        state.center = {
          lat: state.center.lat + north / metresPerDegree,
          lng:
            state.center.lng +
            east / (metresPerDegree * Math.cos((state.center.lat * Math.PI) / 180)),
        };
        map.fire("move").fire("resize");
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
      // Like Leaflet: its keyboard handler makes the container a Tab stop as the map starts.
      if (options?.keyboard !== false && container.tabIndex <= 0) container.tabIndex = 0;
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

/**
 * Renders the picker with a real parent holding the location, as LooForm does, and the next
 * question after it (an input outside the picker, for "carrying on with the form").
 * `onKept` gets how each location was kept ("confirmed", "auto" or "reset").
 */
function Harness({
  initial,
  onChange,
  onKept,
  ...props
}: Partial<Omit<LocationPickerProps, "onChange">> & {
  initial: LatLng | null;
  onChange: Mock;
  onKept?: Mock;
}) {
  const [location, setLocation] = useState<LatLng | null>(initial);
  return (
    <>
      <LocationPicker
        mode="edit"
        apiUrl=""
        {...props}
        location={location}
        onChange={(lat, lng, source) => {
          onChange(lat, lng);
          onKept?.(source);
          setLocation({ lat, lng });
        }}
      />
      <input aria-label="Next question" />
    </>
  );
}

/** The picker's handle, as LooForm holds it. */
const makeController = () => ({ current: null as LocationPickerHandle | null });

/** Asks the picker to settle, as pressing Save does. */
const resolveWith = async (
  controller: { current: LocationPickerHandle | null },
  options?: { save?: boolean },
) => {
  let result: PickerResolution | undefined;
  await act(async () => {
    result = await controller.current?.resolve(options);
  });
  return result as PickerResolution;
};

/** Carry on with the form: focus the next question, outside the picker. */
const moveOn = async () => {
  await act(async () => {
    screen.getByRole("textbox", { name: "Next question" }).focus();
    // Keeping waits for the duplicate check (a fetch), like Save does.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};

/** The line under the map saying what the pin is doing. */
const strip = () => document.querySelector("[id$='-strip']") as HTMLElement;

/** Everything the picker's live regions say. */
const statusText = () =>
  screen
    .getAllByRole("status")
    .map((el) => el.textContent)
    .join(" ");

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

/** The attribution `/api/geocode` sends with Nominatim results. */
const OSM = "Data © OpenStreetMap contributors, ODbL 1.0. https://osm.org/copyright";

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
  fake.state.resizeJitter = [0, 0];
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

  it("edit: panning sends nothing until the user carries on with the form", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onKept = vi.fn();
    render(
      <Harness
        initial={ORIGINAL}
        originalLocation={ORIGINAL}
        onChange={onChange}
        onKept={onKept}
      />,
    );
    await user.click(button("Move pin"));

    pan(offset(ORIGINAL, 20, 0));
    pan(offset(ORIGINAL, 0, 30));
    expect(onChange).not.toHaveBeenCalled();

    await moveOn();
    const kept = offset(ORIGINAL, 0, 30);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(Number(kept.lat.toFixed(6)), Number(kept.lng.toFixed(6)));
    expect(onKept).toHaveBeenCalledWith("auto");
  });

  it("add: panning places the pin but sends nothing until the user carries on", async () => {
    const onChange = vi.fn();
    render(
      <Harness
        mode="add"
        initial={null}
        onChange={onChange}
        initialView={{ lat: 51.5, lng: -0.12, zoom: 17 }}
      />,
    );
    pan({ lat: 51.5001, lng: -0.12 });
    pan({ lat: 51.5002, lng: -0.1201 });
    expect(onChange).not.toHaveBeenCalled();
    expect(strip()).toHaveTextContent(
      "Pin placed. Keep moving the map to adjust it, or carry on with the form.",
    );

    await moveOn();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(51.5002, -0.1201);
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
    // The +/- buttons work for looking around; every zoom keeps the centre (the pin) in place.
    expect(fake.zoomControls).toHaveLength(1);
    expect(fake.zoomControls[0].onMap).toBe(true);
    expect(map.options).toMatchObject({
      scrollWheelZoom: "center",
      doubleClickZoom: "center",
      touchZoom: "center",
    });
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

  it("shows the lock on the map: a Locked badge and the Move pin button", () => {
    render(
      <LocationPicker
        mode="edit"
        apiUrl=""
        location={ORIGINAL}
        originalLocation={ORIGINAL}
        onChange={vi.fn()}
      />,
    );
    const mapWrap = fake.containers[0].parentElement as HTMLElement;
    expect(within(mapWrap).getByText("Locked")).toBeInTheDocument();
    expect(within(mapWrap).getByRole("button", { name: "Move pin" })).toBeInTheDocument();
    expect(strip()).toHaveTextContent(
      "This is where the toilet is. It's locked so it can't be moved by accident.",
    );
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
    expect(fake.zoomControls[0].onMap).toBe(true);
    expect(strip()).toHaveTextContent(
      /^Moved \d+ m north-east from the saved location\. Locked again\.$/,
    );
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
  it("opens at the initial view, moving; below zoom 17 the pin is hollow and the button is Zoom in", async () => {
    const user = userEvent.setup();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const onChange = vi.fn();
    render(
      <Harness
        mode="add"
        initial={null}
        onChange={onChange}
        initialView={{ lat: 53.48, lng: -2.24, zoom: 14 }}
      />,
    );
    const map = theMap();
    expect(map.setView).toHaveBeenCalledWith([53.48, -2.24], 14);
    expect(map.dragging.enabled()).toBe(true);
    expect(pinMarkers()).toHaveLength(0);

    // Never a disabled button: the same button zooms in, with one tap.
    expect(queryButton("Use this location")).toBeNull();
    const zoomIn = button("Zoom in");
    expect(zoomIn).toBeEnabled();
    expect(strip()).toHaveTextContent(ZOOM_IN_MESSAGE);
    expect(document.querySelector("[data-hollow='true']")).not.toBeNull();

    await user.click(zoomIn);
    expect(map.setZoom).toHaveBeenCalledWith(MIN_CONFIRM_ZOOM);
    expect(button("Use this location")).toBeEnabled();
    expect(button("Use this location")).toHaveFocus();
    expect(screen.queryByText(ZOOM_IN_MESSAGE, { exact: false })).toBeNull();
    expect(document.querySelector("[data-hollow='true']")).toBeNull();

    now.mockReturnValue(1_000_000 + ZOOM_IN_GUARD_MS + 1);
    await user.click(button("Use this location"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(53.48, -2.24));
    expect(await screen.findByRole("button", { name: "Move pin" })).toHaveFocus();
    expect(pinMarkers()).toHaveLength(1);
  });

  it("ignores presses for 500 ms after Zoom in, so a double tap can't confirm", async () => {
    const user = userEvent.setup();
    const now = vi.spyOn(Date, "now").mockReturnValue(5_000);
    const onChange = vi.fn();
    render(
      <Harness
        mode="add"
        initial={null}
        onChange={onChange}
        initialView={{ lat: 53.48, lng: -2.24, zoom: 14 }}
      />,
    );
    await user.click(button("Zoom in"));
    now.mockReturnValue(5_000 + ZOOM_IN_GUARD_MS - 1);
    await user.click(button("Use this location"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onChange).not.toHaveBeenCalled();
    expect(button("Use this location")).toBeInTheDocument();

    now.mockReturnValue(5_000 + ZOOM_IN_GUARD_MS);
    await user.click(button("Use this location"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(53.48, -2.24));
  });

  it("turns the button back into Zoom in when the user zooms out", () => {
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
    expect(queryButton("Use this location")).toBeNull();
    expect(button("Zoom in")).toBeEnabled();
  });

  it.each([
    [15, 17],
    [16, 17],
    [14, 14],
    [18, 17],
    [19, 17],
  ])("opens a main-map view at zoom %i at zoom %i", (from, to) => {
    localStorage.setItem(
      MAP_VIEW_STORAGE_KEY,
      JSON.stringify({ lat: 55.95, lng: -3.19, zoom: from }),
    );
    render(<LocationPicker mode="add" apiUrl="" location={null} onChange={vi.fn()} />);
    expect(theMap().setView).toHaveBeenCalledWith([55.95, -3.19], to);
  });

  it("opens at ?lat&lng&zoom from the page URL (a close view at zoom 17)", () => {
    window.history.replaceState(null, "", "/loos/add?lat=52.2&lng=0.12&zoom=18");
    render(<LocationPicker mode="add" apiUrl="" location={null} onChange={vi.fn()} />);
    expect(theMap().setView).toHaveBeenCalledWith([52.2, 0.12], 17);
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

  it("adding: pans the map to the device's position and places the pin there", async () => {
    const user = userEvent.setup();
    stubGeolocation((success) => success(position(52.95, -1.15)));
    const onChange = vi.fn();
    const controller = makeController();
    render(
      <LocationPicker
        mode="add"
        apiUrl=""
        location={null}
        onChange={onChange}
        controllerRef={controller}
      />,
    );

    await user.click(button("Use my location"));

    expect(theMap().setView).toHaveBeenLastCalledWith([52.95, -1.15], 18, { animate: false });
    expect(onChange).not.toHaveBeenCalled();
    expect(strip()).toHaveTextContent(
      "Pin placed at your location. Move the map if the entrance is somewhere else.",
    );
    expect(await resolveWith(controller)).toEqual({
      kind: "ok",
      location: { lat: 52.95, lng: -1.15 },
      source: "auto",
    });
  });

  it("adding: a fix worse than 50 m doesn't place the pin", async () => {
    const user = userEvent.setup();
    stubGeolocation((success) => success(position(52.95, -1.15, 400)));
    const controller = makeController();
    render(
      <LocationPicker
        mode="add"
        apiUrl=""
        location={null}
        onChange={vi.fn()}
        controllerRef={controller}
      />,
    );
    await user.click(button("Use my location"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your location is only accurate to about 400 m, so the pin isn't placed yet. Move the map until it's on the toilet.",
    );
    expect(await resolveWith(controller)).toEqual({ kind: "unplaced", accuracy: 400 });
  });

  it("editing: a jump to the device's position is only kept after a check", async () => {
    const user = userEvent.setup();
    const near = offset(ORIGINAL, 20, 0);
    stubGeolocation((success) => success(position(near.lat, near.lng)));
    const onChange = vi.fn();
    const controller = makeController();
    render(
      <Harness
        initial={ORIGINAL}
        originalLocation={ORIGINAL}
        onChange={onChange}
        controllerRef={controller}
      />,
    );
    await user.click(button("Move pin"));
    await user.click(button("Use my location"));
    expect(strip()).toHaveTextContent(
      "Check the pin is on the toilet, then choose “Use this location”.",
    );
    expect(await resolveWith(controller)).toEqual({ kind: "blocked", issue: "jump", jump: "gps" });
    expect(onChange).not.toHaveBeenCalled();

    // Save keeps it, for the form to check ("Save the new location?"), like a dragged move.
    expect(await resolveWith(controller, { save: true })).toMatchObject({
      kind: "ok",
      source: "auto",
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const [lat, lng] = onChange.mock.calls[0];
    expect(lat).toBeCloseTo(near.lat, 5);
    expect(lng).toBeCloseTo(near.lng, 5);
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
      if (url.startsWith("/api/geocode?")) {
        return Promise.resolve(
          json({
            results: [
              {
                label: "Leeds Station",
                lat: 53.7951,
                lng: -1.5481,
                bbox: [-1.549, 53.794, -1.547, 53.796],
                kind: "place",
              },
            ],
            attribution: OSM,
          }),
        );
      }
      return Promise.resolve(json({ data: [] }));
    });
    const onChange = vi.fn();
    render(<LocationPicker mode="add" apiUrl="" location={null} onChange={onChange} />);

    await user.type(screen.getByRole("searchbox", { name: "Search for a place" }), "Leeds{Enter}");
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

  const leeds = () =>
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith("/api/geocode?")) {
        return Promise.resolve(
          json({
            results: [{ label: "Leeds Station", lat: 53.7951, lng: -1.5481, kind: "place" }],
            attribution: OSM,
          }),
        );
      }
      return Promise.resolve(json({ data: [] }));
    });

  it("adding: places the pin at the result", async () => {
    const user = userEvent.setup();
    leeds();
    const controller = makeController();
    render(
      <LocationPicker
        mode="add"
        apiUrl=""
        location={null}
        onChange={vi.fn()}
        controllerRef={controller}
      />,
    );
    await user.type(screen.getByRole("searchbox", { name: "Search for a place" }), "Leeds{Enter}");
    await user.click(await screen.findByRole("button", { name: "Leeds Station" }));
    expect(strip()).toHaveTextContent(
      "Pin placed at the search result. Move the map if the entrance is somewhere else.",
    );
    expect(await resolveWith(controller)).toMatchObject({
      kind: "ok",
      location: { lat: 53.7951, lng: -1.5481 },
    });
  });

  it("editing: a search jump blocks until 'Use this location' or a nudge of the map", async () => {
    const user = userEvent.setup();
    leeds();
    const controller = makeController();
    const nearLeeds = { lat: 53.7951, lng: -1.548 };
    const onChange = vi.fn();
    render(
      <Harness
        initial={nearLeeds}
        originalLocation={nearLeeds}
        onChange={onChange}
        controllerRef={controller}
      />,
    );
    await user.click(button("Move pin"));
    await user.type(screen.getByRole("searchbox", { name: "Search for a place" }), "Leeds{Enter}");
    await user.click(await screen.findByRole("button", { name: "Leeds Station" }));
    expect(strip()).toHaveTextContent(
      "Check the pin after your search, then choose “Use this location”.",
    );
    await moveOn();
    expect(onChange).not.toHaveBeenCalled();
    expect(await resolveWith(controller)).toEqual({
      kind: "blocked",
      issue: "jump",
      jump: "search",
    });
    // Not even for Save: a search lands on a place, not the toilet, so it must be looked at.
    expect(await resolveWith(controller, { save: true })).toEqual({
      kind: "blocked",
      issue: "jump",
      jump: "search",
    });
    expect(onChange).not.toHaveBeenCalled();

    // A nudge of the map means the user has looked: now it is kept like any small move.
    pan({ lat: 53.79511, lng: -1.5481 });
    expect(await resolveWith(controller)).toMatchObject({ kind: "ok", source: "auto" });
    expect(onChange).toHaveBeenCalledWith(53.79511, -1.5481);
  });
});

describe("LocationPicker: search keyboard and feedback", () => {
  const RESULTS = [
    { label: "Leeds Station", lat: 53.7951, lng: -1.5481, kind: "place" },
    { label: "Leeds Market", lat: 53.797, lng: -1.541, kind: "place" },
  ];
  /** /api/geocode answers with `results`; every call is counted. */
  const geocode = (results: unknown[] = RESULTS, attribution: string | null = OSM) => {
    const calls: string[] = [];
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith("/api/geocode?")) {
        calls.push(url);
        return Promise.resolve(json({ results, attribution }));
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
    geocode();
    renderPicker();
    await user.type(searchbox(), "Leeds{Enter}");
    await screen.findByRole("button", { name: "Leeds Station" });
    await user.keyboard("{Enter}");
    expect(theMap().setView).toHaveBeenLastCalledWith([53.7951, -1.5481], 18, { animate: false });
    expect(screen.queryByRole("list", { name: "Search results" })).toBeNull();
  });

  it("Enter before the results arrive searches straight away", async () => {
    const user = userEvent.setup();
    const calls = geocode();
    renderPicker();
    await user.type(searchbox(), "Leeds{Enter}");
    // Sent at once, not after the debounce.
    expect(calls).toHaveLength(1);
    expect(await screen.findByRole("button", { name: "Leeds Station" })).toBeInTheDocument();
  });

  it("says when it is searching and when nothing was found", async () => {
    const user = userEvent.setup();
    geocode([]);
    renderPicker();
    await user.type(searchbox(), "Zzqx");
    // Typing a place name never searches (Nominatim forbids autocomplete): it says how to.
    expect(screen.getByText("Press Enter to search for places.")).toHaveAttribute("role", "status");
    // Hold the answer back, so "Searching…" can be seen.
    let answer: (response: Response) => void = () => undefined;
    fetchMock.mockImplementation((input) =>
      String(input).startsWith("/api/geocode?")
        ? new Promise<Response>((resolve) => {
            answer = resolve;
          })
        : Promise.resolve(json({ data: [] })),
    );
    await user.keyboard("{Enter}");
    const status = await screen.findByText("Searching…");
    expect(status).toHaveAttribute("role", "status");
    answer(json({ results: [], attribution: null }));
    expect(
      await screen.findByText("No places found. Try a postcode or street name."),
    ).toBeInTheDocument();
  });

  it("searches through the same-origin /api/geocode, never a geocoder directly", async () => {
    const user = userEvent.setup();
    const calls = geocode();
    renderPicker();
    await user.type(searchbox(), "Leeds{Enter}");
    await screen.findByRole("button", { name: "Leeds Station" });
    expect(calls).toEqual(["/api/geocode?q=Leeds"]);
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => /^https?:/.test(url))).toBe(false);
  });

  it("looks typed postcodes up as you type (mode=suggest), and places only on Enter", async () => {
    const user = userEvent.setup();
    const calls = geocode(
      [{ label: "M1, Manchester", lat: 53.48, lng: -2.24, kind: "postcode" }],
      null,
    );
    renderPicker();
    await user.type(searchbox(), "M1");
    expect(await screen.findByRole("button", { name: "M1, Manchester" })).toBeInTheDocument();
    expect(calls).toEqual(["/api/geocode?q=M1&mode=suggest"]);

    await user.clear(searchbox());
    await user.type(searchbox(), "Manchester");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(calls).toHaveLength(1);
    await user.keyboard("{Enter}");
    expect(calls).toEqual(["/api/geocode?q=M1&mode=suggest", "/api/geocode?q=Manchester"]);
  });

  it("credits OpenStreetMap under Nominatim results, and nothing under postcodes", async () => {
    const user = userEvent.setup();
    geocode();
    renderPicker();
    await user.type(searchbox(), "Leeds{Enter}");
    await screen.findByRole("button", { name: "Leeds Station" });
    expect(screen.getByRole("link", { name: "OpenStreetMap" })).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/copyright",
    );

    geocode([{ label: "LS1 4DY, Leeds", lat: 53.7951, lng: -1.5481, kind: "postcode" }], null);
    await user.clear(searchbox());
    await user.type(searchbox(), "LS1 4DY");
    await screen.findByRole("button", { name: "LS1 4DY, Leeds" });
    expect(screen.queryByRole("link", { name: "OpenStreetMap" })).toBeNull();
  });

  it("says when place search is unavailable", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        String(input).startsWith("/api/geocode?")
          ? json({ message: "Place search is unavailable.", error: "geocoder_unavailable" }, 502)
          : json({ data: [] }),
      ),
    );
    renderPicker();
    await user.type(searchbox(), "Leeds{Enter}");
    expect(
      await screen.findByText("Place search isn't working right now. Try again in a moment."),
    ).toHaveAttribute("role", "status");
    expect(screen.queryByRole("list", { name: "Search results" })).toBeNull();
  });

  it("closes the results on Escape, a tap elsewhere, or the map moving", async () => {
    const user = userEvent.setup();
    geocode();
    renderPicker();
    const results = () => screen.queryByRole("list", { name: "Search results" });

    await user.type(searchbox(), "Leeds{Enter}");
    await screen.findByRole("button", { name: "Leeds Station" });
    await user.keyboard("{Escape}");
    expect(results()).toBeNull();
    expect(searchbox()).toHaveValue("Leeds");

    await user.type(searchbox(), "s{Enter}");
    await screen.findByRole("button", { name: "Leeds Station" });
    // The outside-tap listener is attached by an effect, once the list is showing.
    await waitFor(() => {
      fireEvent.pointerDown(document.body);
      expect(results()).toBeNull();
    });

    await user.type(searchbox(), "x{Enter}");
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
    // Clamped to 19, which (like any view at 15 or closer) opens at 17.
    expect(theMap().setView).toHaveBeenCalledWith([51.5, -0.12], 17);
  });

  it("opens on the pin, not the URL view, when there is one", () => {
    window.history.replaceState(null, "", "/loos/add?lat=52.2&lng=0.12&zoom=18");
    render(<LocationPicker mode="add" apiUrl="" location={ORIGINAL} onChange={vi.fn()} />);
    expect(theMap().setView).toHaveBeenCalledWith([ORIGINAL.lat, ORIGINAL.lng], 17);
    expect(button("Move pin")).toBeInTheDocument();
  });
});

describe("LocationPicker: kept when you carry on with the form", () => {
  const renderEdit = (extra: Partial<Omit<LocationPickerProps, "onChange">> = {}) => {
    const onChange = vi.fn();
    const onKept = vi.fn();
    const onPendingChange = vi.fn();
    const controller = makeController();
    render(
      <Harness
        initial={ORIGINAL}
        originalLocation={ORIGINAL}
        onChange={onChange}
        onKept={onKept}
        onPendingChange={onPendingChange}
        controllerRef={controller}
        {...extra}
      />,
    );
    return { onChange, onKept, onPendingChange, controller };
  };

  it("keeps a small move and locks again when focus moves to another question", async () => {
    const user = userEvent.setup();
    const { onChange, onKept } = renderEdit();
    await user.click(button("Move pin"));
    const to = offset(ORIGINAL, 16.3, 16.3);
    pan(to);
    expect(strip()).toHaveTextContent(
      "Moved 23 m north-east. This is kept when you carry on with the form.",
    );

    await moveOn();
    expect(onChange).toHaveBeenCalledWith(Number(to.lat.toFixed(6)), Number(to.lng.toFixed(6)));
    expect(onKept).toHaveBeenLastCalledWith("auto");
    expect(theMap().dragging.enabled()).toBe(false);
    expect(strip()).toHaveTextContent(
      "Moved 23 m north-east from the saved location. Locked again.",
    );
    expect(statusText()).toContain("Moved 23 m north-east from the saved location. Locked again.");
    // Focus stays in the question the user went to.
    expect(screen.getByRole("textbox", { name: "Next question" })).toHaveFocus();
  });

  it("keeps it on a click outside the picker too (a phone doesn't always move focus)", async () => {
    const user = userEvent.setup();
    const { onChange } = renderEdit();
    await user.click(button("Move pin"));
    pan(offset(ORIGINAL, 10, 0));
    await act(async () => {
      // A click (no focus change), as tapping a label or toggle on a phone can be.
      fireEvent.click(screen.getByRole("textbox", { name: "Next question" }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(button("Move pin")).toBeInTheDocument();
  });

  it("focus on the question around the picker isn't moving on (WebKit focuses it on a tap)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <div tabIndex={-1} data-testid="question">
        <Harness initial={ORIGINAL} originalLocation={ORIGINAL} onChange={onChange} />
      </div>,
    );
    await user.click(button("Move pin"));
    pan(offset(ORIGINAL, 10, 0));
    await act(async () => {
      screen.getByTestId("question").focus();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(button("Use this location")).toBeInTheDocument();
  });

  it("an unmoved pin just locks again, sending nothing", async () => {
    const user = userEvent.setup();
    const { onChange, controller } = renderEdit();
    await user.click(button("Move pin"));
    await moveOn();
    expect(onChange).not.toHaveBeenCalled();
    expect(theMap().dragging.enabled()).toBe(false);
    expect(await resolveWith(controller)).toEqual({
      kind: "ok",
      location: ORIGINAL,
      source: null,
    });
  });

  it("reports a pending move to the form, and clears it once kept", async () => {
    const user = userEvent.setup();
    const { onPendingChange } = renderEdit();
    await user.click(button("Move pin"));
    pan(offset(ORIGINAL, 10, 0));
    await waitFor(() =>
      expect(onPendingChange).toHaveBeenLastCalledWith({
        location: expect.objectContaining({ lat: expect.any(Number) }),
        keepable: true,
        issue: null,
        // Edit mode with no nearby toilets: the check comes back clear after the debounce.
        checked: expect.any(Boolean),
      }),
    );
    pan(offset(ORIGINAL, 80, 0));
    await waitFor(() =>
      expect(onPendingChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ keepable: false, issue: "bigMove" }),
      ),
    );
    pan(offset(ORIGINAL, 10, 0));
    await moveOn();
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith(null));
  });

  it("announces the move as the map stops", async () => {
    const user = userEvent.setup();
    renderEdit();
    await user.click(button("Move pin"));
    pan(offset(ORIGINAL, 16.3, 16.3));
    expect(statusText()).toContain(
      "Moved 23 m north-east. This is kept when you carry on with the form.",
    );
    pan(offset(ORIGINAL, 70, 0));
    expect(statusText()).toContain(
      "Moved 70 m north. A move this big is only kept with Use this location.",
    );
  });

  describe("never keeps a risky move by itself", () => {
    const cases: [string, () => void, PickerResolution][] = [
      [
        "a move over 50 m",
        () => pan(offset(ORIGINAL, 60, 0)),
        { kind: "blocked", issue: "bigMove" },
      ],
      [
        "a pin below zoom 17",
        () => pan(offset(ORIGINAL, 10, 0), 16),
        { kind: "blocked", issue: "zoom" },
      ],
    ];
    it.each(cases)("%s", async (_label, move, expected) => {
      const user = userEvent.setup();
      const { onChange, controller } = renderEdit();
      await user.click(button("Move pin"));
      move();
      await moveOn();
      expect(onChange).not.toHaveBeenCalled();
      expect(queryButton("Move pin")).toBeNull(); // still moving
      expect(await resolveWith(controller)).toEqual(expected);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("typed coordinates while editing", async () => {
      const user = userEvent.setup();
      const { onChange, controller } = renderEdit();
      const near = offset(ORIGINAL, 20, 0);
      await user.click(screen.getByText("Enter coordinates"));
      const field = screen.getByRole("textbox", { name: "Latitude, longitude" });
      await user.clear(field);
      await user.type(field, `${near.lat.toFixed(6)}, ${near.lng.toFixed(6)}{Enter}`);
      await moveOn();
      expect(onChange).not.toHaveBeenCalled();
      expect(await resolveWith(controller)).toEqual({
        kind: "blocked",
        issue: "jump",
        jump: "coords",
      });
    });

    it("a pin next to another toilet, until the question is answered", async () => {
      const user = userEvent.setup();
      proximityRows = [
        {
          id: "next-door",
          name: "Women's toilets",
          location: offset(ORIGINAL, 25, 0),
          active: true,
        },
      ];
      const { onChange, controller } = renderEdit();
      await user.click(button("Move pin"));
      pan(offset(ORIGINAL, 22, 0), 18);
      expect(await resolveWith(controller)).toEqual({
        kind: "blocked",
        issue: "duplicate",
        name: "Women's toilets",
      });
      expect(onChange).not.toHaveBeenCalled();
      expect(
        screen.getByRole("group", { name: /There's already a toilet 3 m away/ }),
      ).toBeVisible();
      // Asked again while the question is open: still blocked, with no second lookup.
      const calls = proximityCalls().length;
      expect(await resolveWith(controller)).toMatchObject({ issue: "duplicate" });
      expect(proximityCalls()).toHaveLength(calls);

      await user.click(button("No, this is a different toilet"));
      expect(await resolveWith(controller)).toMatchObject({ kind: "ok", source: "auto" });
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });

  it("going back to the saved spot is kept at any zoom, as exactly the original", async () => {
    const user = userEvent.setup();
    const { onChange, controller } = renderEdit();
    await user.click(button("Move pin"));
    pan(offset(ORIGINAL, 20, 0));
    await moveOn(); // kept 20 m north
    expect(onChange).toHaveBeenCalledTimes(1);

    await user.click(button("Move pin"));
    pan(ORIGINAL, 15);
    expect(await resolveWith(controller)).toEqual({
      kind: "ok",
      location: ORIGINAL,
      source: "auto",
    });
    expect(onChange).toHaveBeenLastCalledWith(ORIGINAL.lat, ORIGINAL.lng);
  });

  it("the error summary's fix: Zoom in zooms in, the others focus what answers them", async () => {
    const user = userEvent.setup();
    const { controller } = renderEdit();
    await user.click(button("Move pin"));
    pan(offset(ORIGINAL, 60, 0), 15);
    act(() => controller.current?.fixIssue("zoom"));
    expect(theMap().setZoom).toHaveBeenLastCalledWith(MIN_CONFIRM_ZOOM);
    expect(button("Use this location")).toHaveFocus();
    act(() => {
      (document.activeElement as HTMLElement).blur();
      controller.current?.fixIssue("bigMove");
    });
    expect(button("Use this location")).toHaveFocus();
  });
});

describe("LocationPicker: adding, the pin starts not placed", () => {
  const renderAdd = (extra: Partial<Omit<LocationPickerProps, "onChange">> = {}) => {
    const onChange = vi.fn();
    const controller = makeController();
    render(
      <Harness
        mode="add"
        initial={null}
        onChange={onChange}
        controllerRef={controller}
        {...extra}
      />,
    );
    return { onChange, controller };
  };

  it("the opening view never counts as placed", async () => {
    const { onChange, controller } = renderAdd({
      initialView: { lat: 51.5, lng: -0.12, zoom: 17 },
    });
    expect(strip()).toHaveTextContent("Move the map until the pin is on the toilet's entrance.");
    await moveOn();
    expect(onChange).not.toHaveBeenCalled();
    expect(await resolveWith(controller)).toEqual({ kind: "unplaced" });
  });

  it("not even the 'Add a toilet here' link's view", async () => {
    window.history.replaceState(null, "", "/loos/add?lat=52.2&lng=0.12&zoom=18");
    const { onChange, controller } = renderAdd();
    expect(theMap().setView).toHaveBeenCalledWith([52.2, 0.12], 17);
    await moveOn();
    expect(onChange).not.toHaveBeenCalled();
    expect(await resolveWith(controller)).toEqual({ kind: "unplaced" });
  });

  it("zooming never places or moves the pin", async () => {
    const { onChange, controller } = renderAdd({
      initialView: { lat: 51.5, lng: -0.12, zoom: 15 },
    });
    const map = theMap();
    expect(map.setView).toHaveBeenCalledWith([51.5, -0.12], 17); // a close view opens at 17
    pan({ lat: 51.5, lng: -0.12 }, 18);
    pan({ lat: 51.5, lng: -0.12 }, 16);
    pan({ lat: 51.5, lng: -0.12 }, 19);
    expect(map.getCenter()).toEqual({ lat: 51.5, lng: -0.12 });
    expect(statusText()).not.toContain("Pin placed.");
    await moveOn();
    expect(onChange).not.toHaveBeenCalled();
    expect(await resolveWith(controller)).toEqual({ kind: "unplaced" });
  });

  it("a pan places it once the map stops at zoom 17, announced, and moving on keeps and locks it", async () => {
    const { onChange } = renderAdd({ initialView: { lat: 51.5, lng: -0.12, zoom: 14 } });
    pan({ lat: 51.501, lng: -0.12 });
    expect(statusText()).not.toContain("Pin placed.");
    // Panned while too far out, then zoomed in: placed.
    pan({ lat: 51.501, lng: -0.12 }, 17);
    expect(statusText()).toContain("Pin placed.");
    expect(strip()).toHaveTextContent(
      "Pin placed. Keep moving the map to adjust it, or carry on with the form.",
    );
    await moveOn();
    expect(onChange).toHaveBeenCalledWith(51.501, -0.12);
    expect(strip()).toHaveTextContent("Pin placed and locked, so scrolling won't move it.");
    expect(button("Move pin")).toBeInTheDocument();
    expect(statusText()).toContain("Pin placed and locked.");
  });

  it("an approximate device fix after a pan leaves the pin not placed", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success: PositionCallback) =>
          success({
            coords: { latitude: 52.95, longitude: -1.15, accuracy: 300 },
          } as GeolocationPosition),
        ),
      },
    });
    try {
      const { controller } = renderAdd({ initialView: { lat: 51.5, lng: -0.12, zoom: 17 } });
      pan({ lat: 51.501, lng: -0.12 });
      expect(strip()).toHaveTextContent(/^Pin placed\./);
      await user.click(button("Use my location"));
      expect(strip()).toHaveTextContent("Move the map until the pin is on the toilet's entrance.");
      expect(await resolveWith(controller)).toEqual({ kind: "unplaced", accuracy: 300 });
    } finally {
      Reflect.deleteProperty(navigator, "geolocation");
    }
  });

  it("a placed pin below zoom 17 blocks saving", async () => {
    const { controller } = renderAdd({ initialView: { lat: 51.5, lng: -0.12, zoom: 17 } });
    pan({ lat: 51.501, lng: -0.12 });
    pan({ lat: 51.501, lng: -0.12 }, 16);
    expect(await resolveWith(controller)).toEqual({ kind: "blocked", issue: "zoom" });
  });

  it("'Yes, it's on the toilet' keeps the pin where the map opened", () => {
    const { onChange, controller } = renderAdd({
      initialView: { lat: 51.5, lng: -0.12, zoom: 17 },
    });
    let kept: LatLng | null = null;
    act(() => {
      kept = controller.current?.placeHere() ?? null;
    });
    expect(kept).toEqual({ lat: 51.5, lng: -0.12 });
    expect(onChange).toHaveBeenCalledWith(51.5, -0.12);
    expect(button("Move pin")).toBeInTheDocument();
  });

  it("'Move the map' puts focus on the map", () => {
    const { controller } = renderAdd({ initialView: { lat: 51.5, lng: -0.12, zoom: 17 } });
    act(() => controller.current?.focusMap());
    expect(document.activeElement).toBe(fake.containers[0]);
  });
});

describe("LocationPicker: duplicate check as the map stops", () => {
  const SPOT = { lat: 51.5, lng: -0.12 };

  it("asks by itself, and 'No, this is a different toilet' is remembered for that toilet", async () => {
    const user = userEvent.setup();
    proximityRows = [
      { id: "dup1", name: "Station toilets", location: offset(SPOT, 8, 0), active: true },
    ];
    const onChange = vi.fn();
    const controller = makeController();
    render(
      <Harness
        mode="add"
        initial={null}
        onChange={onChange}
        controllerRef={controller}
        apiUrl="https://api.test"
        initialView={{ ...SPOT, zoom: 18 }}
      />,
    );
    const prompt = await screen.findByRole(
      "group",
      { name: /There's already a toilet 8 m away/ },
      { timeout: 2000 },
    );
    expect(prompt).not.toHaveFocus(); // asked, not forced on someone mid-drag
    expect(await resolveWith(controller)).toMatchObject({ kind: "blocked", issue: "duplicate" });

    await user.click(button("No, this is a different toilet"));
    expect(onChange).not.toHaveBeenCalled();
    expect(button("Use this location")).toHaveFocus();

    pan(offset(SPOT, 2, 0));
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(screen.queryByRole("group", { name: /There's already a toilet/ })).toBeNull();
    expect(await resolveWith(controller)).toMatchObject({ kind: "ok", source: "auto" });
  });
});

describe("LocationPicker: the locked map", () => {
  const renderLocked = () => {
    const onChange = vi.fn();
    render(<Harness initial={ORIGINAL} originalLocation={ORIGINAL} onChange={onChange} />);
    return onChange;
  };
  const pointer = (type: "pointerDown" | "pointerMove" | "pointerUp", init: object) =>
    act(() => {
      fireEvent[type](fake.containers[0], { pointerId: 1, isPrimary: true, button: 0, ...init });
    });
  const stubPointerMedia = (desktop: boolean) =>
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: desktop && query.includes("pointer: fine"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );

  /** The message drawn on the map (the live region says it too). */
  const onMapMessage = () =>
    within(fake.containers[0].parentElement as HTMLElement).queryByText(LOCKED_MESSAGE);

  it("a tap explains the lock and moves nothing", () => {
    const onChange = renderLocked();
    pointer("pointerDown", { clientX: 100, clientY: 100, pointerType: "touch" });
    pointer("pointerUp", { clientX: 100, clientY: 100, pointerType: "touch" });
    expect(onMapMessage()).toBeInTheDocument();
    expect(statusText()).toContain(LOCKED_MESSAGE);
    expect(onChange).not.toHaveBeenCalled();
    expect(theMap().dragging.enabled()).toBe(false);
  });

  it("a sideways touch drag explains the lock; a vertical one is a page scroll", () => {
    stubPointerMedia(false);
    renderLocked();
    pointer("pointerDown", { clientX: 100, clientY: 100, pointerType: "touch" });
    pointer("pointerMove", { clientX: 100, clientY: 160, pointerType: "touch" });
    expect(onMapMessage()).toBeNull();
    act(() => {
      fireEvent.pointerCancel(fake.containers[0], { pointerId: 1 });
    });

    pointer("pointerDown", { clientX: 100, clientY: 100, pointerType: "touch" });
    pointer("pointerMove", { clientX: 160, clientY: 105, pointerType: "touch" });
    expect(onMapMessage()).toBeInTheDocument();
    expect(theMap().panBy).not.toHaveBeenCalled();
    expect(button("Move pin")).toBeInTheDocument();
  });

  it("with a mouse, dragging the locked map unlocks it and keeps panning", () => {
    stubPointerMedia(true);
    const onChange = renderLocked();
    const map = theMap();
    pointer("pointerDown", { clientX: 100, clientY: 100, pointerType: "mouse" });
    pointer("pointerMove", { clientX: 100, clientY: 110, pointerType: "mouse" });
    pointer("pointerMove", { clientX: 100, clientY: 130, pointerType: "mouse" });
    pointer("pointerUp", { clientX: 100, clientY: 130, pointerType: "mouse" });

    expect(map.dragging.enabled()).toBe(true);
    expect(map.panBy).toHaveBeenCalledWith([0, -10], { animate: false, noMoveStart: true });
    expect(map.panBy).toHaveBeenCalledWith([0, -20], { animate: false, noMoveStart: true });
    // Dragged 30 px down: the land 30 m north comes under the pin.
    expect(screen.getByText(/^Moved 30 m north$/)).toBeInTheDocument();
    expect(button("Use this location")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(onMapMessage()).toBeNull();
  });

  it("a mouse drag settles once, when the button comes up (not on every step)", () => {
    stubPointerMedia(true);
    const onPendingChange = vi.fn();
    render(
      <Harness
        initial={ORIGINAL}
        originalLocation={ORIGINAL}
        onChange={vi.fn()}
        onPendingChange={onPendingChange}
      />,
    );
    pointer("pointerDown", { clientX: 100, clientY: 100, pointerType: "mouse" });
    for (let y = 110; y <= 130; y += 2) {
      pointer("pointerMove", { clientX: 100, clientY: y, pointerType: "mouse" });
    }
    // Mid-drag: the chip follows, but nothing has settled yet.
    expect(screen.getByText(/^Moved 30 m north$/)).toBeInTheDocument();
    expect(onPendingChange).not.toHaveBeenCalledWith(expect.objectContaining({ keepable: true }));
    // The live region isn't rewritten on every step of the drag.
    expect(statusText()).not.toContain("Moved");

    pointer("pointerUp", { clientX: 100, clientY: 130, pointerType: "mouse" });
    const pendings = onPendingChange.mock.calls.filter(([p]) => p !== null);
    expect(pendings).toHaveLength(1);
    expect(statusText()).toContain(
      "Moved 30 m north. This is kept when you carry on with the form.",
    );
  });

  it("page scrolling over it isn't blocked: no wheel zoom and no touch drag while locked", () => {
    renderLocked();
    expect(theMap().scrollWheelZoom.enabled()).toBe(false);
    expect(theMap().dragging.enabled()).toBe(false);
    expect(theMap().touchZoom.enabled()).toBe(false);
  });
});

describe("LocationPicker: one-time intro", () => {
  it("is shown until dismissed, and remembered", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <Harness initial={ORIGINAL} originalLocation={ORIGINAL} onChange={vi.fn()} />,
    );
    expect(screen.getByText(INTRO_MESSAGE, { exact: false })).toBeInTheDocument();
    await user.click(button("Dismiss"));
    expect(screen.queryByText(INTRO_MESSAGE, { exact: false })).toBeNull();
    expect(localStorage.getItem(INTRO_STORAGE_KEY)).toBe("1");
    unmount();
    fake.maps.length = 0;

    render(<Harness initial={ORIGINAL} originalLocation={ORIGINAL} onChange={vi.fn()} />);
    expect(screen.queryByText(INTRO_MESSAGE, { exact: false })).toBeNull();
  });

  it("is only on the edit form: adding works as it always has", () => {
    render(<LocationPicker mode="add" apiUrl="" location={null} onChange={vi.fn()} />);
    expect(screen.queryByText(INTRO_MESSAGE, { exact: false })).toBeNull();
  });

  it("still works when storage throws", async () => {
    const user = userEvent.setup();
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    vi.stubGlobal("localStorage", throwing);
    render(<Harness initial={ORIGINAL} originalLocation={ORIGINAL} onChange={vi.fn()} />);
    expect(screen.getByText(INTRO_MESSAGE, { exact: false })).toBeInTheDocument();
    await user.click(button("Dismiss"));
    expect(screen.queryByText(INTRO_MESSAGE, { exact: false })).toBeNull();
    expect(theMap()).toBeDefined();
  });
});

describe("LocationPicker: a rough 'Use my location' fix never places the pin", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "geolocation");
  });

  it("not even over a pin kept before: Save asks, and nothing is kept on moving on", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success: PositionCallback) =>
          success({
            coords: { latitude: 52.95, longitude: -1.15, accuracy: 800 },
          } as GeolocationPosition),
        ),
      },
    });
    const onChange = vi.fn();
    const controller = makeController();
    render(
      <Harness
        mode="add"
        initial={null}
        onChange={onChange}
        controllerRef={controller}
        initialView={{ lat: 51.5, lng: -0.12, zoom: 17 }}
      />,
    );
    // Place the pin and keep it by carrying on with the form.
    pan({ lat: 51.501, lng: -0.12 });
    await moveOn();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(51.501, -0.12);

    await user.click(button("Move pin"));
    await user.click(button("Use my location"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your location is only accurate to about 800 m, so the pin isn't placed yet.",
    );
    // The strip agrees with the alert: not placed.
    expect(strip()).toHaveTextContent("Move the map until the pin is on the toilet's entrance.");
    expect(strip()).not.toHaveAttribute("data-placed");

    await moveOn();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(await resolveWith(controller)).toEqual({ kind: "unplaced", accuracy: 800 });
    expect(onChange).toHaveBeenCalledTimes(1);

    // A pan from there places it again, as usual.
    pan({ lat: 52.9502, lng: -1.15 });
    expect(await resolveWith(controller)).toMatchObject({ kind: "ok", source: "auto" });
    expect(onChange).toHaveBeenLastCalledWith(52.9502, -1.15);
  });
});

describe("LocationPicker: a resize (a phone rotated) is not a pan", () => {
  /** A window resize: Leaflet nudges the centre, then fires the debounced moveend. */
  const resize = (jitter: [number, number]) => {
    const map = theMap();
    fake.state.resizeJitter = jitter;
    act(() => {
      map.invalidateSize({ debounceMoveend: true });
    });
    act(() => {
      map.fire("moveend");
    });
  };

  it("adding at zoom 14: the centre is put back, so Zoom in still leaves the pin not placed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const controller = makeController();
    render(
      <Harness
        mode="add"
        initial={null}
        onChange={onChange}
        controllerRef={controller}
        initialView={{ lat: 51.5, lng: -0.12, zoom: 14 }}
      />,
    );
    // At zoom 14, half a pixel is several metres.
    resize([3, -2]);
    expect(theMap().getCenter()).toEqual({ lat: 51.5, lng: -0.12 });

    await user.click(button("Zoom in"));
    expect(statusText()).not.toContain("Pin placed.");
    expect(strip()).toHaveTextContent("Move the map until the pin is on the toilet's entrance.");
    await moveOn();
    expect(onChange).not.toHaveBeenCalled();
    expect(await resolveWith(controller)).toEqual({ kind: "unplaced" });
  });

  it("editing: no 'Moved under 1 m', and a search jump still needs checking", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onPendingChange = vi.fn();
    const controller = makeController();
    render(
      <Harness
        initial={ORIGINAL}
        originalLocation={ORIGINAL}
        onChange={onChange}
        onPendingChange={onPendingChange}
        controllerRef={controller}
      />,
    );
    await user.click(button("Move pin"));
    resize([0.4, 0.4]); // 0.57 m: more than "not moved"
    expect(screen.queryByText(/^Moved /)).toBeNull();
    expect(onPendingChange).not.toHaveBeenCalledWith(expect.objectContaining({ keepable: true }));
    expect(await resolveWith(controller)).toEqual({
      kind: "ok",
      location: ORIGINAL,
      source: null,
    });
    expect(onChange).not.toHaveBeenCalled();

    // Jump to typed coordinates, then rotate the phone: still not kept without a check.
    await user.click(button("Move pin"));
    const near = offset(ORIGINAL, 20, 0);
    await user.click(screen.getByText("Enter coordinates"));
    const field = screen.getByRole("textbox", { name: "Latitude, longitude" });
    await user.clear(field);
    await user.type(field, `${near.lat.toFixed(6)}, ${near.lng.toFixed(6)}{Enter}`);
    resize([0.4, -0.4]);
    expect(await resolveWith(controller)).toEqual({
      kind: "blocked",
      issue: "jump",
      jump: "coords",
    });
  });

  it("doesn't close an open duplicate question", async () => {
    const SPOT = { lat: 51.5, lng: -0.12 };
    proximityRows = [
      { id: "dup1", name: "Station toilets", location: offset(SPOT, 8, 0), active: true },
    ];
    render(
      <Harness
        mode="add"
        initial={null}
        onChange={vi.fn()}
        apiUrl="https://api.test"
        initialView={{ ...SPOT, zoom: 18 }}
      />,
    );
    await screen.findByRole("group", { name: /There's already a toilet/ }, { timeout: 2000 });
    resize([0.3, 0.3]);
    expect(screen.getByRole("group", { name: /There's already a toilet/ })).toBeInTheDocument();
  });
});

describe("LocationPicker: keyboard and focus", () => {
  it("the locked map is not a Tab stop (Leaflet makes it one as it starts)", async () => {
    const user = userEvent.setup();
    render(<Harness initial={ORIGINAL} originalLocation={ORIGINAL} onChange={vi.fn()} />);
    const map = fake.containers[0];
    expect(map.tabIndex).toBe(-1);
    await user.click(button("Move pin"));
    expect(map.tabIndex).toBe(0);
    await user.click(button("Cancel"));
    expect(map.tabIndex).toBe(-1);
  });

  it("a duplicate question asked while 'Use this location' has focus takes the focus", async () => {
    const SPOT = { lat: 51.5, lng: -0.12 };
    proximityRows = [
      { id: "dup1", name: "Station toilets", location: offset(SPOT, 8, 0), active: true },
    ];
    render(
      <Harness
        mode="add"
        initial={null}
        onChange={vi.fn()}
        apiUrl="https://api.test"
        initialView={{ ...SPOT, zoom: 18 }}
      />,
    );
    // A keyboard user tabs to the button before the check (debounced) comes back.
    act(() => button("Use this location").focus());
    const prompt = await screen.findByRole(
      "group",
      { name: /There's already a toilet 8 m away/ },
      { timeout: 2000 },
    );
    await waitFor(() => expect(prompt).toHaveFocus());
  });
});

describe("LocationPicker: what the strip and buttons look like", () => {
  it("a big move isn't shown as OK, and says what to do only once", async () => {
    const user = userEvent.setup();
    render(<Harness initial={ORIGINAL} originalLocation={ORIGINAL} onChange={vi.fn()} />);
    await user.click(button("Move pin"));
    pan(offset(ORIGINAL, 60, 0));
    expect(strip()).toHaveTextContent(/^Moved 60 m north\.$/);
    expect(strip()).toHaveAttribute("data-blocked", "true");
    expect(strip()).not.toHaveAttribute("data-placed");
    // The strip is a compact DS Notice in the warning tone (not a bespoke bordered line).
    expect(strip().querySelector(".notice")).toHaveClass("notice--warning", "notice--compact");
    const warning = screen.getByText(BIG_MOVE_WARNING).closest("[role=alert]") as HTMLElement;
    expect(warning).toHaveTextContent(BIG_MOVE_HINT);

    pan(offset(ORIGINAL, 10, 0));
    expect(strip()).toHaveAttribute("data-placed", "true");
    expect(strip()).not.toHaveAttribute("data-blocked");
    expect(strip().querySelector(".notice")).toHaveClass("notice--success");
    // The strip is described by the map, not announced (the picker has its own live region).
    expect(strip().querySelector("[role]")).toBeNull();
  });

  it("puts the chip at the bottom when the grey pin is above the centre", async () => {
    const user = userEvent.setup();
    render(<Harness initial={ORIGINAL} originalLocation={ORIGINAL} onChange={vi.fn()} />);
    await user.click(button("Move pin"));
    pan(offset(ORIGINAL, -10, 0)); // moved south: the grey pin is north of the centre
    expect(screen.getByText(/^Moved 10 m south$/)).toHaveAttribute("data-position", "bottom");
    pan(offset(ORIGINAL, 10, 0));
    expect(screen.getByText(/^Moved 10 m north$/)).not.toHaveAttribute("data-position");
  });

  it("adding, 'Use this location' is a secondary button; editing, it is the primary one", async () => {
    const user = userEvent.setup();
    const first = render(
      <Harness
        mode="add"
        initial={null}
        onChange={vi.fn()}
        initialView={{ lat: 51.5, lng: -0.12, zoom: 17 }}
      />,
    );
    expect(button("Use this location")).toHaveClass("button--secondary");
    pan({ lat: 51.501, lng: -0.12 });
    expect(button("Use this location")).toHaveClass("button--secondary");
    first.unmount();
    fake.maps.length = 0;
    fake.containers.length = 0;

    render(<Harness initial={ORIGINAL} originalLocation={ORIGINAL} onChange={vi.fn()} />);
    await user.click(button("Move pin"));
    expect(button("Use this location")).not.toHaveClass("button--secondary");
  });

  it("Move pin keeps the map where it was on screen as the search box appears above it", async () => {
    const user = userEvent.setup();
    render(<Harness initial={ORIGINAL} originalLocation={ORIGINAL} onChange={vi.fn()} />);
    const map = fake.containers[0];
    let top = 200;
    vi.spyOn(map, "getBoundingClientRect").mockImplementation(() => ({ top }) as DOMRect);
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    const click = user.click(button("Move pin"));
    top = 200; // read as Move pin is pressed…
    await click;
    expect(scrollBy).not.toHaveBeenCalled(); // (nothing moved in happy-dom)

    await user.click(button("Cancel"));
    // …and the toolbar pushed it down by 150 px: scroll by as much.
    vi.spyOn(map, "getBoundingClientRect")
      .mockImplementationOnce(() => ({ top: 200 }) as DOMRect)
      .mockImplementation(() => ({ top: 350 }) as DOMRect);
    await user.click(button("Move pin"));
    expect(scrollBy).toHaveBeenCalledWith(0, 150);
  });
});
