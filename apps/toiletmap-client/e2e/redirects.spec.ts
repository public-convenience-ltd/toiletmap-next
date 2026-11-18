import { expect, test } from "./support/fixtures";
import { waitForMap } from "./support/map";

/**
 * Legacy URLs (src/utils/legacyRedirects.ts; the full table is unit-tested in
 * src/utils/legacyRedirects.test.ts). Here: each redirect route really answers in the running
 * app, ahead of the prerendered catch-all page and the /api proxy.
 */
const CASES: [legacy: string, location: string][] = [
  ["/map/-0.1276/51.5072", "/?lat=51.5072&lng=-0.1276&zoom=16"],
  ["/explorer/search", "/dataset"],
  ["/explorer/loos/abc", "/loos/abc"],
  ["/login?returnTo=%2Fabout", "/auth/login?returnTo=%2Fabout"],
  ["/api/auth/login?returnTo=%2F%2Fevil.example", "/auth/login"],
  ["/api/auth/logout", "/auth/logout"],
  ["/api/admin", "/cms/"],
];

test.describe("legacy URLs", () => {
  for (const [legacy, location] of CASES) {
    test(`${legacy} redirects permanently to ${location}`, async ({ request }) => {
      const res = await request.get(legacy, { maxRedirects: 0 });
      expect(res.status()).toBe(301);
      expect(res.headers().location).toBe(location);
    });
  }

  test("a legacy map link opens the map at that spot, then leaves the address bar", async ({
    page,
  }) => {
    const response = await page.goto("/map/-1.5491/53.8008/15?utm_source=old");
    // The redirect's target carried the view (and kept the other parameters).
    expect(new URL(response?.url() ?? "").search).toBe(
      "?lat=53.8008&lng=-1.5491&zoom=15&utm_source=old",
    );
    await waitForMap(page);
    // The link's view is where the map opened, not the remembered or default view.
    const add = page.getByRole("link", { name: /add a toilet here/i }).first();
    await expect(add).toHaveAttribute("href", /lat=53\.8008&lng=-1\.5491/);
    // Once open, the view leaves the address bar (other parameters stay), and a reload
    // opens where the map is: here, as it hasn't moved.
    await expect.poll(() => new URL(page.url()).search).toBe("?utm_source=old");
    await page.reload();
    await waitForMap(page);
    await expect(add).toHaveAttribute("href", /lat=53\.8008&lng=-1\.5491/);
  });
});
