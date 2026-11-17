import { e2eName, getLoo, randomFixtureLocation } from "./support/api";
import { expect, authedTest as test } from "./support/fixtures";
import {
  enterCoordinates,
  jsonBody,
  looForm,
  nextSave,
  QUESTIONS,
  waitForSaved,
} from "./support/form";
import { detailsPanelHeading } from "./support/map";

/** Signed-in "Add a toilet" (legacy cypress/e2e/{desktop,mobile}/add.cy.ts). */
test.describe("add (signed in)", () => {
  test("adds a toilet with a name, a confirmed pin and one facility", async ({ page, loos }) => {
    await page.goto("/loos/add");
    const form = looForm(page);
    await expect(form.heading).toHaveText("Add a toilet");
    // Add mode opens moving: a fixed centre pin, nothing confirmed yet.
    await expect(form.picker.useLocation).toBeVisible();
    await expect(form.save).toBeDisabled();

    // Saving without a confirmed pin is refused.
    const name = e2eName("added");
    await form.name.fill(name);
    await expect(form.save).toBeEnabled();
    await form.save.click();
    await expect(page.getByText("There's a problem")).toBeVisible();
    await expect(form.review).toBeHidden();

    // Somewhere off the default (London) view so it never shows up in the map tests.
    const target = randomFixtureLocation();
    await enterCoordinates(page, target);

    await form.facility(QUESTIONS.babyChange, "Yes").click();

    const post = nextSave(page, "POST");
    await form.save.click();
    await expect(form.review).toBeVisible();
    await expect(form.review.getByRole("heading")).toHaveText("Check the new toilet");
    await form.confirm.click();
    const body = jsonBody(await post);
    expect(body).toMatchObject({ name, babyChange: true, location: target });

    const id = await waitForSaved(page);
    loos.track(id);
    await expect(detailsPanelHeading(page)).toHaveText(name);

    const saved = await getLoo(id);
    expect(saved).toMatchObject({
      name,
      babyChange: true,
      accessible: null,
      notes: null,
      openingTimes: null,
      active: true,
    });
    expect(saved.location?.lat).toBeCloseTo(target.lat, 5);
    expect(saved.location?.lng).toBeCloseTo(target.lng, 5);
  });

  test("the map's 'Add a toilet here' opens the add form at that view", async ({ page }) => {
    const target = randomFixtureLocation();
    await page.goto(`/loos/add?lat=${target.lat}&lng=${target.lng}&zoom=18`);
    const form = looForm(page);
    await expect(form.picker.useLocation).toBeEnabled();
    await form.picker.useLocation.click();
    await expect(form.picker.movePin).toBeVisible();
    await form.picker.coordsToggle.click();
    const [lat, lng] = (await form.picker.coords.inputValue()).split(",").map(Number);
    expect(lat).toBeCloseTo(target.lat, 4);
    expect(lng).toBeCloseTo(target.lng, 4);
  });
});
