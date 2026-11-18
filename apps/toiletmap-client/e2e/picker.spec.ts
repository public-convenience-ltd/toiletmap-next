import type { Page } from "@playwright/test";
import { e2eName, getLoo, randomFixtureLocation } from "./support/api";
import { expect, authedTest as test } from "./support/fixtures";
import {
  box,
  jsonBody,
  locationPicker,
  looForm,
  nextSave,
  openEditForm,
  waitForSaved,
} from "./support/form";
import { waitForMapToSettle } from "./support/map";

/**
 * The location picker's guard rails, mostly driven without drags (by "Enter coordinates" and
 * buttons) so they also run on the phone projects: edit opens locked; Move pin shows how far
 * and which way the pin moved; Reset goes back; a big move warns and blocks Save; below zoom 17
 * the button is "Zoom in"; and a pin on an existing toilet asks whether it is the same one.
 * The touch tests drive a real touch screen on the Pixel 7 project.
 */

/** About 22 m north of `from` (1° of latitude is about 111 km). */
const north = (from: { lat: number; lng: number }, degrees: number) => ({
  lat: Number((from.lat + degrees).toFixed(6)),
  lng: from.lng,
});

/** Moves the picker's map to `target` with "Enter coordinates" → "Show on map" (starts moving). */
async function showOnMap(page: Page, target: { lat: number; lng: number }) {
  const picker = locationPicker(page);
  if (!(await picker.coords.isVisible())) await picker.coordsToggle.click();
  await picker.coords.fill(`${target.lat}, ${target.lng}`);
  await picker.showOnMap.click();
  await expect(picker.useLocation).toBeFocused();
}

