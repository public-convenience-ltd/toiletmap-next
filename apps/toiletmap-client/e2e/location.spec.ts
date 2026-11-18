import type { Locator, Page } from "@playwright/test";
import { e2eName, getLoo, randomFixtureLocation } from "./support/api";
import { expect, authedTest as test } from "./support/fixtures";
import { jsonBody, looForm, nextSave, waitForSaved } from "./support/form";
import { waitForMapToSettle } from "./support/map";

/**
 * The location picker (src/components/LooForm/LocationPicker.tsx). Editing opens a locked
 * preview; "Move pin" lets the map pan under a fixed centre pin; nothing changes until
 * "Use this location". A plain click, tap or drag on the locked map never moves the toilet.
 * Desktop only — these use mouse drags.
 */

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
    chip: page.getByText(/^Moved \d/),
    bigMoveWarning: page.getByText("That's a big move — are you sure this is the same toilet?"),
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

/** The picker's Leaflet map (locked or moving). */
const pickerMap = (page: Page) => page.locator('[aria-roledescription="map"]');

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
  test("the locked preview ignores clicks and drags", async ({ page, loos }) => {
    const loo = await loos.create({}, "location locked");
    const form = await openEditForm(page, loo.id);
    const p = picker(page);
    // The form page scrolls as a whole: bring the preview fully on screen, so the click and
    // the drag below land on it, and measure the pin against the map.
    await pickerMap(page).evaluate((el) => el.scrollIntoView({ block: "center" }));
    const pinOnMap = async () => {
      const [pin, on] = [await box(form.pin), await box(pickerMap(page))];
      return { x: pin.x - on.x, y: pin.y - on.y, width: pin.width, height: pin.height };
    };
    const before = await pinOnMap();

    const map = await box(pickerMap(page));
    await page.mouse.click(map.x + map.width * 0.2, map.y + map.height * 0.25);
    await drag(
      page,
      { x: map.x + map.width * 0.25, y: map.y + map.height * 0.5 },
      { x: 80, y: -60 },
    );

    // Negative assertions: let the map and the form react first, then read once.
    await waitForMapToSettle(pickerMap(page));
    expect(await pinOnMap()).toEqual(before);
    expect(await p.reset.isVisible()).toBe(false);
    expect(await p.useLocation.isVisible()).toBe(false);
    expect(await form.save.isDisabled()).toBe(true);
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
    expect(await form.save.isDisabled(), "panning alone must not change the form").toBe(true);

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
