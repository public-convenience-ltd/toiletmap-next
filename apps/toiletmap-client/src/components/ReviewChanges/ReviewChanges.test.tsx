import { render, screen, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReviewItem } from "./describeChanges";
import ReviewChanges from "./ReviewChanges";

const ITEMS: ReviewItem[] = [
  { field: "name", label: "Name", from: "Old", to: "New" },
  { field: "location", label: "Location", to: "Moved 23 m north-east" },
];

const renderSheet = (props: Partial<Parameters<typeof ReviewChanges>[0]> = {}) => {
  const onBack = vi.fn();
  const onConfirm = vi.fn();
  render(
    <ReviewChanges
      open
      mode="edit"
      items={ITEMS}
      submitting={false}
      canWriteDirectly
      onBack={onBack}
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { onBack, onConfirm };
};

describe("ReviewChanges", () => {
  it("is a labelled modal dialog listing each change", () => {
    renderSheet();
    const dialog = screen.getByRole("dialog", { name: "Check your changes" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("You're changing 2 things:");
    const lines = within(dialog).getAllByRole("listitem");
    expect(lines.map((li) => li.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "Name: Old → changes to New",
      "Location: Moved 23 m north-east",
    ]);
    // The arrow is decorative; screen readers hear "changes to".
    expect(within(lines[0]).getByText("→")).toHaveAttribute("aria-hidden", "true");
  });

  it("moves focus to its heading on open", () => {
    renderSheet();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Check your changes" }),
    );
  });

  it("calls back and confirm", async () => {
    const user = userEvent.setup();
    const { onBack, onConfirm } = renderSheet();
    await user.click(screen.getByRole("button", { name: "Back to editing" }));
    await user.click(screen.getByRole("button", { name: "Confirm and save" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // aria-disabled (not disabled), so the focused button keeps focus while it saves.
  it("disables both buttons while saving and after saving, and ignores them", async () => {
    const user = userEvent.setup();
    const { onBack, onConfirm } = renderSheet({ submitting: true });
    const saving = screen.getByRole("button", { name: "Saving…" });
    const back = [
      screen.getByRole("button", { name: "Back to editing" }),
      screen.getByRole("button", { name: "Close" }),
    ];
    expect(saving).toHaveAttribute("aria-disabled", "true");
    for (const button of back) expect(button).toHaveAttribute("aria-disabled", "true");
    await user.click(saving);
    for (const button of back) await user.click(button);
    await user.keyboard("{Escape}");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("shows Saved once the save has gone through", () => {
    renderSheet({ saved: true });
    expect(screen.getByRole("button", { name: "Saved" })).toHaveAttribute("aria-disabled", "true");
  });

  it("goes back to editing on Escape", async () => {
    const user = userEvent.setup();
    const { onBack } = renderSheet();
    await user.keyboard("{Escape}");
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("says a moderator will check the change for anyone who can't write directly", () => {
    renderSheet({ canWriteDirectly: false });
    expect(
      screen.getByText("A moderator will check your change before it appears on the map."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/go live/)).toBeNull();
    // It's only queued: the button doesn't say "save".
    expect(screen.getByRole("button", { name: "Send for review" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm and save" })).toBeNull();
  });

  it("says a trusted user's change goes live straight away", () => {
    renderSheet({ canWriteDirectly: true });
    expect(screen.getByText("Your change will go live straight away.")).toBeInTheDocument();
    expect(screen.queryByText(/moderator/)).toBeNull();
    expect(screen.getByRole("button", { name: "Confirm and save" })).toBeInTheDocument();
  });

  it("talks about the new toilet, not a change, when adding", () => {
    renderSheet({ mode: "add", canWriteDirectly: true, items: [] });
    expect(screen.getByText("The toilet will go on the map straight away.")).toBeInTheDocument();
    expect(screen.queryByText(/your change/i)).toBeNull();
  });

  it("has a heading for new toilets", () => {
    renderSheet({ mode: "add", items: [{ field: "name", label: "Name", to: "New" }] });
    expect(screen.getByRole("dialog", { name: "Check the new toilet" })).toBeInTheDocument();
  });

  it("renders nothing while closed", () => {
    renderSheet({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
