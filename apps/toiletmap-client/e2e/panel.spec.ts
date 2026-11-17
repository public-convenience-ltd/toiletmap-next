import type { Locator, Page, TestInfo } from "@playwright/test";
import type { OpeningTimes } from "./support/api";
import { expect, test } from "./support/fixtures";
import { expectNoHorizontalOverflow } from "./support/layout";
import {
  collapseDetails,
  deepLinkSpot,
  detailsPanel,
  detailsPanelHeading,
  detailsToggle,
  expandDetails,
  expectDetailsExpanded,
  selectedMarker,
  waitForMap,
  waitForMapToSettle,
} from "./support/map";

/**
 * Phase 4: the details panel. A marker tap (or a /loos/:id deep link) opens it expanded: the
 * summary with the details below; "Details" (or the sheet's handle) collapses it to the
 * summary and expands it again. Below 768px it is a non-modal bottom sheet (expanded ≤ 60% of
 * the map, scrolling inside; collapsed, the summary ≤ 30% of the screen); from 768px a card of
 * at most 400px on the left, below the search bar. Either way the selected marker is kept
 * clear of the panel and the floating map controls.
 */

type Box = { x: number; y: number; width: number; height: number };

const OPEN_ALL_DAY: OpeningTimes = Array.from({ length: 7 }, () => ["00:00", "00:00"]);
/** Weekdays 9–5, weekends 10–4: not one sentence, so the details show a week table. */
const WEEKDAYS_AND_WEEKENDS: OpeningTimes = [
  ...Array.from({ length: 5 }, (): [string, string] => ["09:00", "17:00"]),
  ["10:00", "16:00"],
  ["10:00", "16:00"],
];
const LONG_NOTES = Array.from(
  { length: 8 },
  (_, i) => `Line ${i + 1}: the entrance is round the back, past the bike racks and the café.`,
).join("\n");

/** Below 768px the panel is a bottom sheet (ToiletDetailsPanel usePanelMode). */
const isSheet = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;
/** A phone on its side: the card, on a screen ≤560px tall (it then scrolls as a whole). */
const isShortCard = (page: Page) => {
  const { width, height } = page.viewportSize() ?? { width: 1280, height: 720 };
  return width >= 768 && height <= 560;
};

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The box of a locator once it has stopped moving (the sheet slides in, the card fades). */
async function settledBox(locator: Locator): Promise<Box> {
  let last: Box | null = null;
  let box: Box | null = null;
  await expect
    .poll(
      async () => {
        last = box;
        box = await locator.boundingBox();
        return (
          !!box &&
          !!last &&
          Math.abs(box.y - last.y) < 0.5 &&
          Math.abs(box.height - last.height) < 0.5 &&
          Math.abs(box.x - last.x) < 0.5
        );
      },
      { intervals: [100], message: "the panel should stop moving" },
    )
    .toBe(true);
  return box as unknown as Box;
}

interface Occlusion {
  marker: Box | null;
  map: Box;
  /** Everything floating over the map: the panel and each visible map control. */
  covers: { what: string; box: Box }[];
}

/** Measures the selected marker against the panel and the floating map controls. */
function measureOcclusion(page: Page): Promise<Occlusion> {
  return page.evaluate(() => {
    const toBox = (r: DOMRect) => ({ x: r.left, y: r.top, width: r.width, height: r.height });
    const svg = document.querySelector("#map .loo-marker svg[height='44']");
    const map = document.querySelector("#map");
    if (!map) throw new Error("no map");
    const covers: { what: string; box: { x: number; y: number; width: number; height: number } }[] =
      [];
    const candidates = [
      ...document.querySelectorAll(".toilet-panel, [data-map-control], .map-chrome-top > *"),
    ];
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      // Empty or visually hidden (the freshness notice when there is none).
      if (r.width <= 1 || r.height <= 1) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      covers.push({
        what: `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`,
        box: toBox(r),
      });
    }
    return {
      marker: svg ? toBox(svg.getBoundingClientRect()) : null,
      map: toBox(map.getBoundingClientRect()),
      covers,
    };
  });
}

