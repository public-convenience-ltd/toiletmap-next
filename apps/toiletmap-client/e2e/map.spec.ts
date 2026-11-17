import { getLoo } from "./support/api";
import { expect, test } from "./support/fixtures";
import { detailsPanelHeading, firstUnobscuredMarker, waitForMap } from "./support/map";

/**
 * Ported from legacy cypress/e2e/{desktop,mobile}/index.cy.ts: the map renders
 * markers, a marker opens the details panel, and deep links work.
 */

// Deep-link fixtures get a random spot in their own region, away from the
// default home view (so the home tests only ever see seed rows) and from the
// random fixture band in support/api.ts. Random rather than fixed so that
// tests running at the same time (other projects, --repeat-each) never land
// close enough to cluster.
const deepLinkSpot = () => ({
  lat: Number((53.0 + Math.random() * 0.6).toFixed(6)),
  lng: Number((-2.5 + Math.random() * 1.5).toFixed(6)),
});

test.describe("map", () => {
  test("home page renders the map with markers or clusters", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Toilet Map");
    await waitForMap(page);
    await expect(page.locator("#map .loo-marker, #map .marker-cluster").first()).toBeVisible();
  });

  test("/loos/:id deep link opens the details panel; Escape closes it; a marker reopens it", async ({
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
    const box = await highlighted.boundingBox();
    if (!box) throw new Error("highlighted marker has no bounding box");

    await page.keyboard.press("Escape");
    await expect(page.locator(".toilet-panel")).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);

    // Drag the map down so the marker is clear of the floating search bar
    // (see the fixme test below), then click it. Both icons are anchored
    // bottom-centre, so the plain marker sits where the highlighted one did.
    const map = await page.locator("#map").boundingBox();
    if (!map) throw new Error("map has no bounding box");
    const dragBy = Math.round(map.height / 3);
    const start = { x: map.x + map.width / 2 + 60, y: map.y + map.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + dragBy, { steps: 8 });
    await page.waitForTimeout(200); // let Leaflet's inertia settle to zero before releasing
    await page.mouse.up();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 12 + dragBy);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
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

  // BUG (found by this suite): on a /loos/:id deep link the map is panned by half
  // the details panel's height, which on a 1280×720 desktop (and a Pixel 7) puts the
  // selected marker underneath the floating search/filter bar (MapControlsPanel)
  // or the panel itself, so the toilet the user asked for is not visible. LooMap's centring should account
  // for the controls (or use map.fitBounds/panInside with padding).
  test("deep-linked toilet's marker is not hidden behind the map controls", async ({
    page,
    loos,
  }, testInfo) => {
    test.fixme(
      ["desktop-chromium", "mobile-chromium"].includes(testInfo.project.name),
      "Known bug: the selected marker ends up under the search bar / details panel at 1280×720 and on Pixel 7 (LooMap initial centring)",
    );
    const loo = await loos.create({ location: deepLinkSpot() }, "map marker visible");
    await page.goto(`/loos/${loo.id}`);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
    const marker = page.locator("#map .loo-marker svg[height='44']");
    await expect(marker).toHaveCount(1);
    const box = await marker.boundingBox();
    if (!box) throw new Error("highlighted marker has no bounding box");
    const topmostIsMarker = await page.evaluate(
      ({ x, y }) => !!document.elementFromPoint(x, y)?.closest(".loo-marker"),
      { x: box.x + box.width / 2, y: box.y + box.height / 3 },
    );
    expect(topmostIsMarker, "the selected marker should not be covered by other UI").toBe(true);
  });
});
