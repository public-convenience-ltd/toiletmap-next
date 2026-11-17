import type { Page } from "@playwright/test";
import { getLoo } from "./support/api";
import { expect, authedTest as test } from "./support/fixtures";
import { jsonBody, nextSave, openEditForm, waitForSaved } from "./support/form";
import { detailsPanel, expandDetails } from "./support/map";

/**
 * The opening hours question (design-system OpeningHoursInput): Don't know / Open 24/7 /
 * Set the hours, presets, per-row Closed / Open / 24 hours, and a live plain-English summary.
 */

function hours(page: Page) {
  const section = page.getByRole("region", { name: "When is it open?" });
  const row = (name: string) => section.getByRole("group", { name, exact: true });
  return {
    section,
    summary: section.getByRole("status").first(),
    choice: (label: "Don't know" | "Open 24/7" | "Set the hours") =>
      section.getByText(label, { exact: true }),
    preset: (label: "Same every day" | "Weekdays + weekends" | "Different each day") =>
      section.getByText(label, { exact: true }),
    row,
    status: (rowName: string, label: "Closed" | "Open" | "24 hours") =>
      row(rowName).getByText(label, { exact: true }),
    opens: (rowName: string) => section.getByLabel(`${rowName} opening time`, { exact: true }),
    closes: (rowName: string) => section.getByLabel(`${rowName} closing time`, { exact: true }),
  };
}

test.describe("opening hours", () => {
  test("Don't know → Set the hours → Weekdays + weekends saves the right openingTimes", async ({
    page,
    loos,
  }) => {
    const loo = await loos.create({}, "hours weekdays");
    expect(loo.openingTimes).toBeNull();
    const form = await openEditForm(page, loo.id);
    const h = hours(page);

    await expect(h.summary).toHaveText("Opening hours not known");
    await expect(h.section.getByRole("radio", { name: "Don't know" })).toBeChecked();

    await h.choice("Set the hours").click();
    await expect(h.summary).toHaveText("Every day 9am–5pm");
    await h.preset("Weekdays + weekends").click();
    await expect(h.row("Monday to Friday")).toBeVisible();
    await expect(h.row("Saturday and Sunday")).toBeVisible();

    await h.opens("Monday to Friday").fill("08:30");
    await h.closes("Monday to Friday").fill("18:00");
    await h.opens("Saturday and Sunday").fill("10:00");
    await h.closes("Saturday and Sunday").fill("16:00");
    await expect(h.summary).toHaveText("Mon–Fri 8:30am–6pm · Sat–Sun 10am–4pm");

    await expect(form.save).toHaveText("Save 1 change");
    const put = nextSave(page, "PUT");
    await form.save.click();
    await expect(form.reviewItems).toHaveCount(1);
    await expect(form.reviewItems.first()).toContainText("Opening hours: Opening hours not known");
    await expect(form.reviewItems.first()).toContainText("Mon–Fri 8:30am–6pm · Sat–Sun 10am–4pm");
    await form.confirm.click();

    const expected = [
      ...Array.from({ length: 5 }, () => ["08:30", "18:00"]),
      ["10:00", "16:00"],
      ["10:00", "16:00"],
    ];
    const body = jsonBody(await put);
    expect(Object.keys(body).sort()).toEqual(["baseUpdatedAt", "openingTimes"]);
    expect(body.openingTimes).toEqual(expected);
    await waitForSaved(page, loo.id);
    expect((await getLoo(loo.id)).openingTimes).toEqual(expected);
    // The details panel reads the saved hours back: a week that isn't the same every day is
    // shown as a Monday-to-Sunday table (in its Details, below the compact summary).
    await expandDetails(page);
    const rows = detailsPanel(page).getByRole("table").getByRole("row");
    await expect(rows).toHaveCount(7);
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    for (const [i, day] of days.entries()) {
      await expect(rows.nth(i).getByRole("rowheader")).toContainText(day);
      await expect(rows.nth(i).getByRole("cell")).toHaveText(i < 5 ? "8:30am–6pm" : "10am–4pm");
    }
  });

  test("a closed weekend and Open 24/7 read back in the summary", async ({ page, loos }) => {
    const loo = await loos.create({}, "hours closed weekend");
    await openEditForm(page, loo.id);
    const h = hours(page);

    await h.choice("Set the hours").click();
    await h.preset("Weekdays + weekends").click();
    await h.status("Saturday and Sunday", "Closed").click();
    await expect(h.opens("Saturday and Sunday")).toHaveCount(0);
    await expect(h.summary).toHaveText("Mon–Fri 9am–5pm · Sat–Sun closed");

    await h.choice("Open 24/7").click();
    await expect(h.summary).toHaveText("Open 24 hours, every day");
    await h.choice("Don't know").click();
    await expect(h.summary).toHaveText("Opening hours not known");
  });

  test("unknown hours stay unknown (null) when another field is edited", async ({ page, loos }) => {
    const loo = await loos.create({ notes: "Old notes" }, "hours stay null");
    const form = await openEditForm(page, loo.id);
    await form.notes.fill("New notes");
    const put = nextSave(page, "PUT");
    await form.submit();
    const body = jsonBody(await put);
    expect(body).not.toHaveProperty("openingTimes");
    await waitForSaved(page, loo.id);

    const after = await getLoo(loo.id);
    expect(after.notes).toBe("New notes");
    expect(after.openingTimes).toBeNull();
  });
});
