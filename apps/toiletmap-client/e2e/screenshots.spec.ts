import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { looForm, openEditForm, SAVED_BANNER_TEXT, toasts } from "./support/form";
import { detailsPanelHeading, waitForMap, waitForMapToSettle } from "./support/map";

/**
 * Key-state screenshots for reviewing UI changes (tagged @screenshots). They run with the rest
 * of the suite and are saved to test-results/screenshots/<project>/, which CI uploads as the
 * "ui-screenshots" artifact for the PR's reviewers to look at.
 *
 * No pixel comparison on purpose: snapshots taken on a Mac won't match Linux CI (fonts,
 * antialiasing), so these are for people, not assertions. Each state is still checked to be
 * on screen before it is captured, so a broken page fails here rather than shipping a picture
 * of the wrong thing. Map tiles are blocked in e2e, so the map itself is a flat grey.
 */

const shot = async (page: Page, testInfo: TestInfo, name: string) => {
  // Let entrance animations (toasts, dialogs, sheets) finish so the picture is settled.
  await page.waitForTimeout(300);
  await page.screenshot({
    path: `test-results/screenshots/${testInfo.project.name}/${name}.png`,
    animations: "disabled",
    caret: "hide",
  });
};

// "@screenshots" in the title tags every test (`--grep @screenshots` runs just these).
test.describe("key-state screenshots @screenshots", () => {
  test("map and details panel", async ({ page, loos }, testInfo) => {
    const loo = await loos.create(
      { accessible: true, babyChange: true, noPayment: true, notes: "Key from the café" },
      "screenshot panel",
    );
    await page.goto("/");
    await waitForMap(page);
    await shot(page, testInfo, "01-map");

    // The "your changes are live" toast a save lands on, with the panel open.
    await page.goto(`/loos/${loo.id}?saved=1`);
    await waitForMap(page);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
    await expect(toasts(page).getByText(SAVED_BANNER_TEXT)).toBeVisible();
    await waitForMapToSettle(page.locator("#map"));
    await shot(page, testInfo, "02-panel-saved-toast");
  });

  test("edit form, review sheet and discard dialog", async ({ page, loos }, testInfo) => {
    const loo = await loos.create({}, "screenshot form");
    const form = await openEditForm(page, loo.id);
    await shot(page, testInfo, "03-edit-form");

    await form.notes.fill("Closed on match days");
    await form.save.click();
    await expect(form.review).toBeVisible();
    await shot(page, testInfo, "04-review-sheet");

    await form.backToEditing.click();
    await expect(form.review).toBeHidden();
    await page.getByRole("link", { name: "Cancel", exact: true }).click();
    const discard = page.getByRole("alertdialog", { name: "Discard your changes?" });
    await expect(discard).toBeVisible();
    await shot(page, testInfo, "05-discard-dialog");
  });

  test("add form", async ({ page }, testInfo) => {
    await page.goto("/loos/add?lat=51.5034&lng=-0.1276&zoom=17");
    await expect(looForm(page).heading).toHaveText("Add a toilet");
    await shot(page, testInfo, "06-add-form");
  });

  test("report a problem: confirm step", async ({ page, loos }, testInfo) => {
    const loo = await loos.create({}, "screenshot report");
    await page.goto(`/loos/${loo.id}/remove`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Report a problem with /);
    await page.getByText("It's permanently closed or demolished", { exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Check your report" })).toBeVisible();
    await shot(page, testInfo, "07-report-confirm");
  });

  test("page not found", async ({ page }, testInfo) => {
    const response = await page.goto("/no-such-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
    await shot(page, testInfo, "08-not-found");
  });
});
