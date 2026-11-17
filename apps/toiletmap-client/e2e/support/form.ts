import { expect, type Page, type Request } from "@playwright/test";

/** Locators for the LooForm island (/loos/:id/edit and /loos/add). */
export function looForm(page: Page) {
  const form = page.locator("form").filter({ has: page.getByRole("heading", { level: 1 }) });
  return {
    heading: page.getByRole("heading", { level: 1 }),
    name: page.getByRole("textbox", { name: "Name", exact: true }),
    notes: page.getByRole("textbox", { name: "Notes" }),
    latitude: page.getByLabel("Latitude"),
    longitude: page.getByLabel("Longitude"),
    save: form.locator("button[type=submit]"),
    map: form.locator(".leaflet-container"),
    pin: form.locator(".leaflet-marker-icon"),
    placePin: page.getByRole("button", { name: "Place pin here" }),
    movePinToCentre: page.getByRole("button", { name: "Move pin to centre of map" }),
    resetLocation: page.getByRole("button", { name: "Reset to original location" }),
    /** A Yes / No / Unknown facility toggle, e.g. `facility("Accessible", "Yes")`. */
    facility: (label: string, option: "Yes" | "No" | "Unknown") =>
      page.getByRole("group", { name: label, exact: true }).getByText(option, { exact: true }),
    conflictBanner: page.getByText(
      "This toilet was changed by someone else while you were editing.",
    ),
    loadLatest: page.getByRole("button", { name: "Load latest and keep my changes" }),
  };
}

/** Opens the edit form and waits for the island (and its location map) to hydrate. */
export async function openEditForm(page: Page, id: string) {
  const response = await page.goto(`/loos/${id}/edit`);
  expect(response?.status()).toBe(200);
  const form = looForm(page);
  await expect(form.heading).toHaveText("Edit toilet");
  await expect(form.pin).toBeVisible();
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
