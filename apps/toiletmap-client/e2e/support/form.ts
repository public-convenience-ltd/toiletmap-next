import { expect, type Locator, type Page, type Request } from "@playwright/test";

/** Controls of the location picker (src/components/LooForm/LocationPicker.tsx). */
export function locationPicker(page: Page) {
  return {
    /** The picker's Leaflet map (locked preview or moving). */
    map: page.locator('[aria-roledescription="map"]'),
    movePin: page.getByRole("button", { name: "Move pin", exact: true }),
    useLocation: page.getByRole("button", { name: "Use this location" }),
    cancel: page.getByRole("button", { name: "Cancel", exact: true }).first(),
    reset: page.getByRole("button", { name: "Reset to original location" }),
    /** The picker's own "Zoom in" (next to the notice), not Leaflet's + control. */
    zoomIn: page.locator("button").filter({ hasText: /^Zoom in$/ }),
    zoomNotice: page.getByText("Zoom in closer to place the pin accurately"),
    coordsToggle: page.getByText("Enter coordinates", { exact: true }),
    coords: page.getByRole("textbox", { name: "Latitude, longitude" }),
    showOnMap: page.getByRole("button", { name: "Show on map" }),
    /** "Moved 23 m north-east" (aria-hidden; the status region announces it). */
    chip: page.getByText(/^Moved \d/),
    bigMoveWarning: page.getByText("That's a big move — are you sure this is the same toilet?"),
    addInstead: page.getByRole("link", { name: "Add as a new toilet instead" }),
    /** The duplicate prompt ("There's already a toilet 8 m away: …"). */
    duplicatePrompt: page.getByRole("group", { name: /^There's already a toilet \d+ m away/ }),
    editThatToilet: page.getByRole("button", { name: "Edit that toilet" }),
    differentToilet: page.getByRole("button", { name: "No, this is a different toilet" }),
  };
}

/**
 * Types "lat, lng" into the picker's "Enter coordinates" box and confirms it with
 * "Use this location" (the add form opens in move mode; the edit form needs "Move pin"
 * first, which the coordinate box does not: "Show on map" starts moving by itself).
 */
export async function enterCoordinates(page: Page, target: { lat: number; lng: number }) {
  const picker = locationPicker(page);
  if (!(await picker.coords.isVisible())) await picker.coordsToggle.click();
  await picker.coords.fill(`${target.lat}, ${target.lng}`);
  await picker.coords.press("Enter");
  await expect(picker.useLocation).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(picker.movePin).toBeVisible();
}

/** Locators for the LooForm island (/loos/:id/edit and /loos/add). */
export function looForm(page: Page) {
  const form = page.locator("form").filter({ has: page.getByRole("heading", { level: 1 }) });
  const review = page.getByRole("dialog", { name: /^Check (your changes|the new toilet)$/ });
  const save = form.locator("button[type=submit]");
  const confirm = review.getByRole("button", { name: "Confirm and save" });
  return {
    heading: page.getByRole("heading", { level: 1 }),
    name: page.getByRole("textbox", { name: "What's it called?", exact: true }),
    notes: page.getByRole("textbox", { name: "Anything else people should know?", exact: true }),
    save,
    map: form.locator(".leaflet-container"),
    pin: form.locator(".leaflet-marker-icon"),
    picker: locationPicker(page),
    /**
     * A Yes / No / Don't know question, by its legend, e.g.
     * `facility("Is there a wheelchair-accessible toilet?", "Yes")` or `facility("Baby changing", "No")`.
     */
    facility: (label: string, option: "Yes" | "No" | "Don't know") =>
      page.getByRole("group", { name: label, exact: true }).getByText(option, { exact: true }),
    /** The review sheet every save goes through. */
    review,
    reviewItems: review.getByRole("listitem"),
    confirm,
    backToEditing: review.getByRole("button", { name: "Back to editing" }),
    /** Opens the review sheet and confirms it. Pair with `nextSave` to catch the request. */
    async submit() {
      await save.click();
      await expect(review).toBeVisible();
      await confirm.click();
    },
    conflictBanner: page.getByText(
      "This toilet was changed by someone else while you were editing.",
    ),
    loadLatest: page.getByRole("button", { name: "Load latest and keep my changes" }),
  };
}

export type LooFormLocators = ReturnType<typeof looForm>;

/** Labels of the yes/no questions (the form's legends). */
export const QUESTIONS = {
  accessible: "Is there a wheelchair-accessible toilet?",
  radar: "Does it need a RADAR key?",
  noPayment: "Is it free to use?",
  babyChange: "Baby changing",
  automatic: "Is it an automatic (self-cleaning) toilet?",
  urinalOnly: "Urinal only",
} as const;

/** Opens the edit form and waits for the island (and its locked location preview) to hydrate. */
export async function openEditForm(page: Page, id: string) {
  const response = await page.goto(`/loos/${id}/edit`);
  expect(response?.status()).toBe(200);
  const form = looForm(page);
  await expect(form.heading).toHaveText("Edit toilet");
  await expect(form.pin).toBeVisible();
  await expect(form.picker.movePin).toBeVisible();
  return form;
}

/** Resolves with the next PUT/POST the form sends to the /api proxy. */
export function nextSave(page: Page, method: "PUT" | "POST"): Promise<Request> {
  return page.waitForRequest(
    (req) => req.method() === method && new URL(req.url()).pathname.startsWith("/api/loos"),
  );
}

export const jsonBody = (req: Request): Record<string, unknown> =>
  JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;

/** Banner LooMap shows on `/loos/:id?saved=1` (ToiletDetailsPanel SAVED_MESSAGE). */
export const SAVED_BANNER_TEXT = "Thanks — your changes are live.";

/**
 * Waits for the redirect a successful signed-in save makes, `/loos/<id>?saved=1`,
 * and for the map to consume the param: the "changes are live" banner shows and
 * `?saved=1` is stripped from the address bar. Returns the toilet id (useful
 * after adding a toilet, when the id is not known in advance).
 */
export async function waitForSaved(page: Page, id?: string): Promise<string> {
  const idPattern = id ? id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "[0-9a-f]{24}";
  // Either form: by the time this runs the param may already have been stripped.
  await page.waitForURL(new RegExp(`/loos/(${idPattern})(\\?saved=1)?$`));
  await expect(page.getByText(SAVED_BANNER_TEXT)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/loos/${idPattern}$`));
  return new URL(page.url()).pathname.split("/").pop() ?? "";
}

/** Bounding box of a locator, failing loudly when it has none. */
export async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element has no bounding box");
  return b;
}

/** Drags from one point by an offset, slowly enough that Leaflet applies no inertia. */
export async function drag(
  page: Page,
  from: { x: number; y: number },
  by: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 10 });
  await page.waitForTimeout(200);
  await page.mouse.up();
}