test.describe("location picker guard rails", () => {
  test("edit: locked → move → the chip shows the distance → reset", async ({ page, loos }) => {
    const loo = await loos.create({}, "picker move chip");
    const origin = loo.location ?? { lat: 0, lng: 0 };
    const form = await openEditForm(page, loo.id);
    const picker = form.picker;

    // Locked preview: nothing to confirm, no reset.
    await expect(picker.useLocation).toHaveCount(0);
    await expect(picker.reset).toHaveCount(0);
    await expect(picker.map).toHaveAttribute("aria-label", /^Preview of where the toilet is/);

    await picker.movePin.click();
    await expect(picker.useLocation).toBeVisible();
    await expect(picker.map).toHaveAttribute("aria-label", /the pin stays in the centre/);

    await showOnMap(page, north(origin, 0.0002));
    await expect(picker.chip).toHaveText(/^Moved 2\d m north$/);
    await expect(picker.bigMoveWarning).toHaveCount(0);
    // The pending move already counts as a change (it isn't kept until it is checked).
    await expect(form.save).toHaveText("Save 1 change");

    await picker.useLocation.click();
    await expect(picker.movePin).toBeVisible();
    await expect(picker.strip).toHaveText(
      /^Moved 2\d m north from the saved location\. Locked again\.$/,
    );
    await expect(form.save).toHaveText("Save 1 change");

    await picker.reset.click();
    await expect(picker.reset).toHaveCount(0);
    await expect(form.save).toBeDisabled();
    await expect(form.save).toHaveText("No changes to save");
  });

  test("edit: a move over 50 m warns and offers to add a new toilet", async ({ page, loos }) => {
    const loo = await loos.create({}, "picker big move");
    const origin = loo.location ?? { lat: 0, lng: 0 };
    const form = await openEditForm(page, loo.id);

    await showOnMap(page, north(origin, 0.001));
    await expect(form.picker.chip).toHaveText(/^Moved 1\d\d m north$/);
    await expect(form.picker.bigMoveWarning).toBeVisible();
    await expect(form.picker.addInstead).toHaveAttribute(
      "href",
      /^\/loos\/add\?lat=[-\d.]+&lng=[-\d.]+&zoom=\d+$/,
    );

    // A big move is never kept by itself: Save says how to answer it.
    await form.save.click();
    await expect(
      page.getByRole("link", {
        name: "Confirm the big move with “Use this location”, or cancel it.",
      }),
    ).toBeVisible();
    await expect(form.review).toBeHidden();

    // Resetting while moving goes back to where it was and ends the move.
    await form.picker.reset.click();
    await expect(form.picker.bigMoveWarning).toHaveCount(0);
    await expect(form.picker.useLocation).toHaveCount(0);
    await expect(form.picker.movePin).toBeFocused();
    await expect(form.save).toBeDisabled();
  });

  test("add: below zoom 17 the button is 'Zoom in', never a disabled button", async ({ page }) => {
    const target = randomFixtureLocation();
    await page.goto(`/loos/add?lat=${target.lat}&lng=${target.lng}&zoom=13`);
    const picker = locationPicker(page);
    await expect(picker.zoomIn).toBeEnabled();
    await expect(picker.useLocation).toHaveCount(0);
    await expect(picker.zoomNotice).toBeVisible();

    await picker.zoomIn.click();
    await expect(picker.useLocation).toBeEnabled();
    await expect(picker.zoomNotice).toHaveCount(0);
    // The same button ignores presses for half a second after "Zoom in" (no double-tap confirm).
    await page.waitForTimeout(600);
    await picker.useLocation.click();
    await expect(picker.movePin).toBeVisible();
  });

  test("add: a pin within 30 m of a toilet asks to edit that one instead", async ({
    page,
    loos,
  }) => {
    const existing = await loos.create({ name: e2eName("picker existing") }, "picker existing");
    const origin = existing.location ?? { lat: 0, lng: 0 };
    const spot = north(origin, 0.00007); // about 8 m away
    await page.goto(`/loos/add?lat=${spot.lat}&lng=${spot.lng}&zoom=18`);
    const picker = locationPicker(page);

    // Asked as soon as the map is still at zoom 17 or closer: no button to press first.
    await expect(picker.duplicatePrompt).toBeVisible();
    await expect(picker.duplicatePrompt).toContainText(existing.name ?? "");
    await expect(picker.duplicatePrompt).toContainText(/There's already a toilet \d m away/);
    await picker.editThatToilet.click();

    await page.waitForURL(`**/loos/${existing.id}/edit`);
    await expect(looForm(page).heading).toHaveText("Edit toilet");
    await expect(looForm(page).name).toHaveValue(existing.name ?? "");
  });

  test("add: 'No, this is a different toilet' keeps the new pin", async ({ page, loos }) => {
    const existing = await loos.create({}, "picker different");
    const origin = existing.location ?? { lat: 0, lng: 0 };
    const spot = north(origin, 0.00012); // about 13 m away
    await page.goto(`/loos/add?lat=${spot.lat}&lng=${spot.lng}&zoom=18`);
    const picker = locationPicker(page);
    await expect(picker.duplicatePrompt).toBeVisible();
    await picker.differentToilet.click();
    await expect(picker.duplicatePrompt).toHaveCount(0);
    // Remembered for that toilet: confirming the spot doesn't ask again.
    await picker.useLocation.click();
    await expect(picker.movePin).toBeVisible();
    await expect(picker.duplicatePrompt).toHaveCount(0);
  });

  test("the locked map is not a Tab stop, and Move pin keeps it where it was on screen", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create({}, "picker tab stop");
    const form = await openEditForm(page, loo.id);
    const picker = form.picker;
    // Leaflet's keyboard handler makes the map a Tab stop as it starts: not while locked.
    await expect(picker.map).toHaveAttribute("tabindex", "-1");

    // With the map in the middle of the screen, Move pin adds the search box above it: the
    // page scrolls by as much, so the map doesn't jump away from the user's finger.
    await picker.map.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const before = await box(picker.map);
    await picker.movePin.click();
    await expect(page.getByRole("searchbox", { name: "Search for a place" })).toBeVisible();
    await expect(picker.map).toHaveAttribute("tabindex", "0");
    const after = await box(picker.map);
    expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  });

  test("a page scroll over the locked map still scrolls the page", async ({
    page,
    loos,
    browserName,
    isMobile,
  }) => {
    test.skip(
      browserName === "webkit" && isMobile,
      "Playwright can't scroll mobile WebKit by touch or wheel",
    );
    const loo = await loos.create({}, "picker scroll");
    const form = await openEditForm(page, loo.id);
    const picker = form.picker;
    await picker.map.evaluate((el) => el.scrollIntoView({ block: "start" }));
    const before = await page.evaluate(() => window.scrollY);
    const pinBefore = await box(form.pin);
    const map = await box(picker.map);
    const at = { x: map.x + map.width * 0.3, y: map.y + map.height * 0.4 };
    // Scroll back towards the top of the page: with the map at the top of the viewport
    // there is always room to scroll up.
    expect(before).toBeGreaterThan(100);

    if (isMobile) {
      // Chromium's synthetic touch-scroll gesture doesn't scroll anything on CI's Linux
      // runners (it does on macOS), so check what decides whether a phone scrolls the
      // page: every element under the finger lets vertical pans through, and nothing
      // cancels the touch.
      const touch = await page.evaluate(({ x, y }) => {
        const target = document.elementFromPoint(x, y);
        if (!target) return { found: false, blocked: [], cancelled: [] };
        const blocked: string[] = [];
        for (let el: Element | null = target; el; el = el.parentElement) {
          const action = getComputedStyle(el).touchAction;
          const allowsPanY =
            action === "auto" || action === "manipulation" || /\bpan-y\b/.test(action);
          if (!allowsPanY) blocked.push(`${el.tagName.toLowerCase()}.${el.className}: ${action}`);
        }
        const cancelled: string[] = [];
        const point = (dy: number) =>
          new Touch({ identifier: 1, target, clientX: x, clientY: y + dy });
        for (const [type, dy] of [
          ["touchstart", 0],
          ["touchmove", 40],
          ["touchmove", 120],
          ["touchend", 120],
        ] as const) {
          const touches = type === "touchend" ? [] : [point(dy)];
          const event = new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches,
            targetTouches: touches,
            changedTouches: [point(dy)],
          });
          if (!target.dispatchEvent(event)) cancelled.push(`${type} +${dy}`);
        }
        return { found: true, blocked, cancelled };
      }, at);
      expect(touch).toEqual({ found: true, blocked: [], cancelled: [] });
    } else {
      await page.mouse.move(at.x, at.y);
      await page.mouse.wheel(0, -300);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(before - 50);
    }

    await waitForMapToSettle(picker.map);
    // The map didn't move under the pin, and it is still locked.
    const pinAfter = await box(form.pin);
    const mapAfter = await box(picker.map);
    expect(pinAfter.x - mapAfter.x).toBeCloseTo(pinBefore.x - map.x, 0);
    expect(pinAfter.y - mapAfter.y).toBeCloseTo(pinBefore.y - map.y, 0);
    await expect(picker.movePin).toBeVisible();
    await expect(form.save).toBeDisabled();
  });
});

