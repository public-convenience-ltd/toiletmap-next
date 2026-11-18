import { getLoo } from "./support/api";
import { expect, test } from "./support/fixtures";
import {
  closeDetailsWithEscape,
  deepLinkSpot,
  detailsPanelHeading,
  firstUnobscuredMarker,
  markerAt,
  waitForMap,
  waitForMapToSettle,
} from "./support/map";

/**
 * Ported from legacy cypress/e2e/{desktop,mobile}/index.cy.ts: the map renders
 * markers, a marker opens the details panel, and deep links work.
 */

test.describe("map", () => {
  test("home page renders the map with markers or clusters", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Toilet Map");
    await waitForMap(page);
    await expect(page.locator("#map .loo-marker, #map .marker-cluster").first()).toBeVisible();
  });

  test("/loos/:id deep link opens the details panel; Escape collapses, then closes it; a marker reopens it", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create({ location: deepLinkSpot() }, "map deep link");

    await page.goto(`/loos/${loo.id}`);
    await waitForMap(page);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");

    // The selected toilet's marker is drawn highlighted (taller icon).
    const highlighted = page.locator("#map .loo-marker svg[height='44']");
    await expect(highlighted).toHaveCount(1);
    await waitForMapToSettle(page.locator("#map"));
    const box = await highlighted.boundingBox();
    if (!box) throw new Error("highlighted marker has no bounding box");

    // It opens expanded: Escape collapses it first, then closes it.
    await closeDetailsWithEscape(page);
    await expect(page).toHaveURL(/\/$/);

    // The deep link left the marker clear of the floating controls (see the test below), so
    // a real (hit-tested) click reopens it. Both icons are anchored at the pin's tip, so the
    // plain marker sits where the highlighted one did.
    // Wait for the plain marker to be drawn there and the map to stop moving first, then
    // click it where it is now (a click measured too early could miss it in WebKit).
    await waitForMapToSettle(page.locator("#map"));
    const plain = await markerAt(page, box);
    await expect(async () => {
      const now = await plain.boundingBox();
      if (!now) throw new Error("the plain marker has no bounding box");
      await page.mouse.click(now.x + now.width / 2, now.y + now.height - 12);
      await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "", { timeout: 2_000 });
    }).toPass({ timeout: 10_000 });
    await expect(page).toHaveURL(new RegExp(`/loos/${loo.id}$`));
  });

  test("clicking a marker opens the panel for that toilet", async ({ page }) => {
    await page.goto("/");
    await waitForMap(page);
    // Relies on the (read-only) seed rows in central London, the default view.
    const marker = await firstUnobscuredMarker(page);
    await marker.click();

    await expect(page).toHaveURL(/\/loos\/[0-9a-f]{24}$/);
    const id = new URL(page.url()).pathname.split("/").pop() ?? "";
    const loo = await getLoo(id);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "Toilet");
  });

  test("legacy /loo/:id permanently redirects to /loos/:id", async ({ request, page, loos }) => {
    const loo = await loos.create({}, "map legacy url");

    const res = await request.get(`/loo/${loo.id}?utm=e2e`, { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers().location).toBe(`/loos/${loo.id}?utm=e2e`);

    await page.goto(`/loo/${loo.id}`);
    await expect(page).toHaveURL(new RegExp(`/loos/${loo.id}$`));
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
  });

  // Found by the Phase 1 suite and fixed in Phase 4: the map now pans the selected marker
  // clear of the details panel and the floating controls (LooMap revealSelected).
  test("deep-linked toilet's marker is not hidden behind the map controls", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create({ location: deepLinkSpot() }, "map marker visible");
    await page.goto(`/loos/${loo.id}`);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
    const marker = page.locator("#map .loo-marker svg[height='44']");
    await expect(marker).toHaveCount(1);
    await waitForMapToSettle(page.locator("#map"));
    await expect(marker).toBeInViewport();
    const box = await marker.boundingBox();
    if (!box) throw new Error("highlighted marker has no bounding box");
    const topmostIsMarker = await page.evaluate(
      ({ x, y }) => !!document.elementFromPoint(x, y)?.closest(".loo-marker"),
      { x: box.x + box.width / 2, y: box.y + box.height / 3 },
    );
    expect(topmostIsMarker, "the selected marker should not be covered by other UI").toBe(true);
  });
});
