import type { Page } from "@playwright/test";
import { e2eName } from "./support/api";
import { expect, test } from "./support/fixtures";
import { openEditForm } from "./support/form";
import { expectNoHorizontalOverflow } from "./support/layout";
import {
  collapseDetails,
  detailsToggle,
  expandDetails,
  expectDetailsExpanded,
  waitForMap,
} from "./support/map";

test.describe("layout", () => {
  test("home has no horizontal overflow", async ({ page }) => {
    await page.goto("/");
    await waitForMap(page);
    await expectNoHorizontalOverflow(page);
  });

  test("toilet details have no horizontal overflow", async ({ page, loos }) => {
    const loo = await loos.create(
      {
        notes:
          "A fairly long note that should wrap rather than push the panel wider than the screen.",
      },
      "layout details",
    );
    await page.goto(`/loos/${loo.id}`);
    await expect(page.locator(".toilet-panel h2")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("the edit form has no horizontal overflow", async ({ page, loos }) => {
    const loo = await loos.create({ noPayment: false, paymentDetails: "20p" }, "layout edit");
    await openEditForm(page, loo.id);
    await expectNoHorizontalOverflow(page);
  });

  test("the add form has no horizontal overflow", async ({ page }) => {
    await page.goto("/loos/add");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Add a toilet");
    await expectNoHorizontalOverflow(page);
  });

  test("the edit form with the picker moving and the review sheet open has no horizontal overflow", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create({ noPayment: false, paymentDetails: "20p" }, "layout review");
    const form = await openEditForm(page, loo.id);
    await form.picker.movePin.click();
    await expect(form.picker.useLocation).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await form.picker.cancel.click();

    await page
      .getByRole("region", { name: "When is it open?" })
      .getByText("Set the hours", { exact: true })
      .click();
    await page
      .getByRole("region", { name: "When is it open?" })
      .getByText("Different each day", { exact: true })
      .click();
    await expectNoHorizontalOverflow(page);

    await form.notes.fill(
      "A long note that should wrap inside the review sheet on a narrow phone.",
    );
    await form.save.click();
    await expect(form.review).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("the report page has no horizontal overflow", async ({ page, loos }) => {
    const loo = await loos.create({}, "layout report");
    await page.goto(`/loos/${loo.id}/remove`);
    await expect(page.getByRole("group", { name: "What's wrong with this toilet?" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByText("It's a duplicate of another toilet", { exact: true }).click();
    await expectNoHorizontalOverflow(page);
  });
});

/**
 * Pairs of floating map controls (buttons, links, inputs, the freshness notice) whose boxes
 * overlap. Controls nested in one another (an input inside its bar) are not a pair, and the
 * details panel, which floats above the controls by design, is left out.
 */
function overlappingMapControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector(".loo-map-container");
    if (!root) throw new Error("no map container");
    const describeElement = (el: Element) => {
      const label =
        el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().replace(/\s+/g, " ");
      return `<${el.tagName.toLowerCase()}> "${label.slice(0, 30)}"`;
    };
    const controls = [
      ...root.querySelectorAll("button, a[href], input, select, [role='status']"),
    ].flatMap((el) => {
      if (el.closest("#map, .toilet-panel")) return [];
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (style.visibility === "hidden" || rect.width <= 1 || rect.height <= 1) return [];
      if (!el.checkVisibility()) return [];
      return [{ el, rect }];
    });
    const overlaps: string[] = [];
    for (const [i, a] of controls.entries()) {
      for (const b of controls.slice(i + 1)) {
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const x = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const y = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (x > 0.5 && y > 0.5)
          overlaps.push(`${describeElement(a.el)} × ${describeElement(b.el)}`);
      }
    }
    return overlaps;
  });
}

test.describe("map page layout on phones", () => {
  for (const width of [360, 430]) {
    test(`the floating map controls don't overlap at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await waitForMap(page);
      await expect(page.getByRole("searchbox", { name: "Search for a location" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Add a toilet here" })).toBeVisible();
      expect(await overlappingMapControls(page)).toEqual([]);
    });
  }

  test("the page asks for an unzoomed, edge-to-edge viewport", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      "content",
      "width=device-width, initial-scale=1, viewport-fit=cover",
    );
  });

  test("below 768px map pages hide the footer and list its links in the menu", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create({}, "layout footer");
    await page.setViewportSize({ width: 360, height: 740 });
    for (const path of ["/", `/loos/${loo.id}`]) {
      await page.goto(path);
      await waitForMap(page);
      await expect(page.locator("footer")).toBeHidden();
      // The map runs to the bottom of the screen.
      const map = await page.locator("#map").boundingBox();
      expect(Math.round((map?.y ?? 0) + (map?.height ?? 0)), path).toBe(740);

      const toggle = page.getByRole("button", { name: "Toggle main menu" });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const drawer = page.locator(`[id="${await toggle.getAttribute("aria-controls")}"]`);
      for (const name of ["Privacy Policy", "Dataset", "App", "Support Us"]) {
        await expect(
          drawer.getByRole("link", { name, exact: true }),
          `${path}: ${name}`,
        ).toBeVisible();
      }
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
    }
  });

  test("Escape in the header's menu closes the menu, not the open toilet", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create({}, "layout menu escape");
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/loos/${loo.id}`);
    // A deep link focuses the panel's heading once it opens: wait for that, so it can't take
    // focus back from the menu below.
    await expect(page.locator(".toilet-panel h2")).toBeFocused();

    const toggle = page.getByRole("button", { name: "Toggle main menu" });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const drawer = page.locator(`[id="${await toggle.getAttribute("aria-controls")}"]`);
    const link = drawer.getByRole("link", { name: "Privacy Policy", exact: true });
    await expect(link).toBeVisible();
    await link.focus();
    await expect(link, "Escape is pressed in the header's menu").toBeFocused();
    await page.keyboard.press("Escape");

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".toilet-panel h2")).toBeVisible();
    // Not collapsed either: it is still open expanded, as it opened.
    await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(page).toHaveURL(new RegExp(`/loos/${loo.id}$`));
  });

  test("the home page and a toilet's page have no horizontal overflow at 360px", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create(
      {
        name: e2eName("a toilet with a rather long name that has to wrap on a narrow phone"),
        notes: "Averylongwordwithoutanyspacesthatcouldpushthepanelwiderthanthescreenifitdidnotwrap",
      },
      "layout 360",
    );
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/");
    await waitForMap(page);
    await expectNoHorizontalOverflow(page);

    // Opened expanded, then collapsed to the summary, then expanded again.
    await page.goto(`/loos/${loo.id}`);
    await expect(page.locator(".toilet-panel h2")).toBeVisible();
    await expectDetailsExpanded(page);
    await expectNoHorizontalOverflow(page);
    await collapseDetails(page);
    await expectNoHorizontalOverflow(page);
    await expandDetails(page);
    await expectNoHorizontalOverflow(page);
  });
});

