import { act, renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTextEntry, useSoftKeyboardOpen } from "./useSoftKeyboardOpen";

/** A `(pointer: coarse)` query whose answer the test controls. */
function stubPointer(coarse: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: coarse,
    media: "(pointer: coarse)",
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal("matchMedia", (q: string) =>
    q === "(pointer: coarse)" ? query : { ...query, matches: false, media: q },
  );
  return {
    set(value: boolean) {
      query.matches = value;
      for (const fn of listeners) fn();
    },
    listenerCount: () => listeners.size,
  };
}

/** A visualViewport stand-in: resize it to open or close the "keyboard". */
function stubVisualViewport(height = window.innerHeight) {
  const target = new EventTarget() as EventTarget & { height: number; scale: number };
  target.height = height;
  target.scale = 1;
  vi.stubGlobal("visualViewport", target);
  return {
    target,
    resize(nextHeight: number, scale = 1) {
      target.height = nextHeight;
      target.scale = scale;
      target.dispatchEvent(new Event("resize"));
    },
  };
}

/**
 * Set the layout viewport (what rotating the phone changes, and the keyboard doesn't). jsdom
 * reports 0 for `documentElement.clientWidth/Height`, so the hook falls back to these.
 */
const layoutDescriptors = {
  innerWidth: Object.getOwnPropertyDescriptor(window, "innerWidth"),
  innerHeight: Object.getOwnPropertyDescriptor(window, "innerHeight"),
};
function setLayout(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}
function restoreLayout() {
  for (const [key, descriptor] of Object.entries(layoutDescriptors)) {
    if (descriptor) Object.defineProperty(window, key, descriptor);
    else Reflect.deleteProperty(window, key);
  }
}

let container: HTMLDivElement;
let input: HTMLInputElement;
let textarea: HTMLTextAreaElement;
let checkbox: HTMLInputElement;
let button: HTMLButtonElement;
let outside: HTMLInputElement;

beforeEach(() => {
  container = document.createElement("div");
  input = document.createElement("input");
  textarea = document.createElement("textarea");
  checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  button = document.createElement("button");
  for (const el of [input, textarea, checkbox, button]) container.appendChild(el);
  outside = document.createElement("input");
  document.body.appendChild(container);
  document.body.appendChild(outside);
});

afterEach(() => {
  container.remove();
  outside.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreLayout();
});

const renderOpen = (options?: { enabled?: boolean }) => {
  const ref = { current: container };
  return renderHook(({ enabled }: { enabled?: boolean }) => useSoftKeyboardOpen(ref, { enabled }), {
    initialProps: { enabled: options?.enabled },
  });
};

/** Focus a field, then let the keyboard slide up (the viewport loses ~40%). */
const openKeyboardOn = (el: HTMLElement, viewport: ReturnType<typeof stubVisualViewport>) => {
  act(() => el.focus());
  act(() => viewport.resize(Math.round(window.innerHeight * 0.6)));
};

describe("isTextEntry", () => {
  it("is true for text inputs, textareas and contenteditable, false for everything else", () => {
    expect(isTextEntry(input)).toBe(true);
    expect(isTextEntry(textarea)).toBe(true);
    const email = document.createElement("input");
    email.type = "email";
    expect(isTextEntry(email)).toBe(true);
    expect(isTextEntry(checkbox)).toBe(false);
    expect(isTextEntry(button)).toBe(false);
    const readOnly = document.createElement("input");
    readOnly.readOnly = true;
    expect(isTextEntry(readOnly)).toBe(false);
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.appendChild(editable);
    expect(isTextEntry(editable)).toBe(editable.isContentEditable);
    editable.remove();
    expect(isTextEntry(null)).toBe(false);
  });
});

