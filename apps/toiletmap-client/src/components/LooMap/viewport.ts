/**
 * Pure helpers for keeping the selected marker in the part of the map the user can see:
 * the map container minus the details panel and the floating controls (search bar,
 * buttons). Kept free of Leaflet and the DOM so they can be unit tested directly.
 */

/** How far in from each edge of the map container something covers it, in px. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * What the details panel reports through `onLayoutChange` (shared contract P1): whether it is
 * a bottom sheet or a floating card, peeking or expanded, and how much of the map container
 * it covers.
 */
export interface PanelLayout {
  mode: "sheet" | "card";
  state: "peek" | "expanded";
  occludes: Insets;
}

/** The parts of a DOMRect these helpers read. */
export interface RectLike {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Padding for Leaflet's `panInside`: [x, y] pairs, as Leaflet expects. */
export interface PanPadding {
  paddingTopLeft: [number, number];
  paddingBottomRight: [number, number];
}

export const NO_INSETS: Insets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/** Clear space kept between the marker and anything covering the map. */
export const REVEAL_MARGIN = 16;

/**
 * The selected marker's icon (see looIcon.ts LOO_ICON_SIZE.highlighted): 28×44, anchored at
 * its tip (bottom centre). `panInside` keeps the anchor point inside the padding, so the icon
 * itself needs room above the point and half its width either side.
 */
export const SELECTED_MARKER_SIZE: readonly [number, number] = [28, 44];

const clampPx = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/** The larger of two insets on each side. */
export function maxInsets(a: Insets, b: Insets): Insets {
  return {
    top: Math.max(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
    left: Math.max(a.left, b.left),
  };
}

/**
 * How much of the container a floating element covers, attributed to the one edge where
 * that costs the least free space. A search bar across the top covers the top; a column of
 * buttons in the bottom-right corner covers the right; a wide button along the bottom covers
 * the bottom. Elements outside the container, or with no size, cover nothing.
 */
export function insetsForRect(rect: RectLike, container: RectLike): Insets {
  const left = Math.max(rect.left, container.left);
  const right = Math.min(rect.right, container.right);
  const top = Math.max(rect.top, container.top);
  const bottom = Math.min(rect.bottom, container.bottom);
  if (right <= left || bottom <= top) return { ...NO_INSETS };
  // Something covering (nearly) the whole map isn't floating over it: an overlay wrapper, or
  // a measurement taken mid-layout. Treating it as covering an edge would push the marker off.
  const width = container.right - container.left;
  const height = container.bottom - container.top;
  if (right - left >= width * 0.9 && bottom - top >= height * 0.9) return { ...NO_INSETS };

  const fromTop = bottom - container.top;
  const fromBottom = container.bottom - top;
  const fromLeft = right - container.left;
  const fromRight = container.right - left;
  const smallest = Math.min(fromTop, fromBottom, fromLeft, fromRight);
  const insets = { ...NO_INSETS };
  // Ties prefer top/bottom: the panel and the bars are horizontal.
  if (smallest === fromTop) insets.top = clampPx(fromTop);
  else if (smallest === fromBottom) insets.bottom = clampPx(fromBottom);
  else if (smallest === fromLeft) insets.left = clampPx(fromLeft);
  else insets.right = clampPx(fromRight);
  return insets;
}

/** Everything the floating controls cover, combined (the largest inset on each side). */
export function controlsInsets(rects: readonly RectLike[], container: RectLike): Insets {
  return rects.reduce<Insets>((acc, rect) => maxInsets(acc, insetsForRect(rect, container)), {
    ...NO_INSETS,
  });
}

/** A panel layout's occludes, sanitised (negative, NaN or missing sides become 0). */
export function sanitiseInsets(insets: Partial<Insets> | null | undefined): Insets {
  return {
    top: clampPx(insets?.top ?? 0),
    right: clampPx(insets?.right ?? 0),
    bottom: clampPx(insets?.bottom ?? 0),
    left: clampPx(insets?.left ?? 0),
  };
}

/**
 * Shrinks a pair of opposite paddings so at least `minFree` px stay between them. Without
 * this, a panel covering most of a short (landscape) phone would leave Leaflet a negative
 * box to fit the marker into. Both sides give up space in proportion to their size.
 */
function fitPair(a: number, b: number, size: number, minFree: number): [number, number] {
  const room = Math.max(0, size - minFree);
  const total = a + b;
  if (total <= room || total === 0) return [a, b];
  const scale = room / total;
  return [Math.floor(a * scale), Math.floor(b * scale)];
}

export interface PanPaddingOptions {
  /** Clear space around the marker; defaults to REVEAL_MARGIN. */
  margin?: number;
  /** The selected marker's icon [width, height], anchored bottom centre. */
  markerSize?: readonly [number, number];
}

/**
 * The `panInside` padding that keeps the selected marker clear of the panel (`occludes`) and
 * the floating controls (`controls`), plus a margin and room for the icon above its anchor.
 * The padding never squeezes the free area below the marker's own size.
 */
export function panPadding(
  container: { width: number; height: number },
  occludes: Insets,
  controls: Insets,
  { margin = REVEAL_MARGIN, markerSize = SELECTED_MARKER_SIZE }: PanPaddingOptions = {},
): PanPadding {
  const covered = maxInsets(sanitiseInsets(occludes), sanitiseInsets(controls));
  const [markerWidth, markerHeight] = markerSize;
  const halfWidth = Math.ceil(markerWidth / 2);
  const wanted = {
    top: covered.top + margin + markerHeight,
    bottom: covered.bottom + margin,
    left: covered.left + margin + halfWidth,
    right: covered.right + margin + halfWidth,
  };
  const [top, bottom] = fitPair(wanted.top, wanted.bottom, container.height, 1);
  const [left, right] = fitPair(wanted.left, wanted.right, container.width, 1);
  return { paddingTopLeft: [left, top], paddingBottomRight: [right, bottom] };
}

/**
 * The pixel offset to `panBy` after centring on a point so that it sits in the middle of the
 * free area left by `padding` rather than the middle of the container (used for a deep link,
 * where the marker should be comfortably in view, not just inside the edge).
 */
export function centreOffset(
  container: { width: number; height: number },
  padding: PanPadding,
): [number, number] {
  const [left, top] = padding.paddingTopLeft;
  const [right, bottom] = padding.paddingBottomRight;
  const freeCentreX = left + (container.width - left - right) / 2;
  const freeCentreY = top + (container.height - top - bottom) / 2;
  // panBy(v) moves the view by v, so the point moves by -v on screen.
  return [
    Math.round(container.width / 2 - freeCentreX),
    Math.round(container.height / 2 - freeCentreY),
  ];
}

/**
 * Whether two layouts cover the map differently enough to re-check the marker (a ResizeObserver
 * reports sub-pixel changes while the sheet animates).
 */
export function layoutChanged(prev: PanelLayout | null, next: PanelLayout | null): boolean {
  if (!prev || !next) return prev !== next;
  if (prev.mode !== next.mode || prev.state !== next.state) return true;
  const a = sanitiseInsets(prev.occludes);
  const b = sanitiseInsets(next.occludes);
  return (["top", "right", "bottom", "left"] as const).some((k) => Math.abs(a[k] - b[k]) >= 2);
}

/**
 * Where the desktop details card should start (px from the top of the map container): just
 * below the floating search bar, as tall as it currently is (filters or suggestions open).
 * Undefined while the bar has no size (not laid out yet), so the card keeps its CSS default.
 */
export function cardTopBelow(chrome: RectLike, container: RectLike, gap = 8): number | undefined {
  if (chrome.bottom <= chrome.top) return undefined;
  return Math.max(0, Math.round(chrome.bottom - container.top + gap));
}

/** Whether the viewer asked for reduced motion (false where matchMedia isn't available). */
export function prefersReducedMotion(
  win: Pick<Window, "matchMedia"> | undefined = globalThis.window,
): boolean {
  try {
    return !!win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Whether the Settings gear and DevTools are shown: local development builds, and deployed
 * `development`/`preview` environments (the worker's ENVIRONMENT var, passed in by the page).
 * Production — and anything unknown — hides them.
 */
export function showDeveloperControls(
  environment: string | null | undefined,
  isDevBuild: boolean,
): boolean {
  if (isDevBuild) return true;
  const env = (environment ?? "").trim().toLowerCase();
  return env === "development" || env === "preview" || env === "local";
}