/** How the page shell (body, main) is sized and scrolls, as the browser computed it. */
function pageShell(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) throw new Error("no <main>");
    const body = getComputedStyle(document.body);
    const scroller = document.scrollingElement ?? document.documentElement;
    return {
      bodyOverflowY: body.overflowY,
      bodyHeight: Math.round(document.body.getBoundingClientRect().height),
      mainOverflowY: getComputedStyle(main).overflowY,
      viewportHeight: window.innerHeight,
      documentHeight: scroller.scrollHeight,
    };
  });
}

test.describe("page shell", () => {
  test("map pages fill the visible viewport exactly and never scroll", async ({ page, loos }) => {
    const loo = await loos.create({}, "shell map");
    for (const path of ["/", `/loos/${loo.id}`]) {
      await page.goto(path);
      await waitForMap(page);
      const shell = await pageShell(page);
      expect(shell.bodyOverflowY, path).toBe("hidden");
      expect(shell.bodyHeight, path).toBe(shell.viewportHeight);
      expect(shell.documentHeight, path).toBeLessThanOrEqual(shell.viewportHeight);
    }
  });

  test("form pages scroll the document, not <main>", async ({ page, loos }) => {
    const loo = await loos.create({}, "shell forms");
    // Short enough that every form is taller than the screen.
    await page.setViewportSize({ width: 360, height: 480 });
    const pages: [string, () => Promise<unknown>][] = [
      ["/loos/add", () => expect(page.getByRole("heading", { level: 1 })).toBeVisible()],
      [`/loos/${loo.id}/edit`, () => openEditForm(page, loo.id)],
      [
        `/loos/${loo.id}/remove`,
        () =>
          expect(page.getByRole("group", { name: "What's wrong with this toilet?" })).toBeVisible(),
      ],
    ];
    for (const [path, ready] of pages) {
      if (!path.endsWith("/edit")) await page.goto(path);
      await ready();
      const shell = await pageShell(page);
      expect(shell.bodyOverflowY, path).toBe("visible");
      expect(shell.mainOverflowY, path).toBe("visible");
      expect(shell.bodyHeight, path).toBeGreaterThan(shell.viewportHeight);
      expect(shell.documentHeight, path).toBeGreaterThan(shell.viewportHeight);
      await page.evaluate(() => window.scrollTo(0, 100));
      expect(
        await page.evaluate(() => window.scrollY),
        `${path}: the document scrolls`,
      ).toBeGreaterThan(0);
    }
  });

  test("the dataset page scrolls the document (no export bucket in dev)", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 480 });
    await page.goto("/dataset");
    await expect(page.getByRole("heading", { level: 1, name: "Toilet Data" })).toBeVisible();
    await expect(
      page.getByText("Data downloads are only available on the live site"),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Licence Information" })).toBeVisible();
    const shell = await pageShell(page);
    expect(shell.bodyOverflowY).toBe("visible");
    expect(shell.documentHeight).toBeGreaterThan(shell.viewportHeight);
    await page.evaluate(() => window.scrollTo(0, 100));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });
});

