import { getLoo, issueAccessToken, reportLooViaApi } from "./support/api";
import { getPendingChangesForLoo } from "./support/db";
import { authedTest, expect, untrustedTest } from "./support/fixtures";
import {
  detailsPanelHeading,
  mapCacheHas,
  selectedMarker,
  waitForWarmMapCache,
} from "./support/map";

/**
 * A removed toilet's page explains why it was removed and offers "It's still here — ask to
 * restore" (POST /api/loos/:id/restore): trusted users put it straight back on the map,
 * everyone else's request is queued as a pending_change of type "restore".
 */

const RESTORE_BUTTON = "It's still here — ask to restore";

authedTest.describe("restore a removed toilet (trusted)", () => {
  authedTest(
    "the removed page shows the reason, and restoring puts it back on the map",
    async ({ page, apiToken, loos }) => {
      const loo = await loos.create({}, "restore trusted");
      await reportLooViaApi(apiToken, loo.id, {
        reason: "permanently_closed",
        details: "Demolished for the new library",
      });

      await page.goto(`/loos/${loo.id}`);
      await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
      await expect(
        page.getByText(
          "Removed from the map: Permanently closed or demolished — Demolished for the new library",
        ),
      ).toBeVisible();
      await expect(selectedMarker(page)).toHaveCount(0);
      await waitForWarmMapCache(page);
      expect(await mapCacheHas(page, loo.id)).toBe(false);

      await page.getByRole("button", { name: RESTORE_BUTTON }).click();
      await expect(page.getByRole("heading", { name: "Is it still here?" })).toBeFocused();
      // A trusted restore is applied straight away, so there is no details box to fill in.
      await expect(page.getByLabel("Anything we should know? (optional)")).toHaveCount(0);
      await page.getByRole("button", { name: "Restore it" }).click();

      await expect(page.getByText("Thanks — it's back on the map.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Yes, it's still here" })).toBeVisible();
      await expect(page.getByText(/^Removed from the map/)).toHaveCount(0);

      const after = await getLoo(loo.id);
      expect(after).toMatchObject({ active: true, removalCategory: null, duplicateOf: null });

      // Back in this browser's map cache straight away (the 200 carries `compressed`).
      await expect.poll(() => mapCacheHas(page, loo.id)).toBe(true);
      await page.reload();
      await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
      await expect(selectedMarker(page)).toHaveCount(1);
    },
  );

  authedTest("?restore=1 opens the restore form directly", async ({ page, apiToken, loos }) => {
    const loo = await loos.create({}, "restore deep link");
    await reportLooViaApi(apiToken, loo.id, { reason: "does_not_exist" });
    await page.goto(`/loos/${loo.id}?restore=1`);
    await expect(page.getByRole("heading", { name: "Is it still here?" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/loos/${loo.id}$`));
  });
});

untrustedTest.describe("restore a removed toilet (untrusted)", () => {
  untrustedTest("a signed-in contributor's restore is queued", async ({ page, loos }) => {
    const loo = await loos.create({}, "restore untrusted");
    // The fixture factory signs in as the trusted Test User: remove it as them.
    await reportLooViaApi(await issueAccessToken(), loo.id, { reason: "not_public" });

    await page.goto(`/loos/${loo.id}`);
    await page.getByRole("button", { name: RESTORE_BUTTON }).click();
    await page.getByRole("button", { name: "Restore it" }).click();
    await expect(page.getByText("Thanks — a moderator will review your request.")).toBeVisible();

    const pending = await getPendingChangesForLoo(loo.id);
    for (const row of pending) loos.trackPendingChange(row.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ type: "restore", status: "pending" });
    expect((await getLoo(loo.id)).active).toBe(false);
  });
});
