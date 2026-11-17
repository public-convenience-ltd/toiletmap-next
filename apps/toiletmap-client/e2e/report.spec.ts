import type { Page } from "@playwright/test";
import { getLoo, stable } from "./support/api";
import { getPendingChangesForLoo } from "./support/db";
import { authedTest, contributorTest, expect, test } from "./support/fixtures";
import {
  detailsPanelHeading,
  mapCacheHas,
  selectedMarker,
  syncUntil,
  waitForWarmMapCache,
} from "./support/map";

/**
 * "Report a problem" (/loos/:id/remove, src/components/ReportProblem): signed-in users
 * (any permissions, or none) remove a toilet straight away and can Undo; an anonymous report
 * is queued as a pending_change of type "remove" carrying only the report fields.
 */

const report = (page: Page) => ({
  heading: page.getByRole("heading", { level: 1 }),
  reason: (label: string) => page.getByText(label, { exact: true }),
  details: page.getByRole("textbox", { name: /^(What's wrong\?|Anything else we should know\?)/ }),
  continue: page.getByRole("button", { name: "Continue" }),
  reportIt: page.getByRole("button", { name: "Report it" }),
  undo: page.getByRole("button", { name: "Undo" }),
});

const PERMANENTLY_CLOSED = "It's permanently closed or demolished";

/** Opens the report page and waits for the island to hydrate. */
async function openReport(page: Page, id: string) {
  const response = await page.goto(`/loos/${id}/remove`);
  expect(response?.status()).toBe(200);
  const r = report(page);
  await expect(r.heading).toHaveText(/^Report a problem with /);
  await expect(page.getByRole("group", { name: "What's wrong with this toilet?" })).toBeVisible();
  return r;
}

authedTest.describe("report a problem (trusted)", () => {
  authedTest(
    "permanently closed: confirmation, removed at once, gone from this map and another browser's",
    async ({ page, secondEditor: other, loos }) => {
      const loo = await loos.create({}, "report trusted");

      // Both browsers have the toilet in a warm map cache.
      for (const p of [page, other]) {
        await p.goto(`/loos/${loo.id}`);
        await expect(detailsPanelHeading(p)).toHaveText(loo.name ?? "");
        await expect(selectedMarker(p)).toHaveCount(1);
        await waitForWarmMapCache(p);
        expect(await mapCacheHas(p, loo.id)).toBe(true);
      }

      await page.locator(".toilet-panel").getByRole("link", { name: "Report a problem" }).click();
      const r = report(page);
      await expect(r.heading).toHaveText(`Report a problem with ${loo.name}`);
      await r.reason(PERMANENTLY_CLOSED).click();
      await r.details.fill("Knocked down in October");
      await r.continue.click();

      await expect(page.getByRole("heading", { name: "Check your report" })).toBeFocused();
      await expect(page.getByText(PERMANENTLY_CLOSED)).toBeVisible();
      await expect(
        page.getByText(
          `${loo.name} will be removed from the map straight away. You can undo this on the next screen.`,
        ),
      ).toBeVisible();
      const sent = page.waitForRequest(
        (req) => req.method() === "POST" && new URL(req.url()).pathname.endsWith("/report"),
      );
      await r.reportIt.click();
      expect(JSON.parse((await sent).postData() ?? "{}")).toMatchObject({
        reason: "permanently_closed",
        details: "Knocked down in October",
      });
      await expect(page.getByRole("heading", { name: "Removed — thanks." })).toBeVisible();
      await expect(r.undo).toBeVisible();

      const after = await getLoo(loo.id);
      expect(after).toMatchObject({
        active: false,
        removalCategory: "permanently_closed",
        removalReason: "Knocked down in October",
        duplicateOf: null,
      });
      // This browser's map cache dropped the row on the 200, before any sync.
      expect(await mapCacheHas(page, loo.id)).toBe(false);

      // Same session: the map no longer draws it, and its panel says why.
      await page.goto(`/loos/${loo.id}`);
      await expect(
        page.getByText(
          "Removed from the map: Permanently closed or demolished — Knocked down in October",
        ),
      ).toBeVisible();
      await expect(selectedMarker(page)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Yes, it's still here" })).toHaveCount(0);

      // Another browser loses it on its next sync.
      await syncUntil(other, async () => {
        await expect(other.getByText(/removed from the map/i)).toBeVisible({ timeout: 2_000 });
      });
      await expect(selectedMarker(other)).toHaveCount(0);
      expect(await mapCacheHas(other, loo.id)).toBe(false);
    },
  );

  authedTest("Undo straight after reporting puts the toilet back", async ({ page, loos }) => {
    const loo = await loos.create({}, "report undo");
    const before = await getLoo(loo.id);
    const r = await openReport(page, loo.id);
    await r.reason(PERMANENTLY_CLOSED).click();
    await r.continue.click();
    await r.reportIt.click();
    await expect(page.getByRole("heading", { name: "Removed — thanks." })).toBeVisible();
    expect((await getLoo(loo.id)).active).toBe(false);

    await r.undo.click();
    await expect(
      page.getByRole("heading", { name: "Undone — it's back on the map" }),
    ).toBeVisible();
    await expect(page.getByText(`${loo.name} is back on the map.`, { exact: false })).toBeVisible();
    const after = await getLoo(loo.id);
    expect(after).toMatchObject({ active: true, removalCategory: null, duplicateOf: null });
    expect(stable(after, "verifiedAt", "removalReason")).toEqual(
      stable(before, "verifiedAt", "removalReason"),
    );

    await page.goto(`/loos/${loo.id}`);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
    await expect(selectedMarker(page)).toHaveCount(1);
  });
});

test.describe("report a problem (anonymous)", () => {
  test("the report is queued with only the report fields, and the toilet stays", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create({ notes: "Next to the bus station" }, "report anonymous");
    const before = await getLoo(loo.id);
    const r = await openReport(page, loo.id);
    await r.reason(PERMANENTLY_CLOSED).click();
    await r.details.fill("Boarded up");
    await r.continue.click();
    await expect(
      page.getByText(
        `A moderator will check your report before ${loo.name} is removed from the map.`,
      ),
    ).toBeVisible();
    await r.reportIt.click();
    await expect(
      page.getByRole("heading", { name: "Thanks — a moderator will review your report" }),
    ).toBeVisible();

    const pending = await getPendingChangesForLoo(loo.id);
    for (const row of pending) loos.trackPendingChange(row.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ type: "remove", status: "pending" });
    expect(pending[0]?.payload).toEqual({ reason: "permanently_closed", details: "Boarded up" });

    // Untouched until a moderator approves.
    expect(stable(await getLoo(loo.id))).toEqual(stable(before));

    // The panel remembers the suggestion (C5 localStorage marker).
    await page.goto(`/loos/${loo.id}`);
    await expect(
      page.getByText("You suggested a change to this toilet — it's awaiting review."),
    ).toBeVisible();
  });

  test("'Something else' needs details before it can continue", async ({ page, loos }) => {
    const loo = await loos.create({}, "report other");
    const r = await openReport(page, loo.id);
    await r.reason("Something else").click();
    await expect(page.getByRole("textbox", { name: /^What's wrong\?/ })).toBeVisible();
    await r.continue.click();

    await expect(page.getByText("Tell us what's wrong.")).toBeVisible();
    await expect(r.details).toHaveAttribute("aria-invalid", "true");
    await expect(r.details).toBeFocused();
    await expect(page.getByRole("heading", { name: "Check your report" })).toHaveCount(0);

    await r.details.fill("The door is welded shut and the sign says private");
    await r.continue.click();
    await expect(page.getByRole("heading", { name: "Check your report" })).toBeVisible();
    await expect(page.getByText("The door is welded shut and the sign says private")).toBeVisible();
  });
});

contributorTest.describe("report a problem (signed in, no permissions)", () => {
  contributorTest(
    "a contributor with no permissions removes it straight away",
    async ({ page, loos }) => {
      const loo = await loos.create({}, "report contributor");
      const r = await openReport(page, loo.id);
      await r.reason(PERMANENTLY_CLOSED).click();
      await r.continue.click();
      await expect(
        page.getByText(
          `${loo.name} will be removed from the map straight away. You can undo this on the next screen.`,
        ),
      ).toBeVisible();
      await r.reportIt.click();
      await expect(page.getByRole("heading", { name: "Removed — thanks." })).toBeVisible();
      await expect(r.undo).toBeVisible();

      expect(await getPendingChangesForLoo(loo.id)).toHaveLength(0);
      expect(await getLoo(loo.id)).toMatchObject({
        active: false,
        removalCategory: "permanently_closed",
      });
    },
  );
});
