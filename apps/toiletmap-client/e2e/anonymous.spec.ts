import { getLoo, stable } from "./support/api";
import { getPendingChangesForLoo } from "./support/db";
import { CLIENT_URL } from "./support/env";
import { expect, test } from "./support/fixtures";
import { jsonBody, nextSave, openEditForm } from "./support/form";

/**
 * Logged-out suggestions are queued for moderation (pending_change) instead
 * of being applied, and only the changed field is queued.
 */
test.describe("anonymous edits", () => {
  test("a logged-out edit is queued for review with only the changed field", async ({
    page,
    context,
    loos,
  }) => {
    const loo = await loos.create(
      { notes: "Original notes", accessible: true, noPayment: true },
      "anonymous edit",
    );
    const before = await getLoo(loo.id);

    const form = await openEditForm(page, loo.id);
    expect((await context.cookies()).map((c) => c.name)).not.toContain("access_token");
    await expect(page.getByText("You're not signed in")).toBeVisible();

    await form.notes.fill("Suggested by a passer-by");
    const put = nextSave(page, "PUT");
    await form.save.click();
    const request = await put;
    // Sent to the client's own /api proxy, never straight to toiletmap-server.
    expect(new URL(request.url()).origin).toBe(new URL(CLIENT_URL).origin);
    expect(Object.keys(jsonBody(request)).sort()).toEqual(["baseUpdatedAt", "notes"]);

    await expect(page.getByText("awaiting review by a moderator")).toBeVisible();
    await expect(page.getByRole("link", { name: "View this toilet" })).toHaveAttribute(
      "href",
      `/loos/${loo.id}`,
    );

    const pending = await getPendingChangesForLoo(loo.id);
    for (const row of pending) loos.trackPendingChange(row.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ type: "update", status: "pending" });
    expect(pending[0]?.payload).toEqual({ notes: "Suggested by a passer-by" });
    expect(pending[0]?.base_updated_at?.toISOString()).toBe(before.updatedAt);

    // The toilet itself is untouched until a moderator approves.
    expect(stable(await getLoo(loo.id))).toEqual(stable(before));
  });
});
