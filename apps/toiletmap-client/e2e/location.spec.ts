import type { Locator, Page } from "@playwright/test";
import { e2eName, getLoo, randomFixtureLocation } from "./support/api";
import { expect, authedTest as test } from "./support/fixtures";
import { jsonBody, looForm, nextSave, waitForSaved } from "./support/form";
import { waitForMapToSettle } from "./support/map";

/**
 * The location picker (src/components/LooForm/LocationPicker.tsx). Editing opens a locked
 * preview; "Move pin" (or, with a mouse, dragging the map) lets the map pan under a fixed
 * centre pin. A small move is kept when the user carries on with the form or saves; a click on
 * the locked map never moves the toilet. Adding works like the old map: pan, fill in, save.
 * Desktop only — these use mouse drags.
 */

/** The picker's Leaflet map (locked or moving). */
const pickerMap = (page: Page) => page.locator('[aria-roledescription="map"]');

/** Picker controls (kept here so the shared form helpers stay picker-agnostic). */
function picker(page: Page) {
  return {
    movePin: page.getByRole("button", { name: "Move pin" }),
    useLocation: page.getByRole("button", { name: "Use this location" }),
    cancel: page.getByRole("button", { name: "Cancel", exact: true }),
    reset: page.getByRole("button", { name: "Reset to original location" }),
    coordsToggle: page.getByText("Enter coordinates", { exact: true }),
    coords: page.getByRole("textbox", { name: "Latitude, longitude" }),
    showOnMap: page.getByRole("button", { name: "Show on map" }),
    chip: page.getByText(/^Moved [\d.]+ k?m [a-z-]+$/),
    strip: page.locator("[id$='-strip']"),
    bigMoveWarning: page.getByText("That's a big move — are you sure this is the same toilet?"),
    lockedMessage: pickerMap(page)
      .locator("..")
      .getByText("Locked to stop accidental moves. Choose Move pin to change the location."),
    locationCheck: page.getByRole("alertdialog", { name: "Save the new location?" }),
  };
}

/**
 * Opens the edit form and waits for the picker's locked pin. (Not the shared openEditForm, so
 * this spec doesn't depend on the form's heading copy.)
 */
async function openEditForm(page: Page, id: string) {
  const response = await page.goto(`/loos/${id}/edit`);
  expect(response?.status()).toBe(200);
  const form = looForm(page);
  await expect(form.pin).toHaveCount(1);
  await expect(form.pin).toBeVisible();
  await expect(picker(page).movePin).toBeVisible();
  return form;
}

/** Saves the form, through its review sheet if it shows one. */
async function save(page: Page, form: ReturnType<typeof looForm>) {
  await form.save.click();
  const confirm = page.getByRole("button", { name: "Confirm and save" });
  try {
    await confirm.click({ timeout: 3_000 });
  } catch {
    // No review step for this save.
  }
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element has no bounding box");
  return b;
}

/** Drags from one point to another slowly enough that Leaflet applies no inertia. */
async function drag(page: Page, from: { x: number; y: number }, by: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 10 });
  await page.waitForTimeout(200);
  await page.mouse.up();
}

/** The confirmed location, as the "Enter coordinates" box shows it. */
async function shownCoordinates(page: Page) {
  const p = picker(page);
  if (!(await p.coords.isVisible())) await p.coordsToggle.click();
  const [lat, lng] = (await p.coords.inputValue()).split(",").map((v) => Number(v.trim()));
  return { lat, lng };
}

