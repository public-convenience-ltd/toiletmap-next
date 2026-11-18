import { expect, test } from "./support/fixtures";
import { expectNoHorizontalOverflow } from "./support/layout";

/**
 * Content pages, the blog and the CMS (src/content/, src/pages/[...slug].astro,
 * src/pages/posts/, public/cms/). Also runs on the phone projects (playwright.config.ts).
 */
const PHONE = { width: 390, height: 700 };

test.describe("content pages", () => {
  test("a long content page scrolls on a phone", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/app/privacy");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy Policy - Toilet Map");
    // Not a map page: the document itself scrolls.
    await expect(page.locator("body")).not.toHaveClass(/map-page/);
    const lastHeading = page.getByRole("heading", { name: "10. Contact Us" });
    await expect(lastHeading).not.toBeInViewport();

    // Taller than the screen, and nothing stops the document scrolling.
    const scroll = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      viewport: window.innerHeight,
      overflow: [document.documentElement, document.body].map(
        (el) => getComputedStyle(el).overflowY,
      ),
    }));
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.viewport * 2);
    expect(scroll.overflow).not.toContain("hidden");

    // Scroll the way a visitor would. (Mobile WebKit has no wheel events: scroll directly.)
    await page.mouse.move(PHONE.width / 2, PHONE.height / 2);
    await page.mouse.wheel(0, 600).catch(() => page.evaluate(() => window.scrollBy(0, 600)));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(lastHeading).toBeInViewport();
    await expect(page.locator("footer")).toBeInViewport();
    await expectNoHorizontalOverflow(page);
  });

  test("the about page renders with working downloads", async ({ page, request }) => {
    await page.goto("/about");
    await expect(page).toHaveTitle("About – Toilet Map");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("About the Toilet Map");
    const guide = page.getByRole("link", { name: /volunteer help guide/i });
    const href = await guide.getAttribute("href");
    expect(href).toBe("/Toilet.Map.Volunteer.Help.Guide.pdf");
    const res = await request.get(href ?? "");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("pdf");
  });
});

test.describe("blog", () => {
  test("/posts lists the posts, newest first", async ({ page }) => {
    await page.goto("/posts");
    await expect(page).toHaveTitle("Blog – Toilet Map");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Toilet Map Blog");
    const titles = page.locator(".post-list__title a");
    await expect(titles).toHaveText([
      "Loos in the News",
      "Gender Neutral Toilets on the Toilet Map",
      "Our 2024 (Toilet) Roll of Honour",
    ]);
    await expect(titles.first()).toHaveAttribute("href", "/posts/loos-in-the-news");
    await expectNoHorizontalOverflow(page);
  });

  test("a post renders at its legacy URL", async ({ page }) => {
    await page.goto("/posts/our-2024-toilet-roll-of-honour");
    await expect(page).toHaveTitle("Our 2024 (Toilet) Roll of Honour – Toilet Map");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Our 2024 (Toilet) Roll of Honour",
    );
    await expect(page.getByText(/By Gail and Ollie/)).toBeVisible();
    await expect(page.locator("time").first()).toHaveText("23 December 2024");
    await expect(page.getByRole("heading", { name: "New toilets" })).toBeVisible();
    // Markdown tables render, and wide ones scroll inside themselves rather than the page.
    await expect(page.locator("article table")).toHaveCount(3);
    await expect(page.getByRole("link", { name: "Trafalgar Square" }).first()).toHaveAttribute(
      "href",
      "/loos/9c87f46cef7571c34d4a9f6a",
    );
    await expect(page.getByRole("link", { name: "All blog posts" })).toHaveAttribute(
      "href",
      "/posts",
    );
  });

  test("a post's images come from the legacy upload URLs", async ({ page, request }) => {
    await page.goto("/posts/gender-neutral-toilets-on-the-toilet-map");
    const image = page.locator("article img[src='/images/uploads/img_6413.jpeg']");
    await expect(image).toHaveCount(1);
    expect((await request.get("/images/uploads/img_6413.jpeg")).status()).toBe(200);
  });

  test("an unknown post is the site's 404", async ({ page }) => {
    const res = await page.goto("/posts/no-such-post");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("We can't find that page");
  });
});

test.describe("CMS", () => {
  test("/cms without GitHub OAuth configured says sign-in isn't configured yet", async ({
    page,
  }) => {
    // The dev server serves the folder's index.html by name; the deployed site also at /cms/.
    await page.goto("/cms/index.html");
    await expect(
      page.getByRole("heading", { level: 1, name: "CMS sign-in isn't configured yet" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Open the editor anyway" })).toBeVisible();
    // A way back for anyone who isn't an editor; the setup details are for the owner, folded.
    await expect(page.getByRole("link", { name: "Back to the Toilet Map" })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(page.getByText("For the site owner: turning on GitHub sign-in")).toBeVisible();
    await expect(page.getByText(/GITHUB_OAUTH_CLIENT_SECRET/)).toBeHidden();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
  });

  test("the sign-in endpoints answer 503 until configured", async ({ request }) => {
    const res = await request.get("/api/cms-oauth/auth?provider=github&scope=public_repo", {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(503);
    expect(await res.text()).toContain("CMS sign-in isn&#39;t configured yet");
    const status = await request.get("/api/cms-oauth/status");
    expect(await status.json()).toEqual({ configured: false });
  });
});
