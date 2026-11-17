import type { Page } from "@playwright/test";
import { e2eName, randomFixtureLocation } from "./support/api";
import { expect, authedTest as test } from "./support/fixtures";
import { locationPicker, looForm, openEditForm } from "./support/form";

/**
 * The location picker's guard rails, driven without drags (by "Enter coordinates" and
 * buttons) so they also run on the phone projects: edit opens locked; Move pin shows how far
 * and which way the pin moved; Reset goes back; a big move warns; add mode needs zoom 17
 * before confirming; and a pin dropped on an existing toilet asks whether it is the same one.
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
    // Nothing reaches the form until the move is confirmed.
    await expect(form.save).toBeDisabled();

    await picker.useLocation.click();
    await expect(picker.movePin).toBeVisible();
    await expect(page.getByText(/^Moved 2\d m north from the saved location\.$/)).toBeVisible();
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

    // Resetting while moving goes back to where it was and ends the move.
    await form.picker.reset.click();
    await expect(form.picker.bigMoveWarning).toHaveCount(0);
    await expect(form.picker.useLocation).toHaveCount(0);
    await expect(form.picker.movePin).toBeFocused();
    await expect(form.save).toBeDisabled();
  });

  test("add: 'Use this location' waits for zoom 17", async ({ page }) => {
    const target = randomFixtureLocation();
    await page.goto(`/loos/add?lat=${target.lat}&lng=${target.lng}&zoom=13`);
    const picker = locationPicker(page);
    await expect(picker.useLocation).toBeDisabled();
    await expect(picker.zoomNotice).toBeVisible();

    await picker.zoomIn.click();
    await expect(picker.useLocation).toBeEnabled();
    await expect(picker.zoomNotice).toHaveCount(0);
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
    await picker.useLocation.click();

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
    await picker.useLocation.click();
    await expect(picker.duplicatePrompt).toBeVisible();
    await picker.differentToilet.click();
    await expect(picker.duplicatePrompt).toHaveCount(0);
    await expect(picker.movePin).toBeVisible();
  });
});
