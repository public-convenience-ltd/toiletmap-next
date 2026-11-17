import { getLoo } from "./support/api";
import { expect, test } from "./support/fixtures";
import { detailsPanelHeading, expandDetails } from "./support/map";

/** "Yes, it's still here" (POST /api/loos/:id/verify) works for anyone and bumps verified_at only. */

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(date);

test.describe("verify", () => {
  test("an anonymous 'Yes, it's still here' updates Last verified", async ({ page, loos }) => {
    const loo = await loos.create({}, "verify anonymous");
    const before = await getLoo(loo.id);
    expect(before.verifiedAt ?? null).toBeNull();

    await page.goto(`/loos/${loo.id}`);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
    // The deep link opens the summary; the verify prompt is in the details.
    await expandDetails(page);
    await expect(page.getByText(/^Last updated: /)).toBeVisible();

    const sent = page.waitForResponse(
      (res) => res.request().method() === "POST" && new URL(res.url()).pathname.endsWith("/verify"),
    );
    await page.getByRole("button", { name: "Yes, it's still here" }).click();
    expect((await sent).status()).toBe(200);
    await expect(page.locator(".toilet-panel").getByRole("status")).toContainText("Thanks!");
    await expect(page.getByText(`Last verified: ${formatDate(new Date())}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Yes, it's still here" })).toHaveCount(0);

    const after = await getLoo(loo.id);
    expect(Date.now() - Date.parse(String(after.verifiedAt))).toBeLessThan(5 * 60_000);
    // Only verified_at moves: the record itself is unchanged.
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.name).toBe(before.name);

    // A fresh load shows the stored date too.
    await page.reload();
    await expandDetails(page);
    await expect(page.getByText(`Last verified: ${formatDate(new Date())}`)).toBeVisible();
  });
});