/**
 * The selected marker is drawn inside the map and its box touches neither the panel nor any
 * floating control. Retried until the map has finished panning (a reveal follows the panel's
 * layout report, which arrives after it renders).
 */
async function expectSelectedMarkerClear(page: Page, when: string) {
  await expect(async () => {
    await waitForMapToSettle(page.locator("#map"));
    const { marker, map, covers } = await measureOcclusion(page);
    expect(marker, `${when}: the selected marker is drawn`).not.toBeNull();
    const m = marker as Box;
    expect(m.y, `${when}: marker inside the map (top)`).toBeGreaterThanOrEqual(map.y);
    expect(m.x, `${when}: marker inside the map (left)`).toBeGreaterThanOrEqual(map.x);
    expect(m.x + m.width, `${when}: marker inside the map (right)`).toBeLessThanOrEqual(
      map.x + map.width,
    );
    expect(m.y + m.height, `${when}: marker inside the map (bottom)`).toBeLessThanOrEqual(
      map.y + map.height,
    );
    const hidden = covers.filter((c) => intersects(m, c.box)).map((c) => c.what);
    expect(hidden, `${when}: the selected marker is covered by`).toEqual([]);
  }).toPass({ timeout: 10_000, intervals: [200, 400, 800] });
}

/**
 * Drags the map by (dx, dy) from `from`, waiting for Leaflet's inertia to die down first. A
 * drag that would take the pointer off the map (and possibly off the screen) is made as a few
 * shorter drags from the same point: on a phone a deep-linked marker sits above the expanded
 * sheet, high on the map, so dragging it down to the bottom edge is a long way.
 */
async function dragMap(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  const map = (await page.locator("#map").boundingBox()) as Box;
  const inMap = (x: number, y: number) =>
    x >= map.x + 8 && x <= map.x + map.width - 8 && y >= map.y + 8 && y <= map.y + map.height - 8;
  let pieces = 1;
  while (pieces < 4 && !inMap(from.x + dx / pieces, from.y + dy / pieces)) pieces += 1;
  for (let i = 0; i < pieces; i += 1) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx / pieces, from.y + dy / pieces, { steps: 10 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await waitForMapToSettle(page.locator("#map"));
  }
}

/** Taps (touch projects) or clicks a locator: a real hit-tested user action. */
async function tapOrClick(locator: Locator, testInfo: TestInfo) {
  if (testInfo.project.use.hasTouch) await locator.tap();
  else await locator.click();
}

/** The plain (not selected) marker whose tip is at `tip`. */
async function markerWithTipAt(page: Page, tip: { x: number; y: number }): Promise<Locator> {
  const markers = page.locator("#map .loo-marker");
  let index = -1;
  await expect
    .poll(async () => {
      index = await markers.evaluateAll(
        (elements, t) =>
          elements.findIndex((el) => {
            const r = el.getBoundingClientRect();
            return Math.abs(r.left + r.width / 2 - t.x) < 3 && Math.abs(r.bottom - t.y) < 3;
          }),
        tip,
      );
      return index;
    })
    .toBeGreaterThanOrEqual(0);
  return markers.nth(index);
}

/**
 * The scroll container holding the expanded details: the sheet's body, the card's body, or
 * on a short (landscape phone) screen the card itself, which then scrolls as a whole.
 */
const panelScroller = (page: Page) =>
  isShortCard(page)
    ? detailsPanel(page)
    : detailsPanel(page).locator(".bottom-sheet__body, [class*='cardBody']").first();

/** The expanded details (what the "Details" toggle controls), without the summary above. */
async function detailsRegion(page: Page): Promise<Locator> {
  const id = await detailsToggle(page).getAttribute("aria-controls");
  expect(id, "the expanded Details toggle names what it controls").toBeTruthy();
  return page.locator(`[id="${id}"]`);
}

