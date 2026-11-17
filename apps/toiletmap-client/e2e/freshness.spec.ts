import type { Page, Request } from "@playwright/test";
import { e2eName, getLoo, updateLooViaApi } from "./support/api";
import { authedTest, expect, test } from "./support/fixtures";
import { openEditForm, SAVED_BANNER_TEXT, waitForSaved } from "./support/form";
import {
  clickMarkerAt,
  detailsPanelHeading,
  firstUnobscuredMarker,
  otherMarkerIndices,
  readMapCache,
  selectedMarker,
  triggerMapSync,
  waitForMap,
  waitForWarmMapCache,
} from "./support/map";

/**
 * Phase 2 freshness: an edit is visible straight away to the person who made
 * it, reaches other tabs with a warm IndexedDB cache on their next sync
 * (`/api/loos/updates?since=<server cursor>`), the cached map keeps working
 * when the network does not, and Back/Forward follow the details panel.
 *
 * Syncs are triggered with a `visibilitychange` event (what returning to the
 * tab does) rather than by waiting for the 60s poll.
 */

/** ToiletDetailsPanel REMOVED_MESSAGE. */
const REMOVED_TEXT = "This toilet has been removed from the map.";
const ID_URL = /\/loos\/[0-9a-f]{24}$/;
const HOME_URL = /^[^?#]*:\/\/[^/]+\/$/;

const pathOf = (request: Request) => new URL(request.url()).pathname;
const idOf = (page: Page) => new URL(page.url()).pathname.split("/").pop() ?? "";
const freshnessNotice = (page: Page) => page.locator(".map-freshness-notice");
const markersOrClusters = (page: Page) => page.locator("#map .loo-marker, #map .marker-cluster");

/** Tags the current document, so a later check can tell whether a page load happened. */
const tagDocument = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __e2eDocument?: boolean }).__e2eDocument = true;
  });
const sameDocument = (page: Page) =>
  page.evaluate(() => (window as unknown as { __e2eDocument?: boolean }).__e2eDocument === true);

/** Records the map-data requests a page makes from now on. */
function recordMapRequests(page: Page) {
  const dumps: Request[] = [];
  const updates: Request[] = [];
  page.on("request", (request) => {
    if (pathOf(request) === "/api/loos/dump") dumps.push(request);
    if (pathOf(request) === "/api/loos/updates") updates.push(request);
  });
  return { dumps, updates };
}

/** Triggers syncs until `check` passes (a sync already in flight swallows a trigger). */
async function syncUntil(page: Page, check: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await triggerMapSync(page);
    await check();
  }).toPass({ timeout: 20_000, intervals: [250, 500, 1_000] });
}

