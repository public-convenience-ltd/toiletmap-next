import { expect, type Locator, type Page } from "@playwright/test";

/** Waits until the Leaflet map on the home / details page has rendered. */
export async function waitForMap(page: Page): Promise<void> {
  await expect(page.locator("#map.leaflet-container")).toBeVisible();
}

/**
 * A random spot for a deep-linked fixture, in its own region away from the default home view
 * (so the home tests only ever see seed rows) and from the random fixture band in
 * support/api.ts. Random rather than fixed so that tests running at the same time (other
 * projects, --repeat-each) never land close enough to cluster.
 */
export const deepLinkSpot = () => ({
  lat: Number((53.0 + Math.random() * 0.6).toFixed(6)),
  lng: Number((-2.5 + Math.random() * 1.5).toFixed(6)),
});

/** The toilet name heading in the details panel. */
export const detailsPanelHeading = (page: Page) => page.locator(".toilet-panel h2");

/** The details panel: a bottom sheet below 768px, a floating card from 768px and on a landscape phone. */
export const detailsPanel = (page: Page) => page.locator(".toilet-panel");

/** The summary's "Details" toggle (the sheet's drag handle is a separate button). */
export const detailsToggle = (page: Page) =>
  detailsPanel(page).getByRole("button", { name: "Details", exact: true });

/**
 * Makes sure the details panel is expanded, so the opening hours, facilities and the
 * verify / edit / report actions are on screen. The panel opens expanded (a marker tap, a
 * deep link, Back/Forward), so this only clicks "Details" if it has been collapsed:
 * clicking it on an expanded panel would collapse it.
 */
export async function expandDetails(page: Page): Promise<void> {
  const toggle = detailsToggle(page);
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/** Collapses the details panel to its summary with the "Details" toggle (if expanded). */
export async function collapseDetails(page: Page): Promise<void> {
  const toggle = detailsToggle(page);
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) !== "false") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
}

/** Asserts the panel is open expanded, as every open (tap, deep link, Back/Forward) is. */
export async function expectDetailsExpanded(page: Page): Promise<void> {
  await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "true");
}

/**
 * Closes the details panel with Escape from inside it (its heading, where focus goes on
 * open). The panel opens expanded, so the first Escape collapses it to the summary and the
 * second closes it.
 */
export async function closeDetailsWithEscape(page: Page): Promise<void> {
  await expectDetailsExpanded(page);
  await detailsPanelHeading(page).focus();
  await page.keyboard.press("Escape");
  await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(detailsPanel(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(detailsPanel(page)).toHaveCount(0);
}

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

/** The record mapCache keeps under "loos-cache-v2" (src/api/mapCache.ts). */
export interface MapCacheRecord {
  schemaVersion: number;
  cursor: string | null;
  data: [string, string, number][];
  rev: number;
  syncedAt: number | null;
}

/**
 * Reads the client's map cache straight from IndexedDB (idb-keyval's default
 * "keyval-store" / "keyval" store). Creates the store the way idb-keyval does
 * if the database does not exist yet, so probing early cannot break the app.
 */
export function readMapCache(page: Page): Promise<MapCacheRecord | null> {
  return page.evaluate(
    () =>
      new Promise<MapCacheRecord | null>((resolve, reject) => {
        const open = indexedDB.open("keyval-store");
        open.onupgradeneeded = () => open.result.createObjectStore("keyval");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db
            .transaction("keyval", "readonly")
            .objectStore("keyval")
            .get("loos-cache-v2");
          request.onsuccess = () => {
            db.close();
            resolve((request.result as MapCacheRecord | undefined) ?? null);
          };
          request.onerror = () => {
            db.close();
            reject(request.error);
          };
        };
      }),
  );
}

/** Waits until the map has stored a snapshot with a server cursor (a warm cache). */
export async function waitForWarmMapCache(page: Page): Promise<MapCacheRecord> {
  let record: MapCacheRecord | null = null;
  await expect
    .poll(
      async () => {
        record = await readMapCache(page);
        return !!record?.cursor && record.data.length > 0;
      },
      { message: "the map should store the dump and its cursor in IndexedDB" },
    )
    .toBe(true);
  return record as unknown as MapCacheRecord;
}

/**
 * Asks the map to sync now, the way returning to the tab does
 * (useMapData listens for `visibilitychange` while visible), instead of
 * waiting for the 60s poll.
 */
export async function triggerMapSync(page: Page): Promise<void> {
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}

/** Triggers syncs until `check` passes (a sync already in flight swallows a trigger). */
export async function syncUntil(page: Page, check: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await triggerMapSync(page);
    await check();
  }).toPass({ timeout: 20_000, intervals: [250, 500, 1_000] });
}

/** True once the map cache stored in this browser holds a row for `id`. */
export async function mapCacheHas(page: Page, id: string): Promise<boolean> {
  return (await readMapCache(page))?.data.some(([rowId]) => rowId === id) ?? false;
}

/** The highlighted (selected) marker: the taller icon. */
export const selectedMarker = (page: Page) => page.locator("#map .loo-marker svg[height='44']");

/**
 * Clicks the plain marker drawn where `box` (a marker's bounding box) was.
 * Both icons are anchored bottom-centre, so after closing the panel the plain
 * marker sits where the highlighted one did. The click is dispatched on the
 * marker element itself: these tests are about data, not hit-testing (panel.spec.ts
 * and map.spec.ts check that the selected marker is left uncovered).
 */
export async function clickMarkerAt(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
): Promise<void> {
  const markers = page.locator("#map .loo-marker");
  const findIndex = () =>
    markers.evaluateAll(
      (elements, b) =>
        elements.findIndex((el) => {
          const r = el.getBoundingClientRect();
          return (
            Math.abs(r.left + r.width / 2 - (b.x + b.width / 2)) < 2 &&
            Math.abs(r.bottom - (b.y + b.height)) < 2
          );
        }),
      box,
    );
  let index = -1;
  await expect
    .poll(
      async () => {
        index = await findIndex();
        return index;
      },
      { message: "a marker should be drawn at the toilet's position" },
    )
    .toBeGreaterThanOrEqual(0);
  await markers.nth(index).dispatchEvent("click");
}

/**
 * Indices of the drawn markers other than the selected (highlighted) one. The
 * details panel can cover most of the map, so callers dispatch the click on
 * the marker element rather than relying on hit-testing.
 */
export function otherMarkerIndices(page: Page): Promise<number[]> {
  return page
    .locator("#map .loo-marker")
    .evaluateAll((elements) =>
      elements.flatMap((el, i) => (el.querySelector("svg[height='44']") ? [] : [i])),
    );
}
