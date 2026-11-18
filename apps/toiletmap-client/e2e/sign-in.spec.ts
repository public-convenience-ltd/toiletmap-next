import { CLIENT_URL } from "./support/env";
import { expect, test } from "./support/fixtures";
import { detailsPanelHeading, waitForMap } from "./support/map";

/**
 * Signing in comes back to the page it started on (returnTo, kept through the Auth0 round
 * trip in a short-lived cookie), and sign-in errors get a proper page.
 */
test.describe("sign-in", () => {
  test("Sign in on a toilet's page comes back to that toilet", async ({
    page,
    browserName,
    loos,
  }) => {
    test.skip(browserName !== "chromium", "needs the real sign-in flow (see fixtures.ts)");
    const loo = await loos.create({}, "return-to");
    await page.goto(`/loos/${loo.id}`);
    await waitForMap(page);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");

    const signIn = page.getByRole("link", { name: "Sign in", exact: true }).first();
    await expect(signIn).toHaveAttribute(
      "href",
      `/auth/login?returnTo=${encodeURIComponent(`/loos/${loo.id}`)}`,
    );
    await signIn.click();
    await page.getByRole("button", { name: /^Continue as / }).click();
    await page.waitForURL(`${CLIENT_URL}/loos/${loo.id}`);
    await expect(page.getByRole("link", { name: "Sign out" }).first()).toBeAttached();
  });

  test("a callback Auth0 refused shows a friendly page, without text from the URL", async ({
    page,
  }) => {
    const response = await page.goto(
      "/auth/callback?error=access_denied&error_description=Call%20this%20number&state=forged",
    );
    expect(response?.status()).toBe(403);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign-in didn't go through");
    await expect(page.getByText("Call this number")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Try signing in again" })).toHaveAttribute(
      "href",
      "/auth/login",
    );
  });

  test("a callback with no sign-in in progress says it expired", async ({ page }) => {
    const response = await page.goto("/auth/callback?code=abc&state=xyz");
    expect(response?.status()).toBe(400);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your sign-in expired");
  });
});
