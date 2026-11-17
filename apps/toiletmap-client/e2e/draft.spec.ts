import { e2eName } from "./support/api";
import { CLIENT_URL } from "./support/env";
import { expect, test } from "./support/fixtures";
import { openEditForm } from "./support/form";

/**
 * A signed-out edit survives signing in: the form keeps a sessionStorage draft, the
 * "Sign in" link carries returnTo, and the callback lands back on the edit page, which
 * restores the draft. Chromium only: WebKit drops the `Secure` auth cookies on
 * http://localhost, so the real sign-in flow can't complete there (see fixtures.ts).
 */
test.describe("drafts across sign-in", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "needs the real sign-in flow");

  test("a signed-out edit is restored on the edit page after signing in", async ({
    page,
    context,
    loos,
  }) => {
    const loo = await loos.create({ notes: "Original" }, "draft");
    const form = await openEditForm(page, loo.id);
    const newName = e2eName("draft renamed");
    await form.name.fill(newName);
    await form.notes.fill("Typed before signing in");

    const signIn = page.getByRole("link", { name: "Sign in", exact: true }).last();
    const href = (await signIn.getAttribute("href")) ?? "";
    const loginUrl = new URL(href, CLIENT_URL);
    expect(loginUrl.pathname).toBe("/auth/login");
    expect(loginUrl.searchParams.get("returnTo")).toBe(`/loos/${loo.id}/edit`);

    await signIn.click();
    await page.getByRole("button", { name: /^Continue as / }).click();
    await page.waitForURL(`${CLIENT_URL}/loos/${loo.id}/edit`);
    expect((await context.cookies(CLIENT_URL)).map((c) => c.name)).toContain("access_token");

    await expect(page.getByText("Restored your unsaved changes.")).toBeVisible();
    await expect(form.name).toHaveValue(newName);
    await expect(form.notes).toHaveValue("Typed before signing in");
    await expect(form.save).toHaveText("Save 2 changes");
    // Signed in now: the save goes live, and there is no "Sign in" prompt.
    await expect(page.getByText("Your change will go live straight away.")).toBeVisible();
    await expect(
      page.getByText("A moderator will check your change before it appears."),
    ).toHaveCount(0);

    // Discard puts the saved values back.
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(form.name).toHaveValue(loo.name ?? "");
    await expect(form.notes).toHaveValue("Original");
    await expect(form.save).toBeDisabled();
  });

  test("login ignores a returnTo that leaves the site", async ({ page }) => {
    for (const bad of ["https://evil.example/", "//evil.example/", "/\\evil.example"]) {
      const res = await page.request.get(`/auth/login?returnTo=${encodeURIComponent(bad)}`, {
        maxRedirects: 0,
      });
      expect(res.status()).toBe(302);
      const cookies = res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie");
      // Nothing to come back to: any old returnTo cookie is cleared, none is set.
      for (const { value } of cookies) expect(value).not.toMatch(/^auth_return_to=(?!deleted;)/);
    }
  });
});
