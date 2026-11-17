import { fireEvent, render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LocationPicker from "./LocationPicker";

/**
 * Leaflet does not run in happy-dom, so it is replaced with a fake that records every event
 * handler registered on the map and the marker. That lets these tests prove the pin can only be
 * moved by dragging it or by the explicit buttons — never by clicking/tapping the map.
 */
type Handler = (e: unknown) => void;

const fake = vi.hoisted(() => {
  const toLatLng = (value: unknown) => {
    const [lat, lng] = Array.isArray(value)
      ? (value as [number, number])
      : [(value as { lat: number }).lat, (value as { lng: number }).lng];
    return {
      lat,
      lng,
      // Rough metres, enough for the picker's "far away → recentre" check.
      distanceTo: (other: unknown) => {
        const o = toLatLng(other);
        return Math.hypot(o.lat - lat, o.lng - lng) * 111_000;
      },
    };
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

  const createMap = () => {
    const map = withEvents({
      setView: vi.fn((latLng: unknown, zoom?: number) => {
        state.center = toLatLng(latLng);
        if (typeof zoom === "number") state.zoom = zoom;
        return map;
      }),
      flyTo: vi.fn(() => map),
      panTo: vi.fn(() => map),
      getCenter: vi.fn(() => state.center),
      getZoom: vi.fn(() => state.zoom),
      getSize: vi.fn(() => ({ x: 400, y: 300 })),
      // Treat every marker as sitting at the centre point; crosshair logic is unit-tested elsewhere.
      latLngToContainerPoint: vi.fn(() => ({ x: 200, y: 150 })),
      remove: vi.fn(),
    });
    return map;
  };

  const createMarker = (initial: unknown) => {
    let latLng = toLatLng(initial);
    const marker = withEvents({
      addTo: vi.fn(() => marker),
      remove: vi.fn(),
      setLatLng: vi.fn((value: unknown) => {
        latLng = toLatLng(value);
        return marker;
      }),
      getLatLng: vi.fn(() => latLng),
      /** Simulates the user dragging the marker and releasing it at `to`. */
      dragTo(to: [number, number]) {
        latLng = toLatLng(to);
        marker.fire("drag");
        marker.fire("dragend");
      },
    });
    return marker;
  };

  return {
    state,
    toLatLng,
    maps: [] as ReturnType<typeof createMap>[],
    /** The element each map was created on (`L.map(container)`). */
    containers: [] as HTMLElement[],
    markers: [] as ReturnType<typeof createMarker>[],
    createMap,
    createMarker,
  };
});

vi.mock("leaflet", () => {
  const L = {
    Icon: { Default: { prototype: {}, mergeOptions: vi.fn() } },
    map: vi.fn((container: HTMLElement) => {
      const map = fake.createMap();
      fake.maps.push(map);
      fake.containers.push(container);
      return map;
    }),
    tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
    marker: vi.fn((latLng: unknown) => {
      const marker = fake.createMarker(latLng);
      fake.markers.push(marker);
      return marker;
    }),
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

const theMap = () => {
  expect(fake.maps).toHaveLength(1);
  return fake.maps[0];
};

beforeEach(() => {
  fake.maps.length = 0;
  fake.containers.length = 0;
  fake.markers.length = 0;
  fake.state.center = fake.toLatLng([51.5, -0.12]);
  fake.state.zoom = 13;
});

describe("LocationPicker", () => {
  it("registers no click/tap/press handler on the map", () => {
    render(<LocationPicker location={ORIGINAL} onChange={vi.fn()} originalLocation={ORIGINAL} />);

    const registered = [...theMap().handlers.keys()];
    expect(registered.length).toBeGreaterThan(0); // sanity: the crosshair listeners exist
    for (const event of POINTER_EVENTS) {
      expect(registered, `map has a "${event}" handler`).not.toContain(event);
    }
  });

  it.each([
    ["with a pin", ORIGINAL],
    ["without a pin", null],
  ])("never moves the pin from any map event (%s)", (_label, location) => {
    const onChange = vi.fn();
    render(<LocationPicker location={location} onChange={onChange} />);
    const map = theMap();

    for (const marker of fake.markers) marker.setLatLng.mockClear();

    const latlng = fake.toLatLng([51.7, -0.3]);
    const names = new Set([...map.handlers.keys(), ...POINTER_EVENTS]);
    for (const name of names) {
      map.fire(name, { latlng, containerPoint: { x: 10, y: 10 }, layerPoint: { x: 10, y: 10 } });
    }

    // And the real DOM events, on the element the map was created on (and so bubbling from it).
    expect(fake.containers).toHaveLength(1);
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
    // The marker was not moved behind the form's back either.
    for (const marker of fake.markers) expect(marker.setLatLng).not.toHaveBeenCalled();
  });

  it("reports the new position (rounded to 6 dp) when the marker is dragged", () => {
    const onChange = vi.fn();
    render(<LocationPicker location={ORIGINAL} onChange={onChange} />);

    expect(fake.markers).toHaveLength(1);
    fake.markers[0].dragTo([51.50987654321, -0.14012345678]);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(51.509877, -0.140123);
  });

  it("moves the pin to the map centre on 'Move pin to centre of map'", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LocationPicker location={ORIGINAL} onChange={onChange} />);
    fake.state.center = fake.toLatLng([51.5123456789, -0.1198765432]);

    await user.click(screen.getByRole("button", { name: "Move pin to centre of map" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(51.512346, -0.119877);
  });

  it("places the first pin at the map centre on 'Place pin here'", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LocationPicker location={null} onChange={onChange} />);

    expect(fake.markers).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Place pin here" }));

    // The picker opens on its default centre when there is no pin yet.
    expect(onChange).toHaveBeenCalledWith(51.505, -0.09);
  });

  it("only offers reset once the pin has moved, and reset restores the exact original", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <LocationPicker location={ORIGINAL} onChange={onChange} originalLocation={ORIGINAL} />,
    );
    expect(screen.queryByRole("button", { name: "Reset to original location" })).toBeNull();

    const moved = { lat: 51.51, lng: -0.15 };
    rerender(<LocationPicker location={moved} onChange={onChange} originalLocation={ORIGINAL} />);
    expect(fake.markers[0].setLatLng).toHaveBeenLastCalledWith([moved.lat, moved.lng]);

    await user.click(screen.getByRole("button", { name: "Reset to original location" }));

    // Unrounded, so the form sees no location change at all.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(ORIGINAL.lat, ORIGINAL.lng);
    expect(theMap().setView).toHaveBeenLastCalledWith([ORIGINAL.lat, ORIGINAL.lng], 17);
  });

  it("hands its map to onMapReady, and null on unmount", () => {
    const onMapReady = vi.fn();
    const { unmount } = render(
      <LocationPicker location={ORIGINAL} onChange={vi.fn()} onMapReady={onMapReady} />,
    );
    expect(onMapReady).toHaveBeenLastCalledWith(theMap());

    unmount();
    expect(onMapReady).toHaveBeenLastCalledWith(null);
    expect(theMap().remove).toHaveBeenCalled();
  });
});
