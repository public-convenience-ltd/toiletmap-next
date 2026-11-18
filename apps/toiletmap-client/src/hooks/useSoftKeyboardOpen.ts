import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

/** `<input>` types that never bring up the on-screen keyboard. */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * The visible viewport has to shrink below this share of its keyboard-less height before we
 * call the keyboard open: browser chrome sliding in and out moves it by far less.
 */
export const KEYBOARD_SHRINK_RATIO = 0.75;

/** An editable field that brings up the on-screen keyboard on a touch screen. */
export const isTextEntry = (target: EventTarget | null): boolean => {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return !target.disabled && !target.readOnly;
  if (target instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(target.type) && !target.disabled && !target.readOnly;
  }
  return target.isContentEditable;
};

/**
 * The height of what the user can see, in layout pixels: `visualViewport.height` alone also
 * shrinks when they pinch-zoom, which is not the keyboard, so it's scaled back up.
 */
const visibleHeight = (win: Window): number => {
  const vv = win.visualViewport;
  return vv ? vv.height * (vv.scale || 1) : win.innerHeight;
};

/**
 * The layout viewport. With the default `interactive-widget=resizes-visual` (Chrome) and on iOS
 * Safari the keyboard doesn't shrink it, but rotating or resizing the window does.
 * `clientWidth/Height` ignore pinch-zoom, where `innerWidth` on iOS doesn't.
 */
const layoutSize = (win: Window): { width: number; height: number } => {
  const root = win.document.documentElement;
  return {
    width: root?.clientWidth || win.innerWidth,
    height: root?.clientHeight || win.innerHeight,
  };
};

/**
 * Whether the on-screen keyboard is (very probably) open over a text field inside `containerRef`.
 *
 * True only on a touch screen (`pointer: coarse`) while a text field in the container has focus
 * and the visual viewport has shrunk well below its height before that field was focused. Where
 * `visualViewport` isn't supported, focus in a text field on a touch screen is enough. Never true
 * with a mouse or trackpad, so desktop layouts never change.
 */
export function useSoftKeyboardOpen(
  containerRef: RefObject<HTMLElement>,
  { enabled = true }: { enabled?: boolean } = {},
): boolean {
  const [open, setOpen] = useState(false);
  /**
   * The visible height without the keyboard, and the layout width it was measured at: re-measured
   * on every resize while no text field has focus, and only ever raised while one does (the
   * keyboard can only take height away), unless the width changes, which is a rotation or a
   * resized window rather than the keyboard. Kept across re-subscriptions, so one made with the
   * keyboard up doesn't take that as normal.
   */
  const baselineRef = useRef<{ height: number; width: number } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container || typeof window === "undefined") {
      setOpen(false);
      return;
    }
    const win = window;
    let coarse: MediaQueryList | null = null;
    try {
      coarse = win.matchMedia?.("(pointer: coarse)") ?? null;
    } catch {
      coarse = null;
    }
    const vv = win.visualViewport ?? null;

    const active = document.activeElement;
    let textFocused = isTextEntry(active) && container.contains(active);

    /**
     * Never below the layout viewport's height, which the keyboard (usually) leaves alone:
     * that also covers a keyboard already up for a field outside the container when focus
     * moves in, and a new orientation measured with the keyboard up.
     */
    const measureBaseline = () => {
      const layout = layoutSize(win);
      const height = Math.max(visibleHeight(win), layout.height);
      const previous = baselineRef.current;
      baselineRef.current =
        textFocused && previous && previous.width === layout.width
          ? { height: Math.max(previous.height, height), width: layout.width }
          : { height, width: layout.width };
    };
    measureBaseline();

    const evaluate = () => {
      const baseline = baselineRef.current?.height ?? visibleHeight(win);
      setOpen(
        !!coarse?.matches &&
          textFocused &&
          (vv ? visibleHeight(win) < baseline * KEYBOARD_SHRINK_RATIO : true),
      );
    };

    const onResize = () => {
      measureBaseline();
      evaluate();
    };

    // Listening on the container, so a focusin target is always inside it.
    const onFocusIn = (event: FocusEvent) => {
      textFocused = isTextEntry(event.target);
      evaluate();
    };
    // Focus leaving the text fields (or the container, or the page) brings the bar back.
    // Moving straight to another text field in the container (the next field, or iOS's arrows)
    // keeps the keyboard up, so it's not even a moment's change: clearing here would render the
    // bar visible between this event and the focusin, and could start it sliding back.
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (isTextEntry(next) && container.contains(next as Node)) return;
      textFocused = false;
      evaluate();
    };

    container.addEventListener("focusin", onFocusIn);
    container.addEventListener("focusout", onFocusOut);
    vv?.addEventListener("resize", onResize);
    win.addEventListener("resize", onResize);
    coarse?.addEventListener?.("change", evaluate);
    evaluate();

    return () => {
      container.removeEventListener("focusin", onFocusIn);
      container.removeEventListener("focusout", onFocusOut);
      vv?.removeEventListener("resize", onResize);
      win.removeEventListener("resize", onResize);
      coarse?.removeEventListener?.("change", evaluate);
    };
  }, [containerRef, enabled]);

  return open;
}
