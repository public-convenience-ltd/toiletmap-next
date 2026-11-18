import { render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FILTERS } from "../../types/filters";
import MapControlsPanel from "./index";

const setup = (overrides: Partial<Parameters<typeof MapControlsPanel>[0]> = {}) => {
  const props = {
    mapRef: { current: null },
    activeFilters: DEFAULT_FILTERS,
    onFilterChange: vi.fn(),
    onResetFilters: vi.fn(),
    onFindNearMe: vi.fn(),
    ...overrides,
  };
  render(<MapControlsPanel {...props} />);
  return props;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MapControlsPanel", () => {
  it("is marked as covering the map, so the selected marker is kept clear of it", () => {
    setup();
    expect(document.querySelector("search")).toHaveAttribute("data-map-control");
  });

  it("owns Escape only in its search box: the bar's buttons leave it to the map", () => {
    setup();
    const input = screen.getByRole("searchbox", { name: "Search for a location" });
    expect(input.closest("[data-owns-escape]")).not.toBeNull();
    for (const name of ["Find a toilet near me", "Filters"]) {
      expect(screen.getByRole("button", { name }).closest("[data-owns-escape]")).toBeNull();
    }
  });

  it("lets Escape on the bar's buttons through when no suggestions are open", async () => {
    const user = userEvent.setup();
    setup();
    let prevented: boolean | null = null;
    const onKey = (e: KeyboardEvent) => {
      prevented = e.defaultPrevented;
    };
    window.addEventListener("keydown", onKey);
    try {
      screen.getByRole("button", { name: "Filters" }).focus();
      await user.keyboard("{Escape}");
    } finally {
      window.removeEventListener("keydown", onKey);
    }
    expect(prevented).toBe(false);
  });

  it("closes the suggestions on Escape, keeping the query", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              { place_id: 1, display_name: "Leeds, West Yorkshire", lat: "53.8", lon: "-1.55" },
            ]),
          ),
      ),
    );
    const user = userEvent.setup();
    setup();
    const input = screen.getByRole("searchbox", { name: "Search for a location" });
    await user.type(input, "Leeds");
    expect(await screen.findByRole("list", { name: "Location suggestions" })).toBeInTheDocument();

    // Nothing further up (the map's Escape handler) acts on an Escape that closed them.
    let prevented: boolean | null = null;
    const onKey = (e: KeyboardEvent) => {
      prevented = e.defaultPrevented;
    };
    window.addEventListener("keydown", onKey);
    try {
      await user.keyboard("{Escape}");
    } finally {
      window.removeEventListener("keydown", onKey);
    }
    expect(prevented).toBe(true);
    expect(screen.queryByRole("list", { name: "Location suggestions" })).not.toBeInTheDocument();
    expect(input).toHaveValue("Leeds");
  });

  it("closes the suggestions on Escape from a suggestion, moving focus to the search box", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              { place_id: 1, display_name: "Leeds, West Yorkshire", lat: "53.8", lon: "-1.55" },
            ]),
          ),
      ),
    );
    const user = userEvent.setup();
    setup();
    const input = screen.getByRole("searchbox", { name: "Search for a location" });
    await user.type(input, "Leeds");
    const suggestion = await screen.findByRole("button", { name: "Leeds, West Yorkshire" });
    // Outside the search box's own Escape ownership, the bar still keeps this Escape.
    expect(suggestion.closest("[data-owns-escape]")).toBeNull();
    suggestion.focus();

    let prevented: boolean | null = null;
    const onKey = (e: KeyboardEvent) => {
      prevented = e.defaultPrevented;
    };
    window.addEventListener("keydown", onKey);
    try {
      await user.keyboard("{Escape}");
    } finally {
      window.removeEventListener("keydown", onKey);
    }
    expect(prevented).toBe(true);
    expect(screen.queryByRole("list", { name: "Location suggestions" })).not.toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it("asks the map to find the viewer, and shows why it couldn't", async () => {
    const user = userEvent.setup();
    const props = setup({ locationError: "Location access is blocked." });
    await user.click(screen.getByRole("button", { name: "Find a toilet near me" }));
    expect(props.onFindNearMe).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Location access is blocked.");
  });

  it("shows no error by default", () => {
    setup();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("toggles the filters, which the button controls", async () => {
    const user = userEvent.setup();
    const props = setup();
    const button = screen.getByRole("button", { name: "Filters" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    // Collapsed, the panel isn't rendered, so the button doesn't point at a missing id.
    expect(button).not.toHaveAttribute("aria-controls");
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const panelId = button.getAttribute("aria-controls");
    expect(panelId && document.getElementById(panelId)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Accessible/ }));
    expect(props.onFilterChange).toHaveBeenCalledWith("ACCESSIBLE", true);

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).not.toHaveAttribute("aria-controls");
  });

  it("counts active filters in the button's name", () => {
    setup({ activeFilters: { ...DEFAULT_FILTERS, ACCESSIBLE: true, RADAR: true } });
    expect(screen.getByRole("button", { name: "Filters (2 active)" })).toBeInTheDocument();
  });
});
