import { e2eName, getLoo } from "./support/api";
import { expect, authedTest as test } from "./support/fixtures";
import { looForm, openEditForm, QUESTIONS, waitForSaved } from "./support/form";

/**
 * Optimistic concurrency (baseUpdatedAt → 409): two people edit the same
 * toilet at once; the second save is refused instead of silently overwriting
 * the first, and "Load latest and keep my changes" lets them finish.
 */

test.describe("edit conflicts", () => {
  test("changes to different fields: both survive after reloading the latest version", async ({
    page: alice,
    secondEditor: bob,
    loos,
  }) => {
    const loo = await loos.create({ notes: "Original notes" }, "conflict different");

    const aliceForm = await openEditForm(alice, loo.id);
    const bobForm = await openEditForm(bob, loo.id);

    const aliceName = e2eName("conflict renamed by alice");
    await aliceForm.name.fill(aliceName);
    await aliceForm.submit();
    await waitForSaved(alice, loo.id);

    await bobForm.notes.fill("Notes from Bob");
    await bobForm.submit();
    await expect(bobForm.conflictBanner).toBeVisible();
    await expect(bob.getByText("None of the fields you changed were affected")).toBeVisible();
    // Nothing was written by the refused save.
    expect((await getLoo(loo.id)).notes).toBe("Original notes");

    await bobForm.loadLatest.click();
    await expect(bobForm.conflictBanner).toBeHidden();
    await expect(bobForm.name).toHaveValue(aliceName);
    await expect(bobForm.notes).toHaveValue("Notes from Bob");
    await expect(bobForm.save).toHaveText("Save 1 change");
    await bobForm.submit();
    await waitForSaved(bob, loo.id);

    const after = await getLoo(loo.id);
    expect(after.name).toBe(aliceName);
    expect(after.notes).toBe("Notes from Bob");
  });

  test("changes to the same field: the conflict names it and the second editor's value wins on purpose", async ({
    page: alice,
    secondEditor: bob,
    loos,
  }) => {
    const loo = await loos.create({ notes: "Closed Sundays" }, "conflict same");

    const aliceForm = await openEditForm(alice, loo.id);
    const bobForm = await openEditForm(bob, loo.id);

    await aliceForm.notes.fill("Open Sundays since June");
    await aliceForm.submit();
    await waitForSaved(alice, loo.id);

    await bobForm.notes.fill("Closed Sundays, key at café");
    await bobForm.submit();
    await expect(bobForm.conflictBanner).toBeVisible();
    await expect(
      bob.getByText("These fields you changed have also been changed by someone else:"),
    ).toBeVisible();
    await expect(bob.getByRole("listitem").filter({ hasText: /^Notes$/ })).toBeVisible();
    expect((await getLoo(loo.id)).notes).toBe("Open Sundays since June");

    await bobForm.loadLatest.click();
    await expect(bobForm.notes).toHaveValue("Closed Sundays, key at café");
    await bobForm.submit();
    await waitForSaved(bob, loo.id);

    expect((await getLoo(loo.id)).notes).toBe("Closed Sundays, key at café");
  });

  test("the form keeps the conflict state usable: the save button still reflects the user's edits", async ({
    page,
    secondEditor: other,
    loos,
  }) => {
    const loo = await loos.create({ accessible: true }, "conflict save state");
    const form = await openEditForm(page, loo.id);
    const otherForm = await openEditForm(other, loo.id);

    await otherForm.notes.fill("Someone else's note");
    await otherForm.submit();
    await waitForSaved(other, loo.id);

    await form.facility(QUESTIONS.accessible, "No").click();
    await form.submit();
    await expect(form.conflictBanner).toBeVisible();
    await expect(looForm(page).save).toBeEnabled();
    await form.loadLatest.click();
    await expect(form.notes).toHaveValue("Someone else's note");
    await form.submit();
    await waitForSaved(page, loo.id);

    const after = await getLoo(loo.id);
    expect(after.accessible).toBe(false);
    expect(after.notes).toBe("Someone else's note");
  });
});
