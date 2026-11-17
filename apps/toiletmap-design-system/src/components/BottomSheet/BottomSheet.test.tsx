import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BottomSheet, { type BottomSheetProps, type BottomSheetState } from "./BottomSheet";

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

const renderSheet = (props: Partial<BottomSheetProps> & { state: BottomSheetState }) => {
  const onStateChange = props.onStateChange ?? vi.fn();
  act(() => {
    render(
      <div>
        <BottomSheet
          aria-labelledby="sheet-title"
          handleLabel="Toilet details"
          {...props}
          onStateChange={onStateChange}
        >
          <h2 id="sheet-title">High Street</h2>
          <button type="button">Inside</button>
        </BottomSheet>
      </div>,
      container,
    );
  });
  return onStateChange;
};

const sheet = () => container.querySelector<HTMLElement>(".bottom-sheet") as HTMLElement;
const handle = () =>
  container.querySelector<HTMLButtonElement>(".bottom-sheet__handle") as HTMLButtonElement;
const inside = () =>
  Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === "Inside",
  ) as HTMLButtonElement;

const keydown = (target: HTMLElement, key: string) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

const pointer = (type: string, clientY: number) => {
  const event = new PointerEvent(type, { bubbles: true, clientY, pointerId: 1, button: 0 });
  act(() => {
    handle().dispatchEvent(event);
  });
};

describe("BottomSheet", () => {
  it("is a named, non-modal region", () => {
    renderSheet({ state: "peek" });
    // A named <section> is a region landmark.
    expect(sheet().tagName).toBe("SECTION");
    expect(sheet().getAttribute("aria-labelledby")).toBe("sheet-title");
    expect(sheet().hasAttribute("aria-modal")).toBe(false);
    expect(container.querySelector(".sheet__overlay")).toBeNull();
  });

  it("falls back to aria-label without a heading id", () => {
    renderSheet({ state: "peek", "aria-labelledby": undefined, "aria-label": "Details" });
    expect(sheet().getAttribute("aria-label")).toBe("Details");
  });

  it.each([
    ["peek", "false"],
    ["expanded", "true"],
  ] as const)("reflects the %s state on the sheet and the handle", (state, expanded) => {
    renderSheet({ state });
    expect(sheet().dataset.state).toBe(state);
    expect(sheet().classList.contains(`bottom-sheet--${state}`)).toBe(true);
    expect(handle().getAttribute("aria-expanded")).toBe(expanded);
    expect(handle().getAttribute("aria-label")).toBe("Toilet details");
    const body = container.querySelector(".bottom-sheet__body") as HTMLElement;
    expect(handle().getAttribute("aria-controls")).toBe(body.id);
  });

  it("points aria-controls at the given content", () => {
    renderSheet({ state: "peek", controls: "details-1" });
    expect(handle().getAttribute("aria-controls")).toBe("details-1");
  });

  it("toggles between the states when the handle is clicked", () => {
    const onPeek = renderSheet({ state: "peek" });
    act(() => handle().click());
    expect(onPeek).toHaveBeenLastCalledWith("expanded");
    const onExpanded = renderSheet({ state: "expanded", onStateChange: vi.fn() });
    act(() => handle().click());
    expect(onExpanded).toHaveBeenLastCalledWith("peek");
  });

  describe("Escape", () => {
    it("collapses an expanded sheet and keeps the key from page-level handlers", () => {
      const onDismiss = vi.fn();
      const onWindowKey = vi.fn();
      window.addEventListener("keydown", onWindowKey);
      const onStateChange = renderSheet({ state: "expanded", onDismiss });
      const event = keydown(inside(), "Escape");
      window.removeEventListener("keydown", onWindowKey);
      expect(onStateChange).toHaveBeenCalledWith("peek");
      expect(onDismiss).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(onWindowKey).not.toHaveBeenCalled();
    });

    it("dismisses at peek", () => {
      const onDismiss = vi.fn();
      const onStateChange = renderSheet({ state: "peek", onDismiss });
      keydown(inside(), "Escape");
      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(onStateChange).not.toHaveBeenCalled();
    });

    it("lets Escape through at peek when it can't be dismissed", () => {
      renderSheet({ state: "peek" });
      expect(keydown(inside(), "Escape").defaultPrevented).toBe(false);
    });

    it("ignores other keys and Escape outside the sheet", () => {
      const onDismiss = vi.fn();
      const onStateChange = renderSheet({ state: "expanded", onDismiss });
      keydown(inside(), "Enter");
      keydown(document.body, "Escape");
      expect(onStateChange).not.toHaveBeenCalled();
      expect(onDismiss).not.toHaveBeenCalled();
    });
  });

  describe("dragging the handle", () => {
    it("expands on a drag up and swallows the click that follows", () => {
      const onStateChange = renderSheet({ state: "peek" });
      pointer("pointerdown", 500);
      pointer("pointermove", 420);
      expect(sheet().classList.contains("bottom-sheet--dragging")).toBe(true);
      // Upward drags only nudge the sheet.
      expect(sheet().style.transform).toBe("translateY(-24px)");
      pointer("pointerup", 420);
      act(() => handle().click());
      expect(onStateChange).toHaveBeenCalledTimes(1);
      expect(onStateChange).toHaveBeenCalledWith("expanded");
      expect(sheet().style.transform).toBe("");
    });

    it("collapses on a drag down when expanded, and dismisses at peek", () => {
      const onDismiss = vi.fn();
      const onStateChange = renderSheet({ state: "expanded", onDismiss });
      pointer("pointerdown", 100);
      pointer("pointermove", 180);
      expect(sheet().style.transform).toBe("translateY(80px)");
      pointer("pointerup", 180);
      expect(onStateChange).toHaveBeenCalledWith("peek");

      renderSheet({ state: "peek", onDismiss, onStateChange });
      pointer("pointerdown", 100);
      pointer("pointermove", 200);
      pointer("pointerup", 200);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("snaps back after a short drag", () => {
      const onDismiss = vi.fn();
      const onStateChange = renderSheet({ state: "peek", onDismiss });
      pointer("pointerdown", 100);
      pointer("pointermove", 120);
      pointer("pointerup", 120);
      expect(onStateChange).not.toHaveBeenCalled();
      expect(onDismiss).not.toHaveBeenCalled();
      expect(sheet().classList.contains("bottom-sheet--dragging")).toBe(false);
    });

    it("treats a press without movement as a tap", () => {
      const onStateChange = renderSheet({ state: "peek" });
      pointer("pointerdown", 100);
      pointer("pointermove", 103);
      pointer("pointerup", 103);
      act(() => handle().click());
      expect(onStateChange).toHaveBeenCalledWith("expanded");
    });
  });
});
