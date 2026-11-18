import type { Page } from "@playwright/test";
import { deleteFeedback, type FeedbackRow, getFeedbackContaining } from "./support/db";
import { CLIENT_URL } from "./support/env";
import { expect, test } from "./support/fixtures";

/**
 * The feedback page (/feedback, src/pages/feedback.astro + components/Feedback): a message
 * goes through the client's /api proxy to the server's POST /api/feedback and is stored in
 * public.feedback. "Report a problem → Something else" links to it about one toilet. The
 * form also works with JavaScript off (a plain form post to /feedback).
 */

/** A unique marker per message, so a spec only ever finds (and deletes) its own rows. */
const marker = (label: string) =>
  `[e2e ${process.env.E2E_RUN_ID ?? "local"}] ${label} ${Math.random().toString(36).slice(2, 10)}`;

/** Rows to delete after each test: feedback has no name prefix for the e2e sweep. */
let created: string[] = [];

test.afterEach(async () => {
  const rows = (await Promise.all(created.map((m) => getFeedbackContaining(m)))).flat();
  await deleteFeedback(rows.map((r) => r.id));
  created = [];
});

const stored = async (text: string): Promise<FeedbackRow[]> => {
  await expect.poll(async () => (await getFeedbackContaining(text)).length).toBe(1);
  return getFeedbackContaining(text);
};

const form = (page: Page) => ({
  message: page.getByRole("textbox", { name: "Your message" }),
  email: page.getByRole("textbox", { name: "Email address (optional)" }),
  send: page.getByRole("button", { name: "Send feedback" }),
  thanks: page.getByText("Thank you, your message has been sent"),
  summary: page.getByRole("heading", { name: "There's a problem" }),
});

/** Opens /feedback (optionally ?loo=) and waits for the island to hydrate. */
async function openFeedback(page: Page, query = "") {
  const response = await page.goto(`/feedback${query}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Send us feedback" })).toBeVisible();
  // Hydrated: astro-island drops its ssr attribute once the component has mounted.
  await expect(page.locator("astro-island:has(form[action='/feedback'])")).not.toHaveAttribute(
    "ssr",
    "",
  );
  return form(page);
}

test.describe("feedback", () => {
  test("sends a message through the /api proxy and stores it, with the email", async ({ page }) => {
    const text = marker("feedback page");
    created.push(text);
    const f = await openFeedback(page);

    // How the email is used is said up front.
    await expect(page.getByText(/never shared or posted to our team chat/)).toBeVisible();
    const intro = page.getByText(/Tell us about a problem with the site or the map/);
    await expect(intro).toBeVisible();

    await f.message.fill(`${text}: please add more toilets near the beach`);
    await f.email.fill("e2e-feedback@example.com");
    const post = page.waitForRequest(
      (r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/feedback",
    );
    await f.send.click();
    const request = await post;
    // Same-origin, through the client's proxy.
    expect(new URL(request.url()).origin).toBe(new URL(CLIENT_URL).origin);
    await expect(f.thanks).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to the map" })).toBeVisible();
    // As the no-JavaScript sent page: its own title, and no introduction above the notice.
    await expect(page).toHaveTitle(/^Feedback sent/);
    await expect(intro).toBeHidden();

    const [row] = await stored(text);
    expect(row).toMatchObject({
      feedback_text: `${text}: please add more toilets near the beach`,
      email: "e2e-feedback@example.com",
      route: "/feedback",
    });
  });

  test("checks the message before sending and links the error summary to it", async ({ page }) => {
    const f = await openFeedback(page);
    let posted = false;
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/feedback") posted = true;
    });
    await f.email.fill("not-an-email");
    await f.send.click();
    await expect(f.summary).toBeVisible();
    const summaryBox = page.locator("div[tabindex='-1']", { has: f.summary });
    await expect(summaryBox).toBeFocused();
    await page.getByRole("link", { name: "Enter your message." }).click();
    await expect(f.message).toBeFocused();
    await expect(f.message).toHaveAttribute("aria-invalid", "true");
    await expect(f.email).toHaveAttribute("aria-invalid", "true");
    expect(posted).toBe(false);
  });

  test("'Report a problem → Something else' sends a message about that toilet", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create({}, "feedback about a toilet");
    await page.goto(`/loos/${loo.id}/remove`);
    await expect(page.getByRole("group", { name: "What's wrong with this toilet?" })).toBeVisible();
    await page.getByText("Something else", { exact: true }).click();
    await page.getByRole("link", { name: "Send us a message" }).click();
    await expect(page).toHaveURL(new RegExp(`/feedback\\?loo=${loo.id}$`));

    const f = form(page);
    await expect(page.getByText(`Your message will be about ${loo.name}.`)).toBeVisible();
    await expect(page.getByRole("link", { name: "View the toilet" })).toHaveAttribute(
      "href",
      `/loos/${loo.id}`,
    );
    await expect(page.locator("astro-island:has(form[action='/feedback'])")).not.toHaveAttribute(
      "ssr",
      "",
    );

    const text = marker("about a toilet");
    created.push(text);
    await f.message.fill(`${text}: the sign says it's open 24 hours but it isn't`);
    await f.send.click();
    await expect(f.thanks).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to the toilet" })).toHaveAttribute(
      "href",
      `/loos/${loo.id}`,
    );

    const [row] = await stored(text);
    expect(row).toMatchObject({ route: `/loos/${loo.id}`, email: null });
  });

  test("is linked from the footer", async ({ page }) => {
    await openFeedback(page);
    await expect(
      page.locator("footer").getByRole("link", { name: "Feedback", exact: true }),
    ).toHaveAttribute("href", "/feedback");
  });
});

test.describe("feedback without JavaScript", () => {
  test("the plain form post validates, sends, and shows the thank-you page", async ({
    browser,
  }) => {
    const context = await browser.newContext({ baseURL: CLIENT_URL, javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      await page.goto("/feedback");
      const f = form(page);

      // Empty: the server answers with the form again, the errors and an "Error:" title.
      await f.send.click();
      await expect(f.summary).toBeVisible();
      await expect(page).toHaveTitle(/^Error: /);
      await expect(page.getByRole("link", { name: "Enter your message." })).toHaveAttribute(
        "href",
        "#feedback-text",
      );

      const text = marker("no javascript");
      created.push(text);
      await f.message.fill(`${text}: works without scripts`);
      await f.send.click();
      // Post/redirect/get, so a reload doesn't send it twice.
      await expect(page).toHaveURL(/\/feedback\?sent=1$/);
      await expect(f.thanks).toBeVisible();

      const [row] = await stored(text);
      expect(row).toMatchObject({ route: "/feedback", email: null });
    } finally {
      await context.close();
    }
  });
});
