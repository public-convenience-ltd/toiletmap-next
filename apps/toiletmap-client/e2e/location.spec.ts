import type { Locator, Page } from "@playwright/test";
import { e2eName, getLoo } from "./support/api";
import { expect, authedTest as test } from "./support/fixtures";
import { jsonBody, nextSave, openEditForm, waitForSaved } from "./support/form";
import { waitForMapToSettle } from "./support/map";

/**
 * The location picker (src/components/LooForm/LocationPicker.tsx): the pin
 * only moves when dragged or via "Move pin to centre of map", never on a plain
 * map click, and "Reset to original location" undoes the move exactly.
 * Desktop only — these use mouse drags.
 */

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

test.describe("location picker", () => {
  test("a plain click or tap on the map does not move the pin", async ({ page, loos }) => {
    const loo = await loos.create({}, "location click");
    const form = await openEditForm(page, loo.id);
    const lat = await form.latitude.inputValue();
    const lng = await form.longitude.inputValue();

    const map = await box(form.map);
    await page.mouse.click(map.x + map.width * 0.2, map.y + map.height * 0.25);
    await page.mouse.click(map.x + map.width * 0.8, map.y + map.height * 0.75);

    // Negative assertions: let the map and the form react first, then read once
    // (a retrying `toHaveValue` would pass immediately, before any reaction).
    await waitForMapToSettle(form.map);
    expect(await form.latitude.inputValue()).toBe(lat);
    expect(await form.longitude.inputValue()).toBe(lng);
    expect(await form.resetLocation.isVisible()).toBe(false);
    expect(await form.save.isDisabled()).toBe(true);
  });

  test("dragging the pin moves it, and reset restores the original location", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create({}, "location drag");
    const form = await openEditForm(page, loo.id);
    const lat = await form.latitude.inputValue();
    const lng = await form.longitude.inputValue();

    const pin = await box(form.pin);
    await drag(page, { x: pin.x + pin.width / 2, y: pin.y + pin.height / 2 }, { x: 80, y: 40 });

    await expect(form.latitude).not.toHaveValue(lat);
    await expect(form.longitude).not.toHaveValue(lng);
    await expect(form.resetLocation).toBeVisible();
    await expect(form.save).toHaveText("Save 1 change");

    await form.resetLocation.click();
    await expect(form.latitude).toHaveValue(lat);
    await expect(form.longitude).toHaveValue(lng);
    await expect(form.resetLocation).toBeHidden();
    await expect(form.save).toBeDisabled();
  });

  test("after panning, 'Move pin to centre of map' moves the pin and saves the new location", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create({}, "location centre");
    const form = await openEditForm(page, loo.id);
    const lat = await form.latitude.inputValue();

    const map = await box(form.map);
    // Grab the map away from the pin (which sits in the centre) and pan it.
    await drag(
      page,
      { x: map.x + map.width * 0.25, y: map.y + map.height * 0.5 },
      { x: 0, y: -120 },
    );
    await waitForMapToSettle(form.map);
    expect(await form.latitude.inputValue(), "panning alone must not move the pin").toBe(lat);
    expect(await form.resetLocation.isVisible()).toBe(false);

    await form.movePinToCentre.click();
    await expect(form.latitude).not.toHaveValue(lat);
    await expect(form.resetLocation).toBeVisible();

    const newLat = Number(await form.latitude.inputValue());
    const newLng = Number(await form.longitude.inputValue());
    const put = nextSave(page, "PUT");
    await form.save.click();
    const body = jsonBody(await put);
    expect(Object.keys(body).sort()).toEqual(["baseUpdatedAt", "location"]);
    await waitForSaved(page, loo.id);

    const after = await getLoo(loo.id);
    expect(after.location?.lat).toBeCloseTo(newLat, 5);
    expect(after.location?.lng).toBeCloseTo(newLng, 5);
    // Dragging the map content up brings land further south into the centre.
    expect(after.location?.lat).toBeLessThan(loo.location?.lat ?? Number.NEGATIVE_INFINITY);
  });

  test("saving after a reset sends no location change", async ({ page, loos }) => {
    const loo = await loos.create({}, "location reset save");
    const form = await openEditForm(page, loo.id);

    const pin = await box(form.pin);
    await drag(page, { x: pin.x + pin.width / 2, y: pin.y + pin.height / 2 }, { x: -60, y: 50 });
    await expect(form.resetLocation).toBeVisible();
    await form.resetLocation.click();
    await expect(form.resetLocation).toBeHidden();

    const newName = e2eName("location reset renamed");
    await form.name.fill(newName);
    await expect(form.save).toHaveText("Save 1 change");
    const put = nextSave(page, "PUT");
    await form.save.click();
    const body = jsonBody(await put);
    expect(body).not.toHaveProperty("location");
    await waitForSaved(page, loo.id);

    const after = await getLoo(loo.id);
    expect(after.name).toBe(newName);
    expect(after.location).toEqual(loo.location);
  });
});
