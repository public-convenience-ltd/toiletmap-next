import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { openEditForm } from "./support/form";
import { waitForMap } from "./support/map";

type Overflow = {
  clientWidth: number;
  scrollWidth: number;
  /** Elements whose right edge lies past the layout viewport, as short descriptions. */
  offenders: string[];
  /** Scroll containers (`overflow-x: auto | scroll`) whose content is wider than they are. */
  sidewaysScrollers: string[];
};

/**
 * Measures horizontal overflow against the layout viewport
 * (`documentElement.clientWidth`), not `window.innerWidth`: mobile browsers
 * may zoom out to fit wide content, which grows innerWidth along with it.
 *
 * Besides the document's scroll width, every element is checked, so content
 * that sticks out of the page without (yet) making it scrollable is caught too.
 * Skipped: Leaflet's map pane (tiles and markers are positioned off-screen by
 * design), visually-hidden helpers, invisible or empty boxes, and anything
 * inside an ancestor that cuts off horizontal overflow (`overflow-x: hidden`
 * or `clip`, e.g. the map container; that ancestor is itself checked).
 * Content inside a scroll container (`auto` / `scroll`, which is also what
 * `overflow-y: auto` panels compute to) is checked: a panel that scrolls
 * sideways is as bad as a page that does.
 *
 * That ancestor rule skips everything under a clipping element, though, and
 * on some pages (`/`, `/loos/[id]`) `main` itself is `overflow: hidden`. So,
 * separately, every scroll container (computed `overflow-x: auto | scroll`)
 * anywhere on the page whose content is wider than its box is reported as a
 * `sidewaysScroller`, wherever it sits. Leaflet's map (`.leaflet-container`
 * and everything in it) is the only exception.
 */
function measureOverflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const clientWidth = root.clientWidth;

    const isVisuallyHidden = (style: CSSStyleDeclaration, rect: DOMRect) =>
      style.visibility === "hidden" ||
      style.display === "contents" ||
      rect.width <= 1 ||
      rect.height <= 1 ||
      style.clip.startsWith("rect(") ||
      style.clipPath === "inset(50%)";

    const clippedByAncestor = (el: Element) => {
      for (
        let parent = el.parentElement;
        parent && parent !== root;
        parent = parent.parentElement
      ) {
        if (parent === document.body) break;
        const { overflowX } = getComputedStyle(parent);
        if (overflowX === "hidden" || overflowX === "clip") return true;
      }
      return false;
    };

    const describe = (el: Element, right: number) => {
      const id = el.id ? `#${el.id}` : "";
      const classes = [...el.classList].map((c) => `.${c}`).join("");
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `<${el.tagName.toLowerCase()}${id}${classes}> right=${Math.round(right)}px "${text}"`;
    };

    const offenders: string[] = [];
    const sidewaysScrollers: string[] = [];
    for (const el of document.body.querySelectorAll("*")) {
      const style = getComputedStyle(el);
      if (
        (style.overflowX === "auto" || style.overflowX === "scroll") &&
        el.scrollWidth > el.clientWidth + 1 &&
        !el.closest(".leaflet-container")
      ) {
        sidewaysScrollers.push(
          `${describe(el, el.getBoundingClientRect().right)} scrollWidth=${el.scrollWidth}px clientWidth=${el.clientWidth}px`,
        );
      }

      if (el.closest(".leaflet-map-pane")) continue;
      const rect = el.getBoundingClientRect();
      if (rect.right <= clientWidth + 1) continue;
      if (isVisuallyHidden(style, rect)) continue;
      if (clippedByAncestor(el)) continue;
      offenders.push(describe(el, rect.right));
    }

    return {
      clientWidth,
      scrollWidth: document.scrollingElement?.scrollWidth ?? root.scrollWidth,
      offenders,
      sidewaysScrollers,
    };
  });
}

/** No page may scroll sideways or have content sticking out, especially on phones. */
async function expectNoHorizontalOverflow(page: Page) {
  const { clientWidth, scrollWidth, offenders, sidewaysScrollers } = await measureOverflow(page);
  expect(
    scrollWidth,
    `page is ${scrollWidth}px wide in a ${clientWidth}px layout viewport`,
  ).toBeLessThanOrEqual(clientWidth);
  expect(offenders, `elements extend past the ${clientWidth}px layout viewport`).toEqual([]);
  expect(sidewaysScrollers, "scroll containers have content wider than themselves").toEqual([]);
}

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
});