describe("useSoftKeyboardOpen", () => {
  it("is true on a touch screen while a text field has focus and the viewport has shrunk", () => {
    stubPointer(true);
    const viewport = stubVisualViewport();
    const { result } = renderOpen();
    expect(result.current).toBe(false);

    act(() => input.focus());
    // Focus alone isn't the keyboard: it may not have come up (e.g. a hardware keyboard).
    expect(result.current).toBe(false);

    act(() => viewport.resize(Math.round(window.innerHeight * 0.6)));
    expect(result.current).toBe(true);

    // Keyboard dismissed while the field keeps focus (Android's back gesture).
    act(() => viewport.resize(window.innerHeight));
    expect(result.current).toBe(false);
  });

  it("goes back to false when the field loses focus", () => {
    stubPointer(true);
    const viewport = stubVisualViewport();
    const { result } = renderOpen();
    openKeyboardOn(textarea, viewport);
    expect(result.current).toBe(true);

    // Moving to a button (e.g. Tab to Save) brings the bar back even before the keyboard goes.
    act(() => button.focus());
    expect(result.current).toBe(false);
    act(() => viewport.resize(window.innerHeight));

    openKeyboardOn(input, viewport);
    expect(result.current).toBe(true);
    act(() => input.blur());
    expect(result.current).toBe(false);
  });

  it("ignores non-text controls and fields outside the container", () => {
    stubPointer(true);
    const viewport = stubVisualViewport();
    const { result } = renderOpen();
    openKeyboardOn(checkbox, viewport);
    expect(result.current).toBe(false);
    act(() => viewport.resize(window.innerHeight));
    openKeyboardOn(outside, viewport);
    expect(result.current).toBe(false);
  });

  it("is never true with a fine pointer (mouse or trackpad)", () => {
    stubPointer(false);
    const viewport = stubVisualViewport();
    const { result } = renderOpen();
    openKeyboardOn(input, viewport);
    expect(result.current).toBe(false);
  });

  it("does not mistake a small shrink (browser toolbars) or pinch-zoom for the keyboard", () => {
    stubPointer(true);
    const viewport = stubVisualViewport();
    const { result } = renderOpen();
    act(() => input.focus());
    act(() => viewport.resize(Math.round(window.innerHeight * 0.9)));
    expect(result.current).toBe(false);
    // Zoomed in 2x: half the height is visible, but at twice the scale.
    act(() => viewport.resize(window.innerHeight / 2, 2));
    expect(result.current).toBe(false);
  });

  it("follows the pointer query changing (e.g. a tablet's keyboard cover)", () => {
    const pointer = stubPointer(true);
    const viewport = stubVisualViewport();
    const { result } = renderOpen();
    openKeyboardOn(input, viewport);
    expect(result.current).toBe(true);
    act(() => pointer.set(false));
    expect(result.current).toBe(false);
  });

  it("without visualViewport, a focused text field on a touch screen is enough", () => {
    stubPointer(true);
    vi.stubGlobal("visualViewport", undefined);
    const { result } = renderOpen();
    act(() => input.focus());
    expect(result.current).toBe(true);
    act(() => input.blur());
    expect(result.current).toBe(false);
  });

  it("is false while disabled", () => {
    stubPointer(true);
    const viewport = stubVisualViewport();
    const { result, rerender } = renderOpen();
    openKeyboardOn(input, viewport);
    expect(result.current).toBe(true);
    rerender({ enabled: false });
    expect(result.current).toBe(false);
  });

  it("does not flicker back while focus hops from one text field to the next", () => {
    stubPointer(true);
    const viewport = stubVisualViewport();
    const { result } = renderOpen();
    openKeyboardOn(input, viewport);
    expect(result.current).toBe(true);
    // The focusout on its own, before the focusin on the next field: still open in between.
    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: textarea }));
    });
    expect(result.current).toBe(true);
    act(() => textarea.focus());
    expect(result.current).toBe(true);
    // Leaving for a field outside the form, or a button, does bring the bar back.
    act(() => {
      textarea.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }));
    });
    expect(result.current).toBe(false);
    act(() => input.focus());
    expect(result.current).toBe(true);
    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: button }));
    });
    expect(result.current).toBe(false);
  });

  it("takes a rotation with the keyboard dismissed for a new orientation, not the keyboard", () => {
    setLayout(400, 800);
    stubPointer(true);
    const viewport = stubVisualViewport(800);
    const { result } = renderOpen();
    act(() => input.focus());
    act(() => viewport.resize(480));
    expect(result.current).toBe(true);
    // Android's back gesture: the keyboard goes, the field keeps focus.
    act(() => viewport.resize(800));
    expect(result.current).toBe(false);

    // Portrait to landscape: much shorter, but there's no keyboard.
    act(() => {
      setLayout(800, 360);
      viewport.resize(360);
    });
    expect(result.current).toBe(false);

    // The keyboard coming up in landscape still counts.
    act(() => viewport.resize(200));
    expect(result.current).toBe(true);
  });

  it("still sees the keyboard after rotating with it up", () => {
    setLayout(800, 360);
    stubPointer(true);
    const viewport = stubVisualViewport(360);
    const { result } = renderOpen();
    act(() => input.focus());
    act(() => viewport.resize(200));
    expect(result.current).toBe(true);

    // Landscape to portrait with the keyboard still up: taller than before, but well short of
    // the new orientation's height.
    act(() => {
      setLayout(400, 800);
      viewport.resize(450);
    });
    expect(result.current).toBe(true);

    act(() => viewport.resize(800));
    expect(result.current).toBe(false);
  });

  it("sees a keyboard that was already up for a field outside the container", () => {
    setLayout(400, 800);
    stubPointer(true);
    const viewport = stubVisualViewport(800);
    const { result } = renderOpen();
    openKeyboardOn(outside, viewport);
    expect(result.current).toBe(false);
    act(() => input.focus());
    expect(result.current).toBe(true);
  });

  it("stops listening when unmounted", () => {
    const pointer = stubPointer(true);
    const viewport = stubVisualViewport();
    const spies = [container, viewport.target, window].map((target) => ({
      add: vi.spyOn(target, "addEventListener"),
      remove: vi.spyOn(target, "removeEventListener"),
    }));
    const { unmount } = renderOpen();
    expect(pointer.listenerCount()).toBe(1);
    const [onContainer, onViewport, onWindow] = spies;
    expect(onContainer.add.mock.calls.map(([type]) => type).sort()).toEqual([
      "focusin",
      "focusout",
    ]);
    expect(onViewport.add.mock.calls.map(([type]) => type)).toEqual(["resize"]);
    const windowAdds = onWindow.add.mock.calls.filter(([type]) => type === "resize");
    expect(windowAdds).toHaveLength(1);

    unmount();
    // Each listener removed from where it was added, the same function that was added.
    const added = [
      { calls: onContainer.add.mock.calls, remove: onContainer.remove },
      { calls: onViewport.add.mock.calls, remove: onViewport.remove },
      { calls: windowAdds, remove: onWindow.remove },
    ];
    for (const { calls, remove } of added) {
      for (const [type, fn] of calls) expect(remove).toHaveBeenCalledWith(type, fn);
    }
    expect(pointer.listenerCount()).toBe(0);
  });
});

describe("useSoftKeyboardOpen in a <form>", () => {
  it("works when the container is a form", () => {
    const form = document.createElement("form");
    const field = document.createElement("input");
    form.appendChild(field);
    document.body.appendChild(form);
    stubPointer(true);
    const viewport = stubVisualViewport();
    const ref = { current: form };
    const { result } = renderHook(() => useSoftKeyboardOpen(ref));
    openKeyboardOn(field, viewport);
    expect(result.current).toBe(true);
    form.remove();
  });
});
