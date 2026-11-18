import { describe, expect, it } from "vitest";
import {
  cardTopBelow,
  centreOffset,
  controlsInsets,
  insetsForRect,
  layoutChanged,
  maxInsets,
  NO_INSETS,
  type PanelLayout,
  panPadding,
  prefersReducedMotion,
  sanitiseInsets,
  toastLayout,
} from "./viewport";

/** A rect from left/top/width/height, the way the DOM would report it. */
const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

// A Pixel 7-ish map container below a 56px header.
const PHONE = rect(0, 56, 412, 800);
// A 1280×720 desktop map container below a 64px header.
const DESKTOP = rect(0, 64, 1280, 656);

describe("insetsForRect", () => {
  it("attributes a search bar across the top to the top edge", () => {
    expect(insetsForRect(rect(12, 68, 388, 56), PHONE)).toEqual({
      ...NO_INSETS,
      top: 68,
    });
  });

  it("attributes a button column in the bottom-right corner to the right edge", () => {
    // 44px wide, 100px tall, 12px from the right and 32px from the bottom.
    const buttons = rect(1280 - 12 - 44, 64 + 656 - 32 - 100, 44, 100);
    expect(insetsForRect(buttons, DESKTOP)).toEqual({ ...NO_INSETS, right: 56 });
  });

  it("attributes a wide button along the bottom to the bottom edge", () => {
    const add = rect(412 - 12 - 170, 56 + 800 - 32 - 40, 170, 40);
    expect(insetsForRect(add, PHONE)).toEqual({ ...NO_INSETS, bottom: 72 });
  });

  it("attributes a bottom sheet to the bottom and a left card to the left", () => {
    expect(insetsForRect(rect(0, 56 + 500, 412, 300), PHONE)).toEqual({
      ...NO_INSETS,
      bottom: 300,
    });
    expect(insetsForRect(rect(12, 64 + 80, 400, 560), DESKTOP)).toEqual({
      ...NO_INSETS,
      left: 412,
    });
  });

  it("ignores elements outside the container, with no size, or covering all of it", () => {
    expect(insetsForRect(rect(0, 0, 412, 40), PHONE)).toEqual(NO_INSETS);
    expect(insetsForRect(rect(100, 100, 0, 0), PHONE)).toEqual(NO_INSETS);
    expect(insetsForRect(PHONE, PHONE)).toEqual(NO_INSETS);
  });

  it("only counts the part inside the container", () => {
    // A bar starting above the container (under the header) only covers what overlaps.
    expect(insetsForRect(rect(0, 40, 412, 40), PHONE)).toEqual({ ...NO_INSETS, top: 24 });
  });
});

describe("controlsInsets", () => {
  it("combines the controls, keeping the largest inset per side", () => {
    const search = rect(12, 68, 340, 56);
    // A two-button column beside the bar: narrower than it is tall, so it covers the right.
    const gear = rect(360, 68, 44, 92);
    const add = rect(230, 56 + 800 - 72, 170, 40);
    expect(controlsInsets([search, gear, add], PHONE)).toEqual({
      top: 68,
      right: 52,
      bottom: 72,
      left: 0,
    });
  });

  it("is empty with no controls", () => {
    expect(controlsInsets([], PHONE)).toEqual(NO_INSETS);
  });
});

describe("sanitiseInsets and maxInsets", () => {
  it("turns missing, negative and non-finite sides into 0 and rounds", () => {
    expect(sanitiseInsets({ top: -5, right: Number.NaN, bottom: 12.6 })).toEqual({
      top: 0,
      right: 0,
      bottom: 13,
      left: 0,
    });
    expect(sanitiseInsets(null)).toEqual(NO_INSETS);
  });

  it("takes the larger side", () => {
    expect(
      maxInsets({ top: 1, right: 5, bottom: 0, left: 9 }, { top: 4, right: 2, bottom: 3, left: 0 }),
    ).toEqual({ top: 4, right: 5, bottom: 3, left: 9 });
  });
});