/** Swipes a real touch point across the screen (Chromium only), slowly enough for no fling. */
async function touchDrag(page: Page, from: { x: number; y: number }, by: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  const point = (t: number) => ({
    x: Math.round(from.x + by.x * t),
    y: Math.round(from.y + by.y * t),
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(0)] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(i / 10)],
    });
  }
  await page.waitForTimeout(200);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test.describe("location picker on a touch screen (Pixel 7)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "mobile-chromium", "drives a Chromium touch screen");
  });

  test("edit: touch the locked map, see why, Move pin, pan, Save", async ({ page, loos }) => {
    const loo = await loos.create({}, "picker touch edit");
    const form = await openEditForm(page, loo.id);
    const picker = form.picker;
    await picker.map.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const map = await box(picker.map);

    // A tap on the locked map moves nothing; it says how to unlock it.
    await page.touchscreen.tap(map.x + map.width * 0.3, map.y + map.height * 0.3);
    await expect(
      picker.map
        .locator("..")
        .getByText("Locked to stop accidental moves. Choose Move pin to change the location."),
    ).toBeVisible();
    await expect(form.save).toBeDisabled();

    await picker.movePin.click();
    await expect(picker.useLocation).toBeVisible();
    // Drag the map up by touch: land to the south comes under the centre pin (about 30 m).
    await touchDrag(
      page,
      { x: map.x + map.width * 0.3, y: map.y + map.height * 0.6 },
      { x: 0, y: -40 },
    );
    await waitForMapToSettle(picker.map);
    await expect(picker.chip).toHaveText(/^Moved \d+ m south$/);
    await expect(form.save).toHaveText("Save 1 change");

    const put = nextSave(page, "PUT");
    await form.save.click();
    // Kept automatically and going live straight away: one check before it is saved.
    const check = page.getByRole("alertdialog", { name: "Save the new location?" });
    await expect(check).toContainText(/You moved the pin \d+ m south\./);
    // That was the only change, so this was its check: saved without the review sheet.
    await check.getByRole("button", { name: "Yes, save the new location" }).click();
    const body = jsonBody(await put);
    await expect(form.review).toBeHidden();
    expect(Object.keys(body).sort()).toEqual(["baseUpdatedAt", "location"]);
    await waitForSaved(page, loo.id);
    const after = await getLoo(loo.id);
    expect(after.location?.lat).toBeLessThan(loo.location?.lat ?? Number.NEGATIVE_INFINITY);
  });
});