authedTest.describe("freshness after a signed-in edit", () => {
  authedTest(
    "the save lands on /loos/:id?saved=1 with the banner and the new name, then drops the param",
    async ({ page, loos }) => {
      const loo = await loos.create({}, "fresh saved banner");
      const form = await openEditForm(page, loo.id);
      const newName = e2eName("fresh saved renamed");
      await form.name.fill(newName);

      const landing = page.waitForRequest(
        (request) =>
          request.resourceType() === "document" &&
          request.url().endsWith(`/loos/${loo.id}?saved=1`),
      );
      await form.save.click();
      await landing;
      await waitForSaved(page, loo.id);
      // The panel shows the saved version, not a cached copy of the old one.
      await expect(detailsPanelHeading(page)).toHaveText(newName);

      await page.getByRole("button", { name: "Dismiss message" }).click();
      await expect(page.getByText(SAVED_BANNER_TEXT)).toHaveCount(0);

      // The param is gone, so a reload doesn't repeat the banner.
      await page.reload();
      await expect(detailsPanelHeading(page)).toHaveText(newName);
      await expect(page.getByText(SAVED_BANNER_TEXT)).toHaveCount(0);
    },
  );

  authedTest(
    "the same session's map shows the edit without a reload, and the cache is patched, not wiped",
    async ({ page, loos }) => {
      const loo = await loos.create({ accessible: false }, "fresh same session");

      // Warm the map cache with this toilet in it.
      await page.goto(`/loos/${loo.id}`);
      await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
      const warm = await waitForWarmMapCache(page);
      expect(warm.data.some(([id]) => id === loo.id)).toBe(true);

      const form = await openEditForm(page, loo.id);
      const newName = e2eName("fresh same session renamed");
      await form.name.fill(newName);
      await form.facility("Accessible", "Yes").click();
      const requests = recordMapRequests(page);
      await form.save.click();
      await waitForSaved(page, loo.id);
      await expect(detailsPanelHeading(page)).toHaveText(newName);

      // The save patched the cached row (K4 `compressed`) instead of deleting the cache:
      // the reloaded map syncs with a delta and never needs the full dump.
      await expect
        .poll(async () => (await readMapCache(page))?.data.find(([id]) => id === loo.id)?.[2])
        .toEqual(expect.any(Number));
      const row = (await readMapCache(page))?.data.find(([id]) => id === loo.id);
      expect((row?.[2] ?? 0) & 0b1000, "the ACCESSIBLE filter bit").toBe(0b1000);
      await expect.poll(() => requests.updates.length).toBeGreaterThan(0);
      expect(requests.dumps).toHaveLength(0);

      // Close the panel and open the toilet again from its marker: same document, new name.
      const box = await selectedMarker(page).boundingBox();
      if (!box) throw new Error("the selected marker has no bounding box");
      await page.keyboard.press("Escape");
      await expect(page.locator(".toilet-panel")).toHaveCount(0);
      await expect(page).toHaveURL(HOME_URL);
      await tagDocument(page);
      await clickMarkerAt(page, box);
      await expect(detailsPanelHeading(page)).toHaveText(newName);
      await expect(page).toHaveURL(new RegExp(`/loos/${loo.id}$`));
      expect(await sameDocument(page), "no page load in between").toBe(true);
    },
  );

  authedTest(
    "another browser with a warm cache sees the edit after a sync, via /updates and the server cursor",
    async ({ page, secondEditor: other, loos }) => {
      const loo = await loos.create({}, "fresh other tab");

      const coldLoad = recordMapRequests(other);
      await other.goto(`/loos/${loo.id}`);
      await expect(detailsPanelHeading(other)).toHaveText(loo.name ?? "");
      await waitForWarmMapCache(other);
      // A cold load catches up with /updates straight after the dump; wait until that
      // catch-up's cursor is the stored one, so it can't race the sync checked below.
      await expect.poll(() => coldLoad.updates.length).toBeGreaterThan(0);
      const catchUp = await coldLoad.updates[0]?.response();
      const catchUpCursor = ((await catchUp?.json()) as { cursor?: string } | undefined)?.cursor;
      expect(catchUpCursor).toEqual(expect.any(String));
      await expect.poll(async () => (await readMapCache(other))?.cursor).toBe(catchUpCursor);
      const warm = await waitForWarmMapCache(other);
      // The stored cursor is the server's (database time minus a 120s overlap), not the
      // browser's clock. The database runs locally, so both clocks agree closely.
      const cursorAge = Date.now() - Date.parse(warm.cursor ?? "");
      expect(cursorAge).toBeGreaterThan(90_000);
      expect(cursorAge).toBeLessThan(10 * 60_000);
      const otherRequests = recordMapRequests(other);

      const form = await openEditForm(page, loo.id);
      const newName = e2eName("fresh other tab renamed");
      await form.name.fill(newName);
      await form.save.click();
      await waitForSaved(page, loo.id);

      // A name edit doesn't change the compressed row; the delta naming the open
      // toilet is what refreshes the panel.
      await syncUntil(other, async () => {
        await expect(detailsPanelHeading(other)).toHaveText(newName, { timeout: 2_000 });
      });
      const firstSince = new URL(otherRequests.updates[0]?.url() ?? "http://x/").searchParams.get(
        "since",
      );
      expect(firstSince).toBe(warm.cursor);
      expect(otherRequests.dumps).toHaveLength(0);
      const synced = await readMapCache(other);
      expect(Date.parse(synced?.cursor ?? "")).toBeGreaterThan(Date.parse(warm.cursor ?? ""));
    },
  );
});

