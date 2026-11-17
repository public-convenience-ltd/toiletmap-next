import { render, screen, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";
import Dialog from "./Dialog";
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

  it("disables both buttons while saving and after saving", () => {
    renderSheet({ submitting: true });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back to editing" })).toBeDisabled();
  });

  it("shows Saved once the save has gone through", () => {
    renderSheet({ saved: true });
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
  });

  it("says a moderator will check the change for anyone who can't write directly", () => {
    renderSheet({ canWriteDirectly: false });
    expect(
      screen.getByText("A moderator will check your change before it appears on the map."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/go live/)).toBeNull();
  });

  it("says a trusted user's change goes live straight away", () => {
    renderSheet({ canWriteDirectly: true });
    expect(screen.getByText("Your change will go live straight away.")).toBeInTheDocument();
    expect(screen.queryByText(/moderator/)).toBeNull();
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

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog
        open={open}
        labelledBy="t"
        onDismiss={() => setOpen(false)}
        initialFocus="[data-first]"
      >
        <h2 id="t">Title</h2>
        <button type="button" data-first>
          First
        </button>
        <button type="button">Last</button>
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("traps Tab inside, closes on Escape and restores focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Last" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Last" }));

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
