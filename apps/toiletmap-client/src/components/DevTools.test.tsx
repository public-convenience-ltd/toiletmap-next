import { render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

vi.mock("idb-keyval", () => ({
  entries: vi.fn(async () => []),
  keys: vi.fn(async () => []),
  del: vi.fn(async () => undefined),
}));

import DevTools from "./DevTools";

describe("DevTools", () => {
  it("draws its icons from the design system's sprite, not Font Awesome", async () => {
    const { container } = render(<DevTools isOpen onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Entries:/)).toBeTruthy());
    expect(container.querySelector('[class*="fa-"]')).toBeNull();
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole("button", { name: "Close" }).querySelector("svg")).not.toBeNull();
  });

  it("renders nothing while closed", () => {
    const { container } = render(<DevTools isOpen={false} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});
