import { e2eName, getLoo } from "./support/api";
import { expect, authedTest as test } from "./support/fixtures";
import { jsonBody, nextSave, openEditForm, QUESTIONS, waitForSaved } from "./support/form";

/** Every save goes through a "Check your changes" sheet that lists exactly what changed. */
test.describe("review sheet", () => {
  test("lists exactly the changed fields; Back to editing keeps the changes", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create(
      { notes: "Round the back", accessible: true, radar: false, babyChange: false },
      "review",
    );
    const form = await openEditForm(page, loo.id);

    const newName = e2eName("review renamed");
    await form.name.fill(newName);
    await form.facility(QUESTIONS.accessible, "No").click();
    await form.notes.fill("By the car park entrance");
    await expect(form.save).toHaveText("Save 3 changes");

    await form.save.click();
    await expect(form.review).toBeVisible();
    await expect(form.review.getByRole("heading", { name: "Check your changes" })).toBeFocused();
    await expect(form.review.getByText("You're changing 3 things:")).toBeVisible();
    const items = form.reviewItems;
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toHaveText(`Name: ${loo.name} → changes to ${newName}`);
    await expect(items.filter({ hasText: /^Wheelchair accessible:/ })).toHaveText(
      "Wheelchair accessible: Yes → changes to No",
    );
    await expect(items.filter({ hasText: /^Notes:/ })).toHaveText(
      "Notes: Round the back → changes to By the car park entrance",
    );
    await expect(items.filter({ hasText: /RADAR|Baby/ })).toHaveCount(0);

    await form.backToEditing.click();
    await expect(form.review).toBeHidden();
    await expect(form.save).toBeFocused();
    await expect(form.name).toHaveValue(newName);
    await expect(form.notes).toHaveValue("By the car park entrance");
    await expect(
      page
        .getByRole("group", { name: QUESTIONS.accessible })
        .getByRole("radio", { name: "No", exact: true }),
    ).toBeChecked();
    await expect(form.save).toHaveText("Save 3 changes");

    // Escape also goes back without saving.
    await form.save.click();
    await expect(form.review).toBeVisible();
    // The sheet moves focus in after it renders; Escape is handled inside it.
    await expect(form.review.getByRole("heading", { name: "Check your changes" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(form.review).toBeHidden();
    expect((await getLoo(loo.id)).name).toBe(loo.name);

    const put = nextSave(page, "PUT");
    await form.submit();
    const body = jsonBody(await put);
    expect(Object.keys(body).sort()).toEqual(["accessible", "baseUpdatedAt", "name", "notes"]);
    await waitForSaved(page, loo.id);
    expect(await getLoo(loo.id)).toMatchObject({
      name: newName,
      accessible: false,
      notes: "By the car park entrance",
      radar: false,
      babyChange: false,
    });
  });

  test("Cancel with unsaved changes asks before discarding them", async ({ page, loos }) => {
    const loo = await loos.create({}, "review discard");
    const form = await openEditForm(page, loo.id);
    await form.notes.fill("Something I typed");

    await page.getByRole("link", { name: "Cancel", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: "Discard your changes?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Keep editing" })).toBeFocused();
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(dialog).toBeHidden();
    await expect(form.notes).toHaveValue("Something I typed");

    await page.getByRole("link", { name: "Cancel", exact: true }).click();
    await dialog.getByRole("button", { name: "Discard changes" }).click();
    await page.waitForURL(new RegExp(`/loos/${loo.id}$`));
    expect((await getLoo(loo.id)).notes).toBeNull();
  });
});
