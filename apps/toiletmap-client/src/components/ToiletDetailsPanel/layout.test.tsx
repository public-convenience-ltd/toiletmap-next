import { act, render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LooDetail } from "../../api/loos";
import ToiletDetailsPanel from "./index";
import { measureOccludes, type PanelLayout } from "./layout";

const toilet: LooDetail = {
  id: "0123456789abcdef01234567",
  name: "High Street toilets",
  location: { lat: 51.5, lng: -0.14 },
  accessible: true,
  allGender: null,
  men: true,
  women: true,
  children: null,
  babyChange: false,
  radar: null,
  automatic: null,
  noPayment: true,
  paymentDetails: null,
  openingTimes: null,
  updatedAt: "2026-11-01T10:00:00.000Z",
  active: true,
};

const noop = () => undefined;

describe("measureOccludes", () => {
  const container = { width: 1280, height: 720 };

  it("covers a bottom strip for the sheet", () => {
    expect(
      measureOccludes("sheet", { top: 480, left: 0, width: 400, height: 240 }, container),
    ).toEqual({
      top: 0,
      right: 0,
      bottom: 240,
      left: 0,
    });
  });

  it("covers a left strip for the card", () => {
    expect(
      measureOccludes("card", { top: 88, left: 16, width: 400, height: 300 }, container),
    ).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 416,
    });
  });

  it("covers nothing while the panel has no size, and never more than the container", () => {
    expect(
      measureOccludes("sheet", { top: 0, left: 0, width: 0, height: 0 }, container).bottom,
    ).toBe(0);
    expect(
      measureOccludes("card", { top: 0, left: 1000, width: 400, height: 10 }, container).left,
    ).toBe(1280);
    expect(
      measureOccludes("sheet", { top: -50, left: 0, width: 10, height: 900 }, container).bottom,
    ).toBe(720);
  });
});

describe("onLayoutChange (ResizeObserver)", () => {
  /** Layout boxes the fake DOM reports, by element. */
  const boxes = new Map<Element, { top: number; left: number; width: number; height: number }>();
  let observers: Array<{ callback: ResizeObserverCallback; targets: Element[] }>;
  let mapContainer: HTMLElement;

  const box = (el: Element) => boxes.get(el) ?? { top: 0, left: 0, width: 0, height: 0 };
  const panel = () => document.querySelector(".toilet-panel") as HTMLElement;
  const resize = () =>
    act(() => {
      for (const o of observers) o.callback([], {} as ResizeObserver);
    });

  const setViewport = (kind: "card" | "sheet") =>
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query.includes("min-width: 768px") ? kind === "card" : false,
        media: query,
        addEventListener: noop,
        removeEventListener: noop,
      })),
    );

  beforeEach(() => {
    observers = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        targets: Element[] = [];
        constructor(callback: ResizeObserverCallback) {
          observers.push({ callback, targets: this.targets });
        }
        observe(el: Element) {
          this.targets.push(el);
        }
        unobserve() {
          // Not used by the panel.
        }
        disconnect() {
          this.targets.length = 0;
        }
      },
    );
    // Panels are measured as soon as they mount: answer from the element's class.
    const sized = (key: "top" | "left" | "width" | "height") =>
      function (this: HTMLElement) {
        if (this.classList.contains("toilet-panel") && !boxes.has(this)) {
          boxes.set(this, { ...(boxes.get(panelDefaults) ?? box(panelDefaults)) });
        }
        return box(this)[key];
      };
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(sized("top"));
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(sized("left"));
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(sized("width"));
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(sized("height"));
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return box(this).width;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return box(this).height;
    });
    // happy-dom has no offsetParent: the panel falls back to its parent, the map container.
    mapContainer = document.createElement("div");
    document.body.appendChild(mapContainer);
  });

  afterEach(() => {
    boxes.clear();
    mapContainer.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** The box the next mounted panel starts with. */
  const panelDefaults = document.createElement("i");

  it("reports the desktop card's left strip, then again when it grows on expand", async () => {
    setViewport("card");
    boxes.set(mapContainer, { top: 0, left: 0, width: 1280, height: 720 });
    boxes.set(panelDefaults, { top: 88, left: 16, width: 400, height: 180 });
    const onLayoutChange = vi.fn<(layout: PanelLayout) => void>();
    render(<ToiletDetailsPanel toilet={toilet} onClose={noop} onLayoutChange={onLayoutChange} />, {
      container: mapContainer,
    });
    expect(onLayoutChange).toHaveBeenLastCalledWith({
      mode: "card",
      state: "peek",
      occludes: { top: 0, right: 0, bottom: 0, left: 416 },
    });
    // The panel and the map container are both observed.
    expect(observers.flatMap((o) => o.targets)).toEqual(
      expect.arrayContaining([panel(), mapContainer]),
    );

    const user = userEvent.setup();
    boxes.set(panel(), { top: 88, left: 16, width: 400, height: 600 });
    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(onLayoutChange).toHaveBeenLastCalledWith({
      mode: "card",
      state: "expanded",
      occludes: { top: 0, right: 0, bottom: 0, left: 416 },
    });
  });

  it("reports the sheet's bottom strip as it resizes, without repeats", () => {
    setViewport("sheet");
    boxes.set(mapContainer, { top: 0, left: 0, width: 412, height: 800 });
    boxes.set(panelDefaults, { top: 600, left: 0, width: 412, height: 200 });
    const onLayoutChange = vi.fn<(layout: PanelLayout) => void>();
    render(<ToiletDetailsPanel toilet={toilet} onClose={noop} onLayoutChange={onLayoutChange} />, {
      container: mapContainer,
    });
    expect(onLayoutChange).toHaveBeenLastCalledWith({
      mode: "sheet",
      state: "peek",
      occludes: { top: 0, right: 0, bottom: 200, left: 0 },
    });
    const calls = onLayoutChange.mock.calls.length;
    resize();
    expect(onLayoutChange).toHaveBeenCalledTimes(calls);

    // The content grows (e.g. a notice appears): the sheet's top moves up.
    boxes.set(panel(), { top: 480, left: 0, width: 412, height: 320 });
    resize();
    expect(onLayoutChange).toHaveBeenLastCalledWith({
      mode: "sheet",
      state: "peek",
      occludes: { top: 0, right: 0, bottom: 320, left: 0 },
    });
  });

  it("reports the expanded sheet, capped by the CSS at 60% of the map", () => {
    setViewport("sheet");
    boxes.set(mapContainer, { top: 0, left: 0, width: 412, height: 800 });
    boxes.set(panelDefaults, { top: 320, left: 0, width: 412, height: 480 });
    const onLayoutChange = vi.fn<(layout: PanelLayout) => void>();
    render(
      <ToiletDetailsPanel
        toilet={toilet}
        onClose={noop}
        initialExpanded
        onLayoutChange={onLayoutChange}
      />,
      { container: mapContainer },
    );
    expect(onLayoutChange).toHaveBeenLastCalledWith({
      mode: "sheet",
      state: "expanded",
      occludes: { top: 0, right: 0, bottom: 480, left: 0 },
    });
  });

  it("stops observing on close", () => {
    setViewport("card");
    boxes.set(mapContainer, { top: 0, left: 0, width: 1280, height: 720 });
    boxes.set(panelDefaults, { top: 88, left: 16, width: 400, height: 180 });
    const { unmount } = render(
      <ToiletDetailsPanel toilet={toilet} onClose={noop} onLayoutChange={vi.fn()} />,
      { container: mapContainer },
    );
    unmount();
    expect(observers.every((o) => o.targets.length === 0)).toBe(true);
  });
});