describe("panPadding", () => {
  const size = { width: 412, height: 800 };

  it("adds the margin, and room for the marker icon above and beside its tip", () => {
    const padding = panPadding(size, { ...NO_INSETS, bottom: 300 }, { ...NO_INSETS, top: 68 });
    // top: 68 controls + 16 margin + 44 icon; sides: 16 margin + 14 (half the icon).
    expect(padding).toEqual({ paddingTopLeft: [30, 128], paddingBottomRight: [30, 316] });
  });

  it("uses whichever of the panel and the controls covers more of each side", () => {
    const padding = panPadding(
      { width: 1280, height: 656 },
      { ...NO_INSETS, left: 412 },
      { top: 80, right: 56, bottom: 72, left: 0 },
      { margin: 10, markerSize: [20, 30] },
    );
    expect(padding).toEqual({ paddingTopLeft: [432, 120], paddingBottomRight: [76, 82] });
  });

  it("never leaves the marker less than no room on a short screen", () => {
    // A landscape phone: the expanded sheet and the bar leave almost nothing.
    const padding = panPadding(
      { width: 800, height: 300 },
      { ...NO_INSETS, bottom: 250 },
      { ...NO_INSETS, top: 70 },
    );
    const [, top] = padding.paddingTopLeft;
    const [, bottom] = padding.paddingBottomRight;
    expect(top + bottom).toBeLessThan(300);
    expect(top).toBeGreaterThan(0);
    expect(bottom).toBeGreaterThan(top);
  });

  it("ignores junk occludes", () => {
    const padding = panPadding(
      size,
      { top: Number.NaN, right: -10, bottom: 0, left: 0 },
      NO_INSETS,
    );
    expect(padding).toEqual({ paddingTopLeft: [30, 60], paddingBottomRight: [30, 16] });
  });
});

describe("centreOffset", () => {
  it("moves the point from the container centre to the centre of the free area", () => {
    const size = { width: 412, height: 800 };
    const padding = panPadding(size, { ...NO_INSETS, bottom: 300 }, { ...NO_INSETS, top: 68 });
    // Free area: y 128…484, centre 306; the container centre is 400.
    expect(centreOffset(size, padding)).toEqual([0, 94]);
  });

  it("shifts sideways for a left card", () => {
    const size = { width: 1280, height: 656 };
    const padding = {
      paddingTopLeft: [442, 100] as [number, number],
      paddingBottomRight: [30, 100] as [number, number],
    };
    // Free area: x 442…1250, centre 846; the container centre is 640.
    expect(centreOffset(size, padding)).toEqual([-206, 0]);
  });

  it("is zero with even padding", () => {
    const padding = {
      paddingTopLeft: [20, 20] as [number, number],
      paddingBottomRight: [20, 20] as [number, number],
    };
    expect(centreOffset({ width: 400, height: 400 }, padding)).toEqual([0, 0]);
  });
});

describe("layoutChanged", () => {
  const peek: PanelLayout = {
    mode: "sheet",
    state: "peek",
    occludes: { top: 0, right: 0, bottom: 200, left: 0 },
  };

  it("reports a new state, mode or a real size change", () => {
    expect(layoutChanged(null, peek)).toBe(true);
    expect(layoutChanged(peek, { ...peek, state: "expanded" })).toBe(true);
    expect(layoutChanged(peek, { ...peek, mode: "card" })).toBe(true);
    expect(layoutChanged(peek, { ...peek, occludes: { ...peek.occludes, bottom: 480 } })).toBe(
      true,
    );
  });

  it("ignores sub-2px jitter and identical layouts", () => {
    expect(layoutChanged(peek, { ...peek })).toBe(false);
    expect(layoutChanged(peek, { ...peek, occludes: { ...peek.occludes, bottom: 201.2 } })).toBe(
      false,
    );
    expect(layoutChanged(null, null)).toBe(false);
  });
});

