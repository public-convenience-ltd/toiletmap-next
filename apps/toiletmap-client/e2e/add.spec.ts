import type { Page } from "@playwright/test";
import { e2eName, getLoo, randomFixtureLocation } from "./support/api";
import { expect, authedTest as test } from "./support/fixtures";
import { jsonBody, looForm, nextSave } from "./support/form";
import { detailsPanelHeading } from "./support/map";

const nextFrames = (page: Page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

/** Signed-in "Add a toilet" (legacy cypress/e2e/{desktop,mobile}/add.cy.ts). */
test.describe("add (signed in)", () => {
  test("adds a toilet with a name, a placed pin and one facility", async ({ page, loos }) => {
    await page.goto("/loos/add");
    const form = looForm(page);
    await expect(form.heading).toHaveText("Add a toilet");
    await expect(form.pin).toHaveCount(0);

    // Saving without a pin is refused.
    const name = e2eName("added");
    await form.name.fill(name);
    await form.save.click();
    await expect(
      page.getByText("Please set the toilet's location on the map.").first(),
    ).toBeVisible();

    await form.placePin.click();
    await expect(form.pin).toBeVisible();
    await expect(form.movePinToCentre).toBeVisible();
    // Fine-tune by typing coordinates, moving it off the default (London) view
    // so it never shows up in the map tests.
    const target = randomFixtureLocation();
    // Commit each field (Enter) and let Preact flush its effects in between: the
    // form re-syncs both text boxes from the pin after every commit, which
    // would overwrite a second box filled within the same frame.
    await form.latitude.fill(String(target.lat));
    await form.latitude.press("Enter");
    await nextFrames(page);
    await form.longitude.fill(String(target.lng));
    await form.longitude.press("Enter");
    await nextFrames(page);
    await expect(form.latitude).toHaveValue(String(target.lat));
    await expect(form.longitude).toHaveValue(String(target.lng));

    await form.facility("Baby change", "Yes").click();

    const post = nextSave(page, "POST");
    await form.save.click();
    const body = jsonBody(await post);
    expect(body).toMatchObject({ name, babyChange: true, location: target });

    await page.waitForURL(/\/loos\/[0-9a-f]{24}$/);
    const id = new URL(page.url()).pathname.split("/").pop() ?? "";
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
});