test.describe("details panel", () => {
  test("a marker tap opens the panel expanded, with the marker in view and the map still usable", async ({
    page,
    loos,
  }, testInfo) => {
    const loo = await loos.create(
      { location: deepLinkSpot(), openingTimes: OPEN_ALL_DAY, accessible: true },
      "panel tap",
    );
    await page.goto(`/loos/${loo.id}`);
    await waitForMap(page);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
    await expectSelectedMarkerClear(page, "deep link");

    // Close it, then move the toilet to where the panel will open (the bottom of a phone,
    // the left of a desktop), so the tap has to bring the marker back into view. Both icons
    // are anchored at the pin's tip, so the plain marker's tip is where the selected one's was.
    const before = (await selectedMarker(page).boundingBox()) as Box;
    const tip = { x: before.x + before.width / 2, y: before.y + before.height };
    await detailsPanel(page).getByRole("button", { name: "Close", exact: true }).click();
    await expect(detailsPanel(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
    await markerWithTipAt(page, tip);
    const map = (await page.locator("#map").boundingBox()) as Box;
    const target = isSheet(page)
      ? { x: map.x + map.width / 2, y: map.y + map.height - 40 }
      : { x: map.x + 140, y: map.y + map.height / 2 };
    const grab = { x: map.x + map.width / 2 + 70, y: map.y + map.height / 2 + 30 };
    await dragMap(page, grab, target.x - tip.x, target.y - tip.y);
    const moved = await markerWithTipAt(page, {
      x: tip.x + (target.x - tip.x),
      y: tip.y + (target.y - tip.y),
    });

    await tapOrClick(moved, testInfo);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
    await expect(page).toHaveURL(new RegExp(`/loos/${loo.id}$`));
    // Focus goes to the heading, which names the region.
    await expect(detailsPanelHeading(page)).toBeFocused();
    await expect(page.getByRole("region", { name: loo.name ?? "" })).toBeVisible();

    // Expanded: the summary (open-now chip, key features, Directions, an expanded Details
    // toggle) with the details below it.
    await expect(detailsPanel(page).getByTestId("open-now")).toHaveText("Open 24 hours");
    await expect(detailsPanel(page).getByRole("list", { name: "Key features" })).toBeVisible();
    await expectDetailsExpanded(page);
    await expect(page.getByRole("button", { name: "Yes, it's still here" })).toHaveCount(1);

    const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
    const panel = await settledBox(detailsPanel(page));
    if (isSheet(page)) {
      expect(panel.height, "the expanded sheet is capped at 60% of the map").toBeLessThanOrEqual(
        map.height * 0.6 + 1,
      );
      expect(Math.round(panel.y + panel.height)).toBe(Math.round(map.y + map.height));
    }
    // The marker is panned clear of the expanded panel from the start.
    await expectSelectedMarkerClear(page, "after the tap");

    // The map stays usable around the panel: the free area is the map, and drags pan it.
    const search = (await page.locator("search").boundingBox()) as Box;
    const free = { x: map.x + 30, y: (search.y + search.height + panel.y) / 2 };
    if (!isSheet(page)) free.x = panel.x + panel.width + 40;
    const hit = await page.evaluate(
      ({ x, y }) => !!document.elementFromPoint(x, y)?.closest("#map"),
      free,
    );
    expect(hit, "the map is uncovered beside the panel").toBe(true);
    const pane = page.locator("#map .leaflet-map-pane");
    const transform = await pane.evaluate((el) => (el as HTMLElement).style.transform);
    await dragMap(page, free, 0, 40);
    await expect
      .poll(() => pane.evaluate((el) => (el as HTMLElement).style.transform))
      .not.toBe(transform);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
    await expectDetailsExpanded(page);

    // Collapsing (the sheet's handle on a phone, Details on the card) leaves the summary alone.
    if (isSheet(page)) {
      const handle = detailsPanel(page).getByRole("button", { name: "Toilet details" });
      await expect(handle).toHaveAttribute("aria-expanded", "true");
      await tapOrClick(handle, testInfo);
      await expect(handle).toHaveAttribute("aria-expanded", "false");
      await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "false");
    } else {
      await collapseDetails(page);
    }
    await expect(page.getByRole("button", { name: "Yes, it's still here" })).toHaveCount(0);
    const summary = await settledBox(detailsPanel(page));
    if (isSheet(page)) {
      expect(
        summary.height,
        "the summary sheet takes at most 30% of the screen",
      ).toBeLessThanOrEqual(viewport.height * 0.3);
      expect(Math.round(summary.y + summary.height)).toBe(Math.round(map.y + map.height));
    }
    await expectSelectedMarkerClear(page, "collapsed");

    // And Details expands it again.
    await expandDetails(page);
    await expect(page.getByRole("button", { name: "Yes, it's still here" })).toHaveCount(1);
    await expectSelectedMarkerClear(page, "expanded again");
  });

  test("the panel opens expanded within the cap and scrolls inside; Escape collapses, then closes; Close closes", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create(
      {
        location: deepLinkSpot(),
        notes: LONG_NOTES,
        openingTimes: WEEKDAYS_AND_WEEKENDS,
        accessible: true,
        babyChange: false,
        noPayment: false,
        paymentDetails: "20p",
      },
      "panel expand",
    );
    await page.goto(`/loos/${loo.id}`);
    await waitForMap(page);
    await expect(detailsPanelHeading(page)).toBeFocused();
    // A deep link opens expanded too, its marker clear of the expanded panel.
    await expectDetailsExpanded(page);
    await expectSelectedMarkerClear(page, "deep link");

    const map = (await page.locator("#map").boundingBox()) as Box;
    const panel = await settledBox(detailsPanel(page));
    if (isSheet(page)) {
      expect(panel.height, "the expanded sheet is capped at 60% of the map").toBeLessThanOrEqual(
        map.height * 0.6 + 1,
      );
    } else {
      // The card stays inside the map, below the search bar.
      expect(panel.y + panel.height).toBeLessThanOrEqual(map.y + map.height);
    }

    // The details scroll inside the panel, not the page.
    const scroller = panelScroller(page);
    const overflow = await scroller.evaluate((el) => ({
      overflowY: getComputedStyle(el).overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(overflow.overflowY).toBe("auto");
    expect(overflow.scrollHeight, "long notes overflow the capped panel").toBeGreaterThan(
      overflow.clientHeight,
    );
    await scroller.evaluate((el) => {
      el.scrollTop = 120;
    });
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0);

    // Scrolled, the header stays put: the name and Close are still on screen, inside the
    // panel, and nothing covers Close (the sheet's summary is sticky; the card's sits above
    // its scroller). A short card scrolls as a whole, header included, by design.
    if (!isShortCard(page)) {
      const close = detailsPanel(page).getByRole("button", { name: "Close", exact: true });
      const scrolledPanel = (await detailsPanel(page).boundingBox()) as Box;
      for (const [what, locator] of [
        ["name", detailsPanelHeading(page)],
        ["Close", close],
      ] as const) {
        await expect(locator, `${what} stays in view while the details scroll`).toBeInViewport();
        const box = (await locator.boundingBox()) as Box;
        expect(box.y, `${what} stays inside the panel`).toBeGreaterThanOrEqual(scrolledPanel.y - 1);
      }
      await close.click({ trial: true });
    }

    // The summary shows the price as text; the details have the facilities (one row each with
    // a yes / no answer, payment as its own row), the unknown ones on one line, the notes and
    // a week table with today's row marked.
    await expect(detailsPanel(page).getByTestId("payment")).toHaveText("Paid: 20p");
    const details = await detailsRegion(page);
    const facility = (label: string) =>
      details.locator("[data-answer]").filter({ has: page.getByText(label, { exact: true }) });
    await expect(facility("Accessible")).toHaveAttribute("data-answer", "yes");
    await expect(facility("Accessible")).toContainText("Yes");
    await expect(facility("Baby changing")).toHaveAttribute("data-answer", "no");
    await expect(facility("Baby changing")).toContainText("No");
    await expect(details.getByText("Paid: 20p", { exact: true })).toBeAttached();
    await expect(details.getByText(/^Not known: .*\bMen\b/)).toBeAttached();
    await expect(details.getByText(/Line 8: the entrance/)).toBeAttached();
    await expect(details.getByRole("row")).toHaveCount(7);
    await expect(details.locator('[aria-current="date"]')).toHaveCount(1);
    await expectSelectedMarkerClear(page, "expanded");

    // Escape inside the panel collapses the details first...
    await detailsToggle(page).focus();
    await page.keyboard.press("Escape");
    await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
    await expect(page).toHaveURL(new RegExp(`/loos/${loo.id}$`));
    // ...and collapsing never sends focus elsewhere: it stays in the panel.
    expect(
      await page.evaluate(() => {
        const active = document.activeElement;
        return !active || active === document.body || !!active.closest(".toilet-panel");
      }),
      "focus is not moved out of the panel",
    ).toBe(true);

    // Escape in the search box belongs to the search box, not the panel.
    await page.getByRole("searchbox", { name: "Search for a location" }).focus();
    await page.keyboard.press("Escape");
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");

    // A second Escape from inside the panel closes it; focus returns to the toilet's marker.
    await detailsPanelHeading(page).focus();
    await page.keyboard.press("Escape");
    await expect(detailsPanel(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
    // The panel hands focus to the map as it closes; the map moves it on to the marker.
    await expect
      .poll(() => page.evaluate(() => !!document.activeElement?.closest(".loo-marker")), {
        message: "focus is back on the marker that opened the panel",
      })
      .toBe(true);

    // Close (the X) closes straight away, even with the details expanded (as it opens).
    await page.goto(`/loos/${loo.id}`);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
    await expectDetailsExpanded(page);
    await detailsPanel(page).getByRole("button", { name: "Close", exact: true }).click();
    await expect(detailsPanel(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
  });

  test("a week with the same hours every day is one sentence, not a table", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create(
      { location: deepLinkSpot(), openingTimes: OPEN_ALL_DAY },
      "panel uniform week",
    );
    await page.goto(`/loos/${loo.id}`);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
    await expectDetailsExpanded(page);
    const details = await detailsRegion(page);
    await expect(details.getByText("Open 24 hours, every day", { exact: true })).toBeVisible();
    await expect(details.getByRole("table")).toHaveCount(0);
    await expect(details.locator('[aria-current="date"]')).toHaveCount(0);
  });

  test("the verify, edit and report actions are reachable in Details", async ({ page, loos }) => {
    const loo = await loos.create({ location: deepLinkSpot(), notes: LONG_NOTES }, "panel actions");
    await page.goto(`/loos/${loo.id}`);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
    // The panel opens expanded: the actions are in its details straight away.
    await expectDetailsExpanded(page);

    const panel = detailsPanel(page);
    const actions = [
      panel.getByRole("button", { name: "Yes, it's still here" }),
      panel.getByRole("link", { name: "Suggest an edit" }),
      panel.getByRole("link", { name: "Report a problem" }),
    ];
    for (const action of actions) {
      await action.scrollIntoViewIfNeeded();
      await expect(action).toBeInViewport();
      // Hit-tested: nothing (the map controls, the sheet's edge) covers it.
      await action.click({ trial: true });
    }
    await expect(actions[1]).toHaveAttribute("href", `/loos/${loo.id}/edit`);
    await expect(actions[2]).toHaveAttribute("href", `/loos/${loo.id}/remove`);
  });

  test("Directions opens walking directions to the toilet in a new tab", async ({
    page,
    loos,
  }, testInfo) => {
    const location = deepLinkSpot();
    const loo = await loos.create({ location }, "panel directions");
    await page.goto(`/loos/${loo.id}`);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");

    const link = detailsPanel(page).getByRole("link", { name: "Directions" });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    const href = new URL((await link.getAttribute("href")) ?? "");
    // Apple Maps on Apple platforms (as the panel decides from the browser), Google elsewhere.
    const apple = await page.evaluate(
      () =>
        /iPhone|iPad|iPod|Macintosh|Mac OS X/i.test(navigator.userAgent) ||
        /^(Mac|iPhone|iPad|iPod)/i.test(navigator.platform),
    );
    if (testInfo.project.name === "mobile-webkit") expect(apple).toBe(true);
    if (apple) {
      expect(`${href.origin}${href.pathname}`).toBe("https://maps.apple.com/");
      expect(href.searchParams.get("daddr")).toBe(`${location.lat},${location.lng}`);
      expect(href.searchParams.get("dirflg")).toBe("w");
    } else {
      expect(`${href.origin}${href.pathname}`).toBe("https://www.google.com/maps/dir/");
      expect(href.searchParams.get("api")).toBe("1");
      expect(href.searchParams.get("destination")).toBe(`${location.lat},${location.lng}`);
      expect(href.searchParams.get("travelmode")).toBe("walking");
    }
  });

  test("on desktop the panel is a card of at most 400px on the left, clear of the search bar", async ({
    page,
    loos,
  }) => {
    test.skip(isSheet(page), "phones get the bottom sheet");
    const loo = await loos.create({ location: deepLinkSpot(), notes: LONG_NOTES }, "panel card");
    await page.goto(`/loos/${loo.id}`);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");

    const map = (await page.locator("#map").boundingBox()) as Box;
    const search = (await page.locator("search").boundingBox()) as Box;
    // It opens expanded; then collapsed to the summary.
    for (const state of ["details", "summary"] as const) {
      if (state === "details") await expectDetailsExpanded(page);
      else await collapseDetails(page);
      const card = await settledBox(detailsPanel(page));
      expect(card.width, `${state}: at most 400px wide`).toBeLessThanOrEqual(400);
      expect(card.x - map.x, `${state}: on the left`).toBeLessThanOrEqual(32);
      expect(card.x + card.width).toBeLessThan(map.x + map.width / 2);
      expect(intersects(card, search), `${state}: clear of the search bar`).toBe(false);
      expect(card.y + card.height).toBeLessThanOrEqual(map.y + map.height);
      await expectSelectedMarkerClear(page, state);
    }
  });
  test("on a landscape phone a toilet with notices keeps Directions reachable and its marker clear", async ({
    page,
    loos,
  }) => {
    test.skip(!isShortCard(page), "a short, wide (landscape phone) screen only");
    const loo = await loos.create(
      { location: deepLinkSpot(), notes: LONG_NOTES, openingTimes: WEEKDAYS_AND_WEEKENDS },
      "panel landscape notices",
    );
    // Two notices above Directions: "your changes are live" (?saved=1) and a pending
    // suggestion remembered in this browser.
    await page.addInitScript(({ key, entry }) => localStorage.setItem(key, entry), {
      key: `toiletmap-pending:${loo.id}`,
      entry: JSON.stringify({ kind: "edit", pendingId: "", at: new Date().toISOString() }),
    });
    await page.goto(`/loos/${loo.id}?saved=1`);
    await waitForMap(page);
    await expect(detailsPanelHeading(page)).toHaveText(loo.name ?? "");
    const panel = detailsPanel(page);
    await expect(panel.getByText("Thanks — your changes are live.")).toBeAttached();
    await expect(panel.getByText(/You suggested a change to this toilet/)).toBeAttached();

    // The card scrolls as a whole on a short screen, so the notices can't push Directions out
    // of reach: scrolled to, it is on screen, inside the card, and nothing covers it.
    expect(await panel.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
    const directions = panel.getByRole("link", { name: "Directions" });
    // It opens expanded; then collapsed to the summary.
    for (const state of ["details", "summary"] as const) {
      if (state === "details") {
        await expectDetailsExpanded(page);
        // The details below don't take its place: scroll to the bottom, then back up to it.
        await panel.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
      } else {
        await collapseDetails(page);
      }
      await directions.scrollIntoViewIfNeeded();
      await expect(directions, `${state}: Directions is on screen`).toBeInViewport();
      const card = (await panel.boundingBox()) as Box;
      const link = (await directions.boundingBox()) as Box;
      expect(link.y, `${state}: Directions is inside the card (top)`).toBeGreaterThanOrEqual(
        card.y - 1,
      );
      expect(
        link.y + link.height,
        `${state}: Directions is inside the card (bottom)`,
      ).toBeLessThanOrEqual(card.y + card.height + 1);
      await directions.click({ trial: true });
      await expectSelectedMarkerClear(page, `landscape ${state}`);
      await expectNoHorizontalOverflow(page);
    }
  });
});