test.describe("location picker", () => {
  test("a click on the locked preview explains the lock and moves nothing", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create({}, "location locked");
    const form = await openEditForm(page, loo.id);
    const p = picker(page);
    // The form page scrolls as a whole: bring the preview fully on screen, so the click
    // lands on it, and measure the pin against the map.
    await pickerMap(page).evaluate((el) => el.scrollIntoView({ block: "center" }));
    const pinOnMap = async () => {
      const [pin, on] = [await box(form.pin), await box(pickerMap(page))];
      return { x: pin.x - on.x, y: pin.y - on.y, width: pin.width, height: pin.height };
    };
    const before = await pinOnMap();

    const map = await box(pickerMap(page));
    await page.mouse.click(map.x + map.width * 0.2, map.y + map.height * 0.25);
    await expect(p.lockedMessage).toBeVisible();

    // Negative assertions: let the map and the form react first, then read once.
    await waitForMapToSettle(pickerMap(page));
    expect(await pinOnMap()).toEqual(before);
    expect(await p.reset.isVisible()).toBe(false);
    expect(await p.useLocation.isVisible()).toBe(false);
    expect(await form.save.isDisabled()).toBe(true);
  });

  test("dragging the locked map with a mouse moves it; Save 1 change asks first", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create({}, "location desktop drag");
    const form = await openEditForm(page, loo.id);
    const p = picker(page);
    await pickerMap(page).evaluate((el) => el.scrollIntoView({ block: "center" }));
    const map = await box(pickerMap(page));

    // Like the old map: just drag. Up, so land to the south comes under the centre pin.
    await drag(
      page,
      { x: map.x + map.width * 0.25, y: map.y + map.height * 0.6 },
      { x: 0, y: -40 },
    );
    await waitForMapToSettle(pickerMap(page));
    await expect(p.chip).toHaveText(/^Moved \d+ m south$/);
    await expect(p.useLocation).toBeVisible();
    await expect(form.save).toHaveText("Save 1 change");

    const put = nextSave(page, "PUT");
    await form.save.click();
    await expect(p.locationCheck).toContainText(/You moved the pin \d+ m south\./);
    // The move is the only change and this is its check: no review sheet asking it again.
    await p.locationCheck.getByRole("button", { name: "Yes, save the new location" }).click();
    const body = jsonBody(await put);
    await expect(form.review).toBeHidden();
    expect(Object.keys(body).sort()).toEqual(["baseUpdatedAt", "location"]);
    await waitForSaved(page, loo.id);
    const after = await getLoo(loo.id);
    expect(after.location?.lat).toBeLessThan(loo.location?.lat ?? Number.NEGATIVE_INFINITY);
  });

  test("'No, keep the old location' saves nothing when the move was the only change", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create({}, "location keep old");
    const form = await openEditForm(page, loo.id);
    const p = picker(page);
    await p.movePin.click();
    const map = await box(pickerMap(page));
    await drag(page, { x: map.x + map.width * 0.25, y: map.y + map.height * 0.5 }, { x: 30, y: 0 });
    await waitForMapToSettle(pickerMap(page));
    // Carrying on with the form keeps the move and locks the map again.
    await form.notes.click();
    await expect(p.movePin).toBeVisible();
    await expect(p.strip).toHaveText(/from the saved location\. Locked again\.$/);

    await form.save.click();
    await p.locationCheck.getByRole("button", { name: "No, keep the old location" }).click();
    await expect(p.locationCheck).toBeHidden();
    await expect(form.review).toBeHidden();
    await expect(form.save).toHaveText("No changes to save");
    expect(await shownCoordinates(page)).toEqual({
      lat: Number(loo.location?.lat.toFixed(6)),
      lng: Number(loo.location?.lng.toFixed(6)),
    });
  });

  test("move pin, pan, 'Use this location' saves the new location", async ({ page, loos }) => {
    const loo = await loos.create({}, "location move");
    const form = await openEditForm(page, loo.id);
    const p = picker(page);

    await p.movePin.click();
    const map = await box(pickerMap(page));
    // Drag the map content up: land further south comes under the centre pin.
    await drag(
      page,
      { x: map.x + map.width * 0.25, y: map.y + map.height * 0.6 },
      { x: 0, y: -60 },
    );
    await waitForMapToSettle(pickerMap(page));
    await expect(p.chip).toHaveText(/^Moved \d+ m south$/);
    // The pending move counts as a change, but nothing is kept until it is checked.
    await expect(form.save).toHaveText("Save 1 change");

    await p.useLocation.click();
    await expect(p.movePin).toBeVisible();
    await expect(p.reset).toBeVisible();

    const put = nextSave(page, "PUT");
    await save(page, form);
    const body = jsonBody(await put);
    expect(Object.keys(body).sort()).toEqual(["baseUpdatedAt", "location"]);
    await waitForSaved(page, loo.id);

    const after = await getLoo(loo.id);
    const sent = body.location as { lat: number; lng: number };
    expect(after.location?.lat).toBeCloseTo(sent.lat, 5);
    expect(after.location?.lng).toBeCloseTo(sent.lng, 5);
    expect(after.location?.lat).toBeLessThan(loo.location?.lat ?? Number.NEGATIVE_INFINITY);
  });

  test("Cancel after panning leaves the location alone", async ({ page, loos }) => {
    const loo = await loos.create({}, "location cancel");
    const form = await openEditForm(page, loo.id);
    const p = picker(page);

    await p.movePin.click();
    const map = await box(pickerMap(page));
    await drag(
      page,
      { x: map.x + map.width * 0.25, y: map.y + map.height * 0.5 },
      { x: 70, y: 40 },
    );
    await expect(p.chip).toBeVisible();
    await p.cancel.click();

    await expect(p.movePin).toBeVisible();
    await waitForMapToSettle(pickerMap(page));
    expect(await p.reset.isVisible()).toBe(false);
    expect(await form.save.isDisabled()).toBe(true);
    expect(await shownCoordinates(page)).toEqual({
      lat: Number(loo.location?.lat.toFixed(6)),
      lng: Number(loo.location?.lng.toFixed(6)),
    });
  });

  test("saving after a reset sends no location change", async ({ page, loos }) => {
    const loo = await loos.create({}, "location reset save");
    const form = await openEditForm(page, loo.id);
    const p = picker(page);

    await p.movePin.click();
    const map = await box(pickerMap(page));
    await drag(
      page,
      { x: map.x + map.width * 0.25, y: map.y + map.height * 0.5 },
      { x: -60, y: 50 },
    );
    await p.useLocation.click();
    await expect(p.movePin).toBeVisible(); // locked again
    await expect(p.reset).toBeVisible();
    await p.reset.click();
    await expect(p.reset).toBeHidden();

    const newName = e2eName("location reset renamed");
    // The name field's label is the form's copy, not the picker's: match either wording.
    await page.getByRole("textbox", { name: /^(Name|What's it called\?)$/ }).fill(newName);
    await expect(form.save).toHaveText("Save 1 change");
    const put = nextSave(page, "PUT");
    await save(page, form);
    const body = jsonBody(await put);
    expect(body).not.toHaveProperty("location");
    await waitForSaved(page, loo.id);

    const after = await getLoo(loo.id);
    expect(after.name).toBe(newName);
    expect(after.location).toEqual(loo.location);
  });

  test("typed coordinates are saved exactly, with no lat/lng race", async ({ page, loos }) => {
    const loo = await loos.create({}, "location typed");
    const form = await openEditForm(page, loo.id);
    const p = picker(page);
    const target = randomFixtureLocation();

    await p.coordsToggle.click();
    // One box for the pair, committed in one go: nothing can re-sync half of it.
    await p.coords.fill(`${target.lat}, ${target.lng}`);
    await p.coords.press("Enter");
    await expect(p.useLocation).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(p.movePin).toBeVisible();

    const put = nextSave(page, "PUT");
    await save(page, form);
    const body = jsonBody(await put);
    expect(body.location).toEqual(target);
    await waitForSaved(page, loo.id);
  });

  test("adding works like the old map: pan, name it, Add toilet (no confirm step)", async ({
    page,
    loos,
  }) => {
    const start = randomFixtureLocation();
    await page.goto(`/loos/add?lat=${start.lat}&lng=${start.lng}&zoom=17`);
    const form = looForm(page);
    await expect(form.heading).toHaveText("Add a toilet");
    await pickerMap(page).evaluate((el) => el.scrollIntoView({ block: "center" }));
    const map = await box(pickerMap(page));
    await drag(
      page,
      { x: map.x + map.width * 0.25, y: map.y + map.height * 0.6 },
      { x: 0, y: -50 },
    );
    await waitForMapToSettle(pickerMap(page));
    await expect(picker(page).strip).toHaveText(/^Pin placed\. Keep moving the map/);

    const name = e2eName("legacy add");
    await form.name.fill(name);
    const post = nextSave(page, "POST");
    await form.save.click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(form.review).toBeVisible();
    await form.confirm.click();
    const body = jsonBody(await post);
    const sent = body.location as { lat: number; lng: number };
    expect(body.name).toBe(name);
    // The pin is where the map was panned to, not where it opened.
    expect(sent.lat).toBeLessThan(start.lat);
    const id = await waitForSaved(page);
    loos.track(id);
  });

  test("adding without moving the map asks 'Is the pin on the toilet?'", async ({ page }) => {
    const start = randomFixtureLocation();
    await page.goto(`/loos/add?lat=${start.lat}&lng=${start.lng}&zoom=17`);
    const form = looForm(page);
    await form.name.fill(e2eName("unmoved add"));
    await form.save.click();
    const dialog = page.getByRole("alertdialog", { name: "Is the pin on the toilet?" });
    await expect(dialog.getByRole("button", { name: "Move the map" })).toBeFocused();
    await dialog.getByRole("button", { name: "Move the map" }).click();
    await expect(dialog).toBeHidden();
    await expect(pickerMap(page)).toBeFocused();
    await expect(form.review).toBeHidden();
  });

  test("a rough 'Use my location' fix never replaces a pin that was kept", async ({
    page,
    context,
  }) => {
    const start = randomFixtureLocation();
    await page.goto(`/loos/add?lat=${start.lat}&lng=${start.lng}&zoom=17`);
    const form = looForm(page);
    const p = picker(page);
    await pickerMap(page).evaluate((el) => el.scrollIntoView({ block: "center" }));
    const map = await box(pickerMap(page));
    await drag(
      page,
      { x: map.x + map.width * 0.25, y: map.y + map.height * 0.6 },
      { x: 0, y: -50 },
    );
    await waitForMapToSettle(pickerMap(page));
    await form.name.fill(e2eName("rough fix"));
    // Carrying on kept the pin and locked the map.
    await expect(p.movePin).toBeVisible();

    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      latitude: start.lat + 0.01,
      longitude: start.lng,
      accuracy: 800,
    });
    await p.movePin.click();
    await page.getByRole("button", { name: "Use my location" }).click();
    await expect(
      page.getByText(/only accurate to about 800 m, so the pin isn't placed yet/),
    ).toBeVisible();
    await expect(p.strip).toHaveText("Move the map until the pin is on the toilet's entrance.");

    await form.save.click();
    const dialog = page.getByRole("alertdialog", { name: "Is the pin on the toilet?" });
    await expect(dialog).toContainText(
      "The pin is at your approximate location, which is only accurate to about 800 m.",
    );
    await expect(form.review).toBeHidden();
  });

  test("resizing the window (a phone rotating) never places the pin", async ({ page }) => {
    const start = randomFixtureLocation();
    await page.goto(`/loos/add?lat=${start.lat}&lng=${start.lng}&zoom=14`);
    const form = looForm(page);
    const p = picker(page);
    await expect(p.strip).toHaveText("Zoom in closer to place the pin accurately");
    // Odd sizes, so Leaflet's half-size rounding changes on both axes.
    const original = page.viewportSize() ?? { width: 1280, height: 720 };
    await page.setViewportSize({ width: 851, height: 393 });
    await page.setViewportSize({ width: 393, height: 851 });
    await page.setViewportSize(original);
    await waitForMapToSettle(pickerMap(page));
    await page
      .locator("button")
      .filter({ hasText: /^Zoom in$/ })
      .click();
    await waitForMapToSettle(pickerMap(page));
    await expect(p.strip).toHaveText("Move the map until the pin is on the toilet's entrance.");

    await form.name.fill(e2eName("resize add"));
    await form.save.click();
    await expect(
      page.getByRole("alertdialog", { name: "Is the pin on the toilet?" }),
    ).toBeVisible();
    await expect(form.review).toBeHidden();
  });

  test("a big move warns and offers to add a new toilet instead", async ({ page, loos }) => {
    const loo = await loos.create({}, "location big move");
    await openEditForm(page, loo.id);
    const p = picker(page);

    await p.movePin.click();
    const map = await box(pickerMap(page));
    await drag(
      page,
      { x: map.x + map.width * 0.2, y: map.y + map.height * 0.8 },
      { x: 0, y: -200 },
    );
    await waitForMapToSettle(pickerMap(page));
    await expect(p.bigMoveWarning).toBeVisible();
    await expect(page.getByRole("link", { name: "Add as a new toilet instead" })).toHaveAttribute(
      "href",
      /^\/loos\/add\?lat=[-\d.]+&lng=[-\d.]+&zoom=\d+$/,
    );
  });
});