describe("prefersReducedMotion", () => {
  const withMatch = (matches: boolean) => ({
    matchMedia: (query: string) =>
      ({ matches: matches && query === "(prefers-reduced-motion: reduce)" }) as MediaQueryList,
  });

  it("follows the media query", () => {
    expect(prefersReducedMotion(withMatch(true))).toBe(true);
    expect(prefersReducedMotion(withMatch(false))).toBe(false);
  });

  it("is false without matchMedia, or when it throws", () => {
    expect(prefersReducedMotion(undefined)).toBe(false);
    expect(prefersReducedMotion({} as Pick<Window, "matchMedia">)).toBe(false);
    expect(
      prefersReducedMotion({
        matchMedia: () => {
          throw new Error("nope");
        },
      }),
    ).toBe(false);
  });
});

describe("cardTopBelow", () => {
  it("starts the card just below the bar, in container coordinates", () => {
    expect(cardTopBelow(rect(440, 76, 520, 56), DESKTOP)).toBe(76 + 56 - 64 + 8);
    expect(cardTopBelow(rect(440, 76, 520, 200), DESKTOP, 12)).toBe(76 + 200 - 64 + 12);
  });

  it("is undefined before the bar is laid out", () => {
    expect(cardTopBelow(rect(0, 0, 0, 0), DESKTOP)).toBeUndefined();
  });
});

describe("toastLayout", () => {
  // A 390×844 phone: header 60px, the map runs to the bottom of the screen.
  const phoneMap = rect(0, 60, 390, 784);
  // A 1280×720 desktop: header 72px, footer 48px.
  const desktopMap = rect(0, 72, 1280, 600);
  // A Pixel 7 on its side (863×360): compact header 56px, no footer.
  const landscapeMap = rect(0, 56, 863, 304);

  it("puts phone toasts at the top of the map (over the search bar) while the sheet is open", () => {
    for (const occludes of [
      { top: 0, right: 0, bottom: 500, left: 0 },
      { top: 0, right: 0, bottom: 120, left: 0 },
    ]) {
      expect(
        toastLayout({ mode: "sheet", container: phoneMap, occludes, searchBottom: 136 }),
      ).toEqual({ offset: 60, left: null, right: null });
    }
  });

  it("keeps phone toasts below the search bar when no sheet is open", () => {
    expect(
      toastLayout({ mode: "sheet", container: phoneMap, occludes: null, searchBottom: 136 }),
    ).toEqual({ offset: 136, left: null, right: null });
  });

  it("puts desktop toasts below the search bar, right of an open card", () => {
    const base = { mode: "card" as const, container: desktopMap, searchBottom: 140 };
    expect(toastLayout({ ...base, occludes: null })).toEqual({
      offset: 140,
      left: null,
      right: null,
    });
    expect(toastLayout({ ...base, occludes: { top: 80, right: 0, bottom: 0, left: 416 } })).toEqual(
      { offset: 140, left: 416, right: null },
    );
  });

  it("keeps card-layout toasts left of the right-hand buttons (zoom, developer tools)", () => {
    // Zoom buttons 44px wide, 12px in from the right edge.
    expect(
      toastLayout({
        mode: "card",
        container: landscapeMap,
        occludes: { top: 60, right: 0, bottom: 0, left: 357 },
        searchBottom: 116,
        rightControlsLeft: 863 - 12 - 44,
        viewportWidth: 863,
      }),
    ).toEqual({ offset: 116, left: 357, right: 56 });
    // No buttons showing (or not measured yet): the region's own right edge.
    expect(
      toastLayout({
        mode: "card",
        container: landscapeMap,
        occludes: null,
        searchBottom: 116,
        rightControlsLeft: null,
        viewportWidth: 863,
      }).right,
    ).toBeNull();
  });

  it("never moves phone toasts in from the right (the bottom-right buttons are far below)", () => {
    expect(
      toastLayout({
        mode: "sheet",
        container: phoneMap,
        occludes: null,
        searchBottom: 136,
        rightControlsLeft: 300,
        viewportWidth: 390,
      }).right,
    ).toBeNull();
  });

  it("falls back to the top of the map without a search bar", () => {
    expect(
      toastLayout({ mode: "sheet", container: phoneMap, occludes: null, searchBottom: null }),
    ).toEqual({ offset: 60, left: null, right: null });
  });
});
