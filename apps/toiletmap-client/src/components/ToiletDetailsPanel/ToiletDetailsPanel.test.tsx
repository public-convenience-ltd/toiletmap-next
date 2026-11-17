import { render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LooDetail } from "../../api/loos";
import ToiletDetailsPanel, { REMOVED_MESSAGE, SAVED_MESSAGE } from "./index";

const toilet: LooDetail = {
  id: "0123456789abcdef01234567",
  name: "High Street toilets",
  location: { lat: 51.5, lng: -0.14 },
  accessible: true,
  allGender: null,
  men: true,
  women: true,
  children: null,
  babyChange: false,
  radar: null,
  automatic: null,
  noPayment: true,
  paymentDetails: null,
  openingTimes: null,
  updatedAt: "2026-11-01T10:00:00.000Z",
  active: true,
};

const noop = () => undefined;
const editLinks = () => screen.queryAllByRole("link", { name: /edit/i });

describe("ToiletDetailsPanel", () => {
  it("renders no notices by default", () => {
    render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
    expect(screen.getByRole("heading", { name: "High Street toilets" })).toBeInTheDocument();
    expect(screen.queryByText(SAVED_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(REMOVED_MESSAGE))).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /directions/i })).toBeInTheDocument();
    expect(editLinks().length).toBeGreaterThan(0);
  });

  it("shows a dismissible saved banner as a status message", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<ToiletDetailsPanel toilet={toilet} onClose={noop} saved onDismissSaved={onDismiss} />);
    const status = screen.getByText(SAVED_MESSAGE).closest('[role="status"]');
    expect(status).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Dismiss message" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows the removed state and hides directions and edit actions", () => {
    render(<ToiletDetailsPanel toilet={toilet} onClose={noop} removed saved />);
    const status = screen.getByText(new RegExp(REMOVED_MESSAGE)).closest('[role="status"]');
    expect(status).not.toBeNull();
    // The saved banner is superseded by the removed state.
    expect(screen.queryByText(SAVED_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /directions/i })).not.toBeInTheDocument();
    expect(editLinks()).toHaveLength(0);
    expect(screen.queryByText("Is this information correct?")).not.toBeInTheDocument();
    // Still closable.
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("renders a custom notice slot", () => {
    render(<ToiletDetailsPanel toilet={toilet} onClose={noop} notice={<p>Custom notice</p>} />);
    expect(screen.getByText("Custom notice")).toBeInTheDocument();
  });
});
