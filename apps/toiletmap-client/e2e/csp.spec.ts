import type { Page, Response } from "@playwright/test";
import {
  CMS_CSP_ENFORCED,
  CSP_HEADER,
  CSP_REPORT_ONLY_HEADER,
  cmsContentSecurityPolicy,
  crossOriginOpenerPolicy,
  REMOTE_IMAGE_ORIGINS,
  SITE_CSP_ENFORCED,
} from "../src/utils/securityHeaders";
import { expect, authedTest as test } from "./support/fixtures";
import { looForm, openEditForm } from "./support/form";
import { detailsPanelHeading, waitForMap } from "./support/map";

/**
 * Content Security Policy: the main pages render with zero violations (docs/security.md).
 * Report-only violations fire the same `securitypolicyviolation` event as enforced ones, so
 * this spec decides whether the policy can be enforced (SITE_CSP_ENFORCED).
 *
 * Runs against `astro dev`, where every page (prerendered ones too) goes through the
 * middleware, so each response must carry the policy. /cms is a static file: in production
 * its CSP comes from the generated _headers, which `astro dev` doesn't apply, so the test
 * adds that exact policy to the response itself.
 */

interface Violation {
  page: string;
  directive: string;
  blocked: string;
  source: string;
  line: number;
  sample: string;
  disposition: string;
}

declare global {
  interface Window {
    __cspViolations?: Violation[];
  }
}

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const SITE_CSP = SITE_CSP_ENFORCED ? CSP_HEADER : CSP_REPORT_ONLY_HEADER;
const CMS_CSP = CMS_CSP_ENFORCED ? CSP_HEADER : CSP_REPORT_ONLY_HEADER;

/** Collects every violation in every document the page loads (and its frames). */
async function collectViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations?.push({
        page: location.pathname,
        directive: event.effectiveDirective || event.violatedDirective,
        blocked: event.blockedURI,
        source: event.sourceFile,
        line: event.lineNumber,
        sample: event.sample,
        disposition: event.disposition,
      });
    });
  });
}

/** Lets late loads (tiles, lazy chunks, fonts) and the async violation events land. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {
    // Polling (the map's sync) can keep the network busy: the timeout below still applies.
  });
  await page.waitForTimeout(500);
}

async function expectNoViolations(page: Page): Promise<void> {
  await settle(page);
  const violations = await page.evaluate(() => window.__cspViolations ?? []);
  expect(violations, "CSP violations (blocked resources or inline code)").toEqual([]);
}

function expectSitePolicy(response: Response | null): void {
  expect(response, "a document response").not.toBeNull();
  const headers = response?.headers() ?? {};
  const policy = headers[SITE_CSP.toLowerCase()];
  expect(policy, `${SITE_CSP} on ${response?.url()}`).toContain("default-src 'self'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["permissions-policy"]).toContain("geolocation=(self)");
}

test.describe("Content Security Policy", () => {
  test.beforeEach(async ({ page }) => {
    await collectViolations(page);
  });

  test("the map", async ({ page }) => {
    const response = await page.goto("/");
    expectSitePolicy(response);
    await waitForMap(page);
    await page.locator(".leaflet-tile-loaded").first().waitFor();
    await expectNoViolations(page);
  });

  test("a toilet's page", async ({ page, loos }) => {
    const loo = await loos.create({}, "csp");
    const response = await page.goto(`/loos/${loo.id}`);
    expectSitePolicy(response);
    await waitForMap(page);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
    await expectNoViolations(page);
  });

  test("the add form", async ({ page }) => {
    const response = await page.goto("/loos/add?lat=51.5072&lng=-0.1276&zoom=17");
    expectSitePolicy(response);
    await expect(looForm(page).heading).toHaveText("Add a toilet");
    await page.locator(".leaflet-tile-loaded").first().waitFor();
    await expectNoViolations(page);
  });

  test("the edit form", async ({ page, loos }) => {
    const loo = await loos.create({}, "csp-edit");
    await openEditForm(page, loo.id);
    await expectNoViolations(page);
  });

  test("the report page", async ({ page, loos }) => {
    const loo = await loos.create({}, "csp-report");
    const response = await page.goto(`/loos/${loo.id}/remove`);
    expectSitePolicy(response);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoViolations(page);
  });

  test("a content page", async ({ page }) => {
    const response = await page.goto("/about");
    expectSitePolicy(response);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("About the Toilet Map");
    await expectNoViolations(page);
  });

  test("the blog and every post (images, avatars and the inline share script)", async ({
    page,
  }) => {
    // Remote post images are answered locally (no network in tests). The browser checks the
    // CSP before a request is made, so a host img-src doesn't allow is still reported.
    await page.route(
      (url) => (REMOTE_IMAGE_ORIGINS as readonly string[]).includes(url.origin),
      (route) => route.fulfill({ contentType: "image/png", body: ONE_PIXEL_PNG }),
    );
    expectSitePolicy(await page.goto("/posts"));
    await expectNoViolations(page);
    const links = page.locator(".post-list__title a");
    const paths = await links.evaluateAll((anchors) =>
      anchors.map((anchor) => new URL((anchor as HTMLAnchorElement).href).pathname),
    );
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expectSitePolicy(await page.goto(path));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // Every image (post photos, author avatars) loaded: lazy ones are scrolled to first.
      for (const image of await page.locator("main img").all()) {
        await image.scrollIntoViewIfNeeded();
        await expect
          .poll(() => image.evaluate((img) => (img as HTMLImageElement).complete))
          .toBe(true);
      }
      await expectNoViolations(page);
    }
  });

  test("/feedback", async ({ page }) => {
    const response = await page.goto("/feedback");
    expectSitePolicy(response);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Send us feedback");
    await expectNoViolations(page);
  });

  test("the design system kitchen sink", async ({ page }) => {
    const response = await page.goto("/dev/components");
    expectSitePolicy(response);
    await expect(page.locator("main")).toBeVisible();
    await expectNoViolations(page);
  });

  test("a sign-in error page", async ({ page }) => {
    const response = await page.goto("/auth/error?reason=expired");
    expect(response?.status()).toBe(400);
    expectSitePolicy(response);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your sign-in expired");
    await expect(page.getByRole("link", { name: "Try signing in again" })).toHaveAttribute(
      "href",
      "/auth/login",
    );
    await expectNoViolations(page);
  });

  test("/cms, with its production policy", async ({ page }) => {
    await page.route("**/cms/index.html", async (route) => {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers[CSP_HEADER.toLowerCase()];
      delete headers[CSP_REPORT_ONLY_HEADER.toLowerCase()];
      headers[CMS_CSP.toLowerCase()] = cmsContentSecurityPolicy();
      headers["cross-origin-opener-policy"] = crossOriginOpenerPolicy("/cms/") ?? "";
      await route.fulfill({ response, headers });
    });
    await page.goto("/cms/index.html");
    await expect(
      page.getByRole("heading", { level: 1, name: "CMS sign-in isn't configured yet" }),
    ).toBeVisible();
    await expectNoViolations(page);
  });
});