test.describe("freshness of the cached map", () => {
  test("a toilet deactivated elsewhere leaves this browser's map, and its open panel says so", async ({
    page,
    apiToken,
    loos,
  }) => {
    const loo = await loos.create({}, "fresh deactivated");

    await page.goto(`/loos/${loo.id}`);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
    await expect(selectedMarker(page)).toHaveCount(1);
    await waitForWarmMapCache(page);

    await updateLooViaApi(apiToken, loo.id, { active: false });
    expect((await getLoo(loo.id)).active).toBe(false);

    await syncUntil(page, async () => {
      await expect(page.getByText(REMOVED_TEXT)).toBeVisible({ timeout: 2_000 });
    });
    await expect(selectedMarker(page)).toHaveCount(0);
    // The panel stays open on the toilet, without directions or edit actions.
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
    await expect(page.locator(`.toilet-panel a[href="/loos/${loo.id}/edit"]`)).toHaveCount(0);
    const cached = await readMapCache(page);
    expect(cached?.data.some(([id]) => id === loo.id)).toBe(false);
  });

  test("with a warm cache the map still renders when syncing fails, and says so", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForMap(page);
    await expect(markersOrClusters(page).first()).toBeVisible();
    await waitForWarmMapCache(page);

    // Network failure: the cached markers render and the map says it is offline.
    await page.route(/\/api\/loos\/(updates|dump)(\?|$)/, (route) =>
      route.abort("internetdisconnected"),
    );
    await page.reload();
    await waitForMap(page);
    await expect(markersOrClusters(page).first()).toBeVisible();
    await expect(freshnessNotice(page)).toHaveText("Offline — showing saved data");

    // Server error: "couldn't refresh", with the time of the last good sync.
    await page.unrouteAll();
    await page.route(/\/api\/loos\/updates(\?|$)/, (route) =>
      route.fulfill({ status: 503, json: { message: "unavailable" } }),
    );
    await triggerMapSync(page);
    await expect(freshnessNotice(page)).toHaveText(
      /^Couldn't refresh — showing data from \d\d:\d\d$/,
    );
    await expect(markersOrClusters(page).first()).toBeVisible();

    // Recovers on the next sync once the server answers.
    await page.unrouteAll();
    await syncUntil(page, async () => {
      await expect(freshnessNotice(page)).toHaveText("", { timeout: 2_000 });
    });
  });

  test("Back and Forward follow the panel after opening two toilets from the map", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "needs two unclustered seed markers in the default view, which phone viewports may not have",
    );
    await page.goto("/");
    await waitForMap(page);
    const historyLength = () => page.evaluate(() => history.length);
    const startLength = await historyLength();
    await tagDocument(page);

    // Relies on the (read-only) seed rows in central London, the default view.
    await (await firstUnobscuredMarker(page)).click();
    await expect(page).toHaveURL(ID_URL);
    const firstId = idOf(page);
    await expect(detailsPanelHeading(page)).toHaveText((await getLoo(firstId)).name ?? "Toilet");
    expect(await historyLength()).toBe(startLength + 1);

    // Switching to another toilet replaces the entry instead of adding one.
    await expect.poll(async () => (await otherMarkerIndices(page)).length).toBeGreaterThan(0);
    const [second] = await otherMarkerIndices(page);
    // The open panel covers most of the map: click the marker element directly.
    await page
      .locator("#map .loo-marker")
      .nth(second ?? 0)
      .dispatchEvent("click");
    await expect(page).not.toHaveURL(new RegExp(`/loos/${firstId}$`));
    await expect(page).toHaveURL(ID_URL);
    const secondId = idOf(page);
    const secondName = (await getLoo(secondId)).name ?? "Toilet";
    await expect(detailsPanelHeading(page)).toHaveText(secondName);
    expect(await historyLength()).toBe(startLength + 1);

    // Back: the panel closes and the address bar shows the map.
    await page.goBack();
    await expect(page).toHaveURL(HOME_URL);
    await expect(page.locator(".toilet-panel")).toHaveCount(0);

    // Forward: the second toilet again.
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/loos/${secondId}$`));
    await expect(detailsPanelHeading(page)).toHaveText(secondName);

    // Closing steps back over the map's own entry, so Back won't reopen it.
    await page.keyboard.press("Escape");
    await expect(page.locator(".toilet-panel")).toHaveCount(0);
    await expect(page).toHaveURL(HOME_URL);
    expect(await historyLength()).toBe(startLength + 1);
    expect(await sameDocument(page), "Back/Forward stayed within the page").toBe(true);
  });
});
