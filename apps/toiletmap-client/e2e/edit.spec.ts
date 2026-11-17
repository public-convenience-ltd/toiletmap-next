import { e2eName, getLoo, type OpeningTimes, stable } from "./support/api";
import { expect, authedTest as test } from "./support/fixtures";
import { jsonBody, looForm, nextSave, openEditForm, QUESTIONS, waitForSaved } from "./support/form";
import { detailsPanelHeading, expectDetailsExpanded } from "./support/map";

/**
 * Signed-in editing (legacy cypress/e2e/{desktop,mobile}/edit.cy.ts), with the
 * Phase 0 guarantees: the form sends only what the user changed.
 */

const HOURS: OpeningTimes = [
  ["09:00", "17:00"],
  ["09:00", "17:00"],
  [],
  ["00:00", "00:00"],
  ["09:00", "17:00"],
  ["10:00", "16:00"],
  [],
];

test.describe("edit (signed in)", () => {
  test("changing only the name saves only the name", async ({ page, loos }) => {
    const loo = await loos.create(
      {
        notes: "Key from the café",
        paymentDetails: "20p",
        noPayment: false,
        accessible: true,
        babyChange: false,
        openingTimes: HOURS,
      },
      "edit name",
    );
    const before = await getLoo(loo.id);
    const form = await openEditForm(page, loo.id);
    await expect(form.save).toBeDisabled();

    const newName = e2eName("edit name renamed");
    await form.name.fill(newName);
    await expect(form.save).toHaveText("Save 1 change");

    const put = nextSave(page, "PUT");
    await form.submit();
    const body = jsonBody(await put);
    expect(Object.keys(body).sort()).toEqual(["baseUpdatedAt", "name"]);
    expect(body.name).toBe(newName);
    expect(body.baseUpdatedAt).toBe(before.updatedAt);

    await waitForSaved(page, loo.id);
    await expect(detailsPanelHeading(page)).toHaveText(newName);

    const after = await getLoo(loo.id);
    expect(after.name).toBe(newName);
    expect(stable(after, "name")).toEqual(stable(before, "name"));
  });

  test("unknown opening hours stay unknown when another field is edited", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create({ notes: "Old notes" }, "edit hours unknown");
    expect(loo.openingTimes).toBeNull();

    const form = await openEditForm(page, loo.id);
    await form.notes.fill("New notes");
    const put = nextSave(page, "PUT");
    await form.submit();
    const body = jsonBody(await put);
    expect(body).not.toHaveProperty("openingTimes");
    await waitForSaved(page, loo.id);

    const after = await getLoo(loo.id);
    expect(after.notes).toBe("New notes");
    expect(after.openingTimes).toBeNull();
  });

  test("clearing the notes clears them", async ({ page, loos }) => {
    const loo = await loos.create({ notes: "Closed Sundays" }, "edit clear notes");
    const form = await openEditForm(page, loo.id);
    await expect(form.notes).toHaveValue("Closed Sundays");

    await form.notes.fill("");
    const put = nextSave(page, "PUT");
    await form.submit();
    expect(jsonBody(await put)).toMatchObject({ notes: null });
    await waitForSaved(page, loo.id);

    expect((await getLoo(loo.id)).notes).toBeNull();
  });

  test("Save stays disabled until something changes, and again once it is undone", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create({ accessible: true }, "edit save state");
    const form = await openEditForm(page, loo.id);
    await expect(form.save).toBeDisabled();
    await expect(form.save).toHaveText("No changes to save");

    await form.facility(QUESTIONS.accessible, "No").click();
    await form.notes.fill("Something new");
    await expect(form.save).toBeEnabled();
    await expect(form.save).toHaveText("Save 2 changes");

    await form.facility(QUESTIONS.accessible, "Yes").click();
    await form.notes.fill("");
    await expect(form.save).toBeDisabled();
    await expect(form.save).toHaveText("No changes to save");
  });

  test("the edit page never contains the access token", async ({ page, context, loos }) => {
    const loo = await loos.create({}, "edit token");
    const token = (await context.cookies()).find((c) => c.name === "access_token")?.value;
    expect(token, "signed-in context should carry an access_token cookie").toBeTruthy();

    const html = await (await page.request.get(`/loos/${loo.id}/edit`)).text();
    expect(html).toContain(loo.id); // the SSR'd page, with the toilet as island props
    expect(html).not.toContain(token as string);

    await openEditForm(page, loo.id);
    expect(await page.content()).not.toContain(token as string);
    // The token cookie must stay out of reach of page scripts.
    expect(await page.evaluate(() => document.cookie)).not.toContain("access_token");
  });

  test("an unknown toilet id gives a 404", async ({ page }) => {
    const response = await page.goto("/loos/ffffffffffffffffffffffff/edit");
    expect(response?.status()).toBe(404);
  });

  test("edits made from the details panel show up straight after saving", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create({}, "edit from panel");
    await page.goto(`/loos/${loo.id}`);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");

    // The panel opens expanded: Suggest an edit is in its details straight away.
    await expectDetailsExpanded(page);
    await page.locator(".toilet-panel").getByRole("link", { name: "Suggest an edit" }).click();
    const form = looForm(page);
    await expect(form.heading).toHaveText("Edit toilet");
    const newName = e2eName("edit from panel renamed");
    await form.name.fill(newName);
    await form.submit();

    await waitForSaved(page, loo.id);
    await expect(detailsPanelHeading(page)).toHaveText(newName);
  });
});