/**
 * Notched phones: the header pads the top safe-area inset and the footer (from 768px) the
 * bottom one, so the map's floating controls must not add them again. Emulation has no
 * insets, so they are stubbed on :root (where the design system defines --safe-*).
 */
test.describe("map controls and the safe-area insets", () => {
  const setInsets = (page: Page, insets: { top?: string; bottom?: string }) =>
    page.evaluate(({ top, bottom }) => {
      const root = document.documentElement.style;
      if (top) root.setProperty("--safe-top", top);
      if (bottom) root.setProperty("--safe-bottom", bottom);
    }, insets);

  /** The search bar's offset below the top of the map, and the Add link's above its bottom. */
  const chromeOffsets = (page: Page) =>
    page.evaluate(() => {
      const map = document.querySelector("#map")?.getBoundingClientRect();
      const search = document
        .querySelector('search[aria-label="Map search and filters"]')
        ?.getBoundingClientRect();
      const add = document.querySelector(".add-toilet-here")?.getBoundingClientRect();
      if (!map || !search || !add) throw new Error("map chrome not found");
      return {
        headerBottom: Math.round(map.top),
        searchFromTop: Math.round(search.top - map.top),
        addFromBottom: Math.round(map.bottom - add.bottom),
      };
    });

  for (const { width, height, footer } of [
    { width: 360, height: 740, footer: false },
    { width: 1024, height: 768, footer: true },
  ]) {
    test(`at ${width}px the insets are counted once`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await waitForMap(page);
      const before = await chromeOffsets(page);

      await setInsets(page, { top: "47px", bottom: "34px" });
      await expect
        .poll(async () => (await chromeOffsets(page)).headerBottom, {
          message: "the header grows by the top inset",
        })
        .toBe(before.headerBottom + 47);
      const after = await chromeOffsets(page);
      // The header has used up the top inset: the bar sits as far below it as before.
      expect(after.searchFromTop).toBe(before.searchFromTop);
      // With the footer showing, it pads the bottom inset; without, the map chrome does.
      expect(after.addFromBottom).toBe(before.addFromBottom + (footer ? 0 : 34));
    });
  }
});
