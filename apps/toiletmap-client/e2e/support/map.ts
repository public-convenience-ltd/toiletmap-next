import { expect, type Locator, type Page } from "@playwright/test";

/** Waits until the Leaflet map on the home / details page has rendered. */
export async function waitForMap(page: Page): Promise<void> {
  await expect(page.locator("#map.leaflet-container")).toBeVisible();
}

/** The toilet name heading in the details panel. */
export const detailsPanelHeading = (page: Page) => page.locator(".toilet-panel h2");

/**
 * Returns the first map marker whose centre is not covered by other UI (the
 * floating search bar, buttons, …), so clicking it really hits the marker.
 */
export async function firstUnobscuredMarker(page: Page) {
  const markers = page.locator("#map .loo-marker");
  await expect(markers.first()).toBeVisible();
  const index = await markers.evaluateAll((elements) =>
    elements.findIndex((el) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 3;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
      return document.elementFromPoint(x, y)?.closest(".loo-marker") === el;
    }),
  );
  if (index < 0) throw new Error("no unobscured marker in view");
  return markers.nth(index);
}

/**
 * Waits until a Leaflet map has stopped moving and the UI has caught up: no
 * drag / zoom animation in progress, the map pane's transform unchanged across
 * two consecutive animation-frame pairs, and two further frames for any
 * resulting (Preact) re-render. Use before asserting that something did *not*
 * change, so the assertion cannot pass before the UI has reacted.
 */
export async function waitForMapToSettle(map: Locator): Promise<void> {
  await map.evaluate(async (container) => {
    const frames = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    const pane = container.querySelector<HTMLElement>(".leaflet-map-pane");
    const moving = () =>
      container.classList.contains("leaflet-dragging") ||
      container.classList.contains("leaflet-zoom-anim") ||
      container.querySelector(".leaflet-pan-anim") !== null;
    const deadline = performance.now() + 5_000;
    let last = pane?.style.transform;
    for (;;) {
      await frames();
      const current = pane?.style.transform;
      if (!moving() && current === last) break;
      if (performance.now() > deadline) throw new Error("the map did not stop moving within 5s");
      last = current;
    }
    await frames();
  });
}
