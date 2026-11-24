import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastRegion } from "./Toast";
import { createToastStore, DEFAULT_TOAST_DURATION, type ToastStore } from "./toastStore";

let container: HTMLElement;
let store: ToastStore;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  store = createToastStore();
});

afterEach(() => {
  act(() => render(null, container));
  container.remove();
  vi.useRealTimers();
});

const region = () => container.querySelector<HTMLElement>(".toast-region") as HTMLElement;
const live = () => container.querySelector<HTMLElement>("[aria-live]") as HTMLElement;
const items = () => Array.from(container.querySelectorAll<HTMLElement>(".toast-region__item"));
const toastEl = () => container.querySelector<HTMLElement>(".toast") as HTMLElement;

const renderRegion = (props: Parameters<typeof ToastRegion>[0] = {}) =>
  act(() => render(<ToastRegion store={store} {...props} />, container));

const show = (...args: Parameters<ToastStore["show"]>) => {
  let id = "";
  act(() => {
    id = store.show(...args);
  });
  return id;
};

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe("ToastRegion", () => {
  it("is a polite live region that is on the page before any toast", () => {
    renderRegion();
    expect(live().getAttribute("aria-live")).toBe("polite");
    expect(live().getAttribute("aria-label")).toBe("Notifications");
    expect(items()).toHaveLength(0);

    show({ message: "Thanks — your changes are live" });
    expect(live().textContent).toContain("Thanks — your changes are live");
  });

  it("does not give each toast a live role of its own (it would be read twice)", () => {
    renderRegion();
    show({ message: "Saved", tone: "success" });
    show({ message: "Failed", tone: "error" });
    expect(container.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(0);
  });

  it("dismisses a toast after about 6 seconds", () => {
    renderRegion();
    show({ message: "Saved" });
    advance(DEFAULT_TOAST_DURATION - 1);
    expect(items()).toHaveLength(1);
    advance(1);
    expect(items()).toHaveLength(0);
  });

  it("pauses while hovered and carries on with the time left", () => {
    renderRegion();
    show({ message: "Saved", duration: 6000 });
    advance(4000);
    act(() => {
      toastEl().dispatchEvent(new MouseEvent("mouseenter"));
    });
    advance(10_000);
    expect(items()).toHaveLength(1);
    act(() => {
      toastEl().dispatchEvent(new MouseEvent("mouseleave"));
    });
    advance(1999);
    expect(items()).toHaveLength(1);
    advance(1);
    expect(items()).toHaveLength(0);
  });

  it("pauses while focus is inside it", () => {
    renderRegion();
    show({ message: "Saved", duration: 6000 });
    const dismiss = container.querySelector<HTMLButtonElement>(".notice__dismiss");
    act(() => dismiss?.focus());
    advance(20_000);
    expect(items()).toHaveLength(1);
    act(() => dismiss?.blur());
    advance(6000);
    expect(items()).toHaveLength(0);
  });

  it("keeps a toast with duration null until it is dismissed", () => {
    renderRegion();
    show({ message: "Offline", tone: "warning", duration: null });
    advance(60_000);
    expect(items()).toHaveLength(1);
    act(() => container.querySelector<HTMLButtonElement>(".notice__dismiss")?.click());
    expect(items()).toHaveLength(0);
  });

  it("has a named dismiss button, and Escape inside the toast dismisses it", () => {
    renderRegion();
    const onDismiss = vi.fn();
    show({ message: "Saved", dismissLabel: "Dismiss message", onDismiss });
    const button = container.querySelector<HTMLButtonElement>(".notice__dismiss");
    expect(button?.getAttribute("aria-label")).toBe("Dismiss message");

    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    act(() => {
      button?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    document.removeEventListener("keydown", outer);
    expect(items()).toHaveLength(0);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("runs the action, then dismisses unless told not to", () => {
    renderRegion();
    const onClick = vi.fn();
    show({ message: "Removed", action: { label: "Undo", onClick } });
    const actionButton = () =>
      container.querySelector<HTMLButtonElement>(".notice__actions button");
    act(() => actionButton()?.click());
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(items()).toHaveLength(0);

    show({ message: "Removed", action: { label: "Details", onClick, dismiss: false } });
    act(() => actionButton()?.click());
    expect(items()).toHaveLength(1);
  });

  it("replaces a toast shown again with the same id, restarting its timer", () => {
    renderRegion();
    show({ id: "saved", message: "Saved" });
    advance(5000);
    show({ id: "saved", message: "Saved again" });
    expect(items()).toHaveLength(1);
    expect(live().textContent).toContain("Saved again");
    advance(5000);
    expect(items()).toHaveLength(1);
    advance(1000);
    expect(items()).toHaveLength(0);
  });

  it("shows at most `max` toasts, the newest", () => {
    renderRegion({ max: 2 });
    show({ message: "One" });
    show({ message: "Two" });
    show({ message: "Three" });
    expect(items().map((li) => li.querySelector(".notice__content")?.textContent)).toEqual([
      "Two",
      "Three",
    ]);
  });

  it("sits at the bottom by default, or the top, offset by --toast-offset", () => {
    renderRegion({ offset: 120 });
    expect(region().classList.contains("toast-region--bottom")).toBe(true);
    expect(region().style.getPropertyValue("--toast-offset")).toBe("120px");

    renderRegion({ placement: "top", offset: "var(--header-height)" });
    expect(region().classList.contains("toast-region--top")).toBe(true);
    expect(region().style.getPropertyValue("--toast-offset")).toBe("var(--header-height)");
  });

  it("uses the success tone by default and any tone it is given", () => {
    renderRegion();
    show({ message: "Saved" });
    show({ message: "Offline", tone: "warning", duration: null });
    const tones = items().map((li) => li.querySelector(".notice")?.className);
    expect(tones[0]).toContain("notice--success");
    expect(tones[1]).toContain("notice--warning");
  });

  it("picks up toasts shown before it mounted", () => {
    store.show({ message: "Early" });
    renderRegion();
    expect(live().textContent).toContain("Early");
  });
});

describe("toast store", () => {
  it("dismiss and clear call onDismiss once each", () => {
    const a = vi.fn();
    const b = vi.fn();
    const id = store.show({ message: "A", onDismiss: a });
    store.show({ message: "B", onDismiss: b });
    store.dismiss(id);
    store.dismiss(id);
    expect(a).toHaveBeenCalledTimes(1);
    store.clear();
    expect(b).toHaveBeenCalledTimes(1);
    expect(store.getAll()).toEqual([]);
  });

  it("notifies subscribers until they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.show({ message: "A" });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.show({ message: "B" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
