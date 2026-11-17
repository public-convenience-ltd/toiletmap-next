import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

/** At this width and above the panel is a floating card; below, a bottom sheet. */
export const CARD_MEDIA_QUERY = "(min-width: 768px)";

export type PanelMode = "sheet" | "card";
export type PanelState = "peek" | "expanded";

export interface Occludes {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** What the panel covers, for the map to keep the selected marker clear of it (contract P1). */
export interface PanelLayout {
  mode: PanelMode;
  state: PanelState;
  /** Pixels of the map container the panel covers, measured in from each edge. */
  occludes: Occludes;
}

const matches = (query: string) => {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.(query).matches;
  } catch {
    return false;
  }
};

/** "card" at ≥768px, else "sheet"; follows the media query as the window resizes. */
export function usePanelMode(): PanelMode {
  const [card, setCard] = useState(() => matches(CARD_MEDIA_QUERY));
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const list = window.matchMedia(CARD_MEDIA_QUERY);
    const onChange = () => setCard(list.matches);
    onChange();
    list.addEventListener?.("change", onChange);
    return () => list.removeEventListener?.("change", onChange);
  }, []);
  return card ? "card" : "sheet";
}

const clamp = (value: number, max: number) =>
  Math.round(Math.min(Math.max(value, 0), Math.max(max, 0)));

/** A box in the container's coordinates (layout position: transforms don't count). */
export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * What the panel covers of its container. A bottom sheet covers a strip along the bottom
 * edge (everything below its top); a card on the left covers a strip along the left edge
 * (everything left of its right edge).
 */
export function measureOccludes(
  mode: PanelMode,
  panel: Box,
  container: { width: number; height: number },
): Occludes {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  if (panel.width <= 0 || panel.height <= 0) return none;
  if (mode === "sheet") {
    return { ...none, bottom: clamp(container.height - panel.top, container.height) };
  }
  return { ...none, left: clamp(panel.left + panel.width, container.width) };
}

/**
 * The panel's box relative to its offset parent (the map container). Layout offsets, not
 * client rects, so the sheet's slide-in animation or a drag in progress doesn't skew it.
 */
function panelBox(panel: HTMLElement): Box {
  return {
    top: panel.offsetTop,
    left: panel.offsetLeft,
    width: panel.offsetWidth,
    height: panel.offsetHeight,
  };
}

const sameLayout = (a: PanelLayout | null, b: PanelLayout) =>
  !!a &&
  a.mode === b.mode &&
  a.state === b.state &&
  a.occludes.top === b.occludes.top &&
  a.occludes.right === b.occludes.right &&
  a.occludes.bottom === b.occludes.bottom &&
  a.occludes.left === b.occludes.left;

/**
 * Reports the panel's layout whenever its size changes (ResizeObserver on the panel and its
 * container), and when its mode or state changes. Unchanged layouts aren't
 * reported again.
 */
export function useLayoutReporter(
  ref: RefObject<HTMLElement>,
  mode: PanelMode,
  state: PanelState,
  onLayoutChange: ((layout: PanelLayout) => void) | undefined,
) {
  const callback = useRef(onLayoutChange);
  callback.current = onLayoutChange;
  const last = useRef<PanelLayout | null>(null);

  useEffect(() => {
    const panel = ref.current;
    if (!panel || !callback.current) return;
    const container = (panel.offsetParent as HTMLElement | null) ?? panel.parentElement;
    const report = () => {
      if (!callback.current) return;
      const layout: PanelLayout = {
        mode,
        state,
        occludes: measureOccludes(mode, panelBox(panel), {
          width: container?.clientWidth ?? 0,
          height: container?.clientHeight ?? 0,
        }),
      };
      if (sameLayout(last.current, layout)) return;
      last.current = layout;
      callback.current(layout);
    };
    report();
    if (typeof ResizeObserver === "undefined") return;
    // A frame later as well, once fonts and icons have settled.
    const frame = requestAnimationFrame(report);
    const observer = new ResizeObserver(report);
    observer.observe(panel);
    if (container) observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [mode, state, !!onLayoutChange]);
}

/** The CSS property the expanded sheet's scroller pads its top by (`useSummaryHeight`). */
export const SUMMARY_HEIGHT_VAR = "--panel-summary-height";

/**
 * While `active` (the expanded sheet, whose summary is sticky), keeps `--panel-summary-height`
 * on the panel at the summary's height, so the sheet's scroller can pad its top by it
 * (scroll-padding-top) and an element focused beneath the summary scrolls clear of it.
 */
export function useSummaryHeight(
  panelRef: RefObject<HTMLElement>,
  summaryRef: RefObject<HTMLElement>,
  active: boolean,
) {
  useEffect(() => {
    const panel = panelRef.current;
    const summary = summaryRef.current;
    if (!active || !panel || !summary) return;
    const measure = () => {
      panel.style.setProperty(SUMMARY_HEIGHT_VAR, `${summary.offsetHeight}px`);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(summary);
    return () => {
      observer?.disconnect();
      panel.style.removeProperty(SUMMARY_HEIGHT_VAR);
    };
  }, [active]);
}
