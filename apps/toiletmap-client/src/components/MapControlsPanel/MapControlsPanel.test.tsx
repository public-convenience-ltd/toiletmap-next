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

const OSM = "Data © OpenStreetMap contributors, ODbL 1.0. https://osm.org/copyright";

/** `/api/geocode` answering with one Nominatim place (with OSM attribution) by default. */
const stubGeocode = (
  results: unknown[] = [{ label: "Leeds, West Yorkshire", lat: 53.8, lng: -1.55, kind: "place" }],
  attribution: string | null = OSM,
) => {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL) => new Response(JSON.stringify({ results, attribution })),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

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
    stubGeocode();
    const user = userEvent.setup();
    setup();
    const input = screen.getByRole("searchbox", { name: "Search for a location" });
    await user.type(input, "Leeds{Enter}");
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
    stubGeocode();
    const user = userEvent.setup();
    setup();
    const input = screen.getByRole("searchbox", { name: "Search for a location" });
    await user.type(input, "Leeds{Enter}");
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

  it("searches places through /api/geocode on Enter (never as you type), crediting OpenStreetMap", async () => {
    const fetchMock = stubGeocode();
    const user = userEvent.setup();
    setup();
    const input = screen.getByRole("searchbox", { name: "Search for a location" });
    await user.type(input, "Leeds");
    // Nominatim forbids autocomplete: typing a place name only says how to search.
    expect(screen.getByRole("status")).toHaveTextContent("Press Enter to search for places.");
    expect(input).toHaveAccessibleDescription("Press Enter to search for places.");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(fetchMock).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("button", { name: "Leeds, West Yorkshire" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["/api/geocode?q=Leeds"]);
    expect(screen.getByRole("link", { name: "OpenStreetMap" })).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/copyright",
    );
  });

  it("searches a short outcode on Enter, without crediting OpenStreetMap for postcodes", async () => {
    const fetchMock = stubGeocode(
      [{ label: "M1, Manchester", lat: 53.48, lng: -2.24, kind: "postcode" }],
      null,
    );
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole("searchbox", { name: "Search for a location" }), "M1");
    expect(fetchMock).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("button", { name: "M1, Manchester" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["/api/geocode?q=M1"]);
    expect(screen.queryByRole("link", { name: "OpenStreetMap" })).toBeNull();
  });

  it("looks a typed postcode up as you type", async () => {
    const fetchMock = stubGeocode(
      [{ label: "SW1A 1AA, Westminster", lat: 51.5, lng: -0.14, kind: "postcode" }],
      null,
    );
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole("searchbox", { name: "Search for a location" }), "SW1A 1AA");
    expect(
      await screen.findByRole("button", { name: "SW1A 1AA, Westminster" }),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/geocode?q=SW1A+1AA&mode=suggest",
    ]);
  });

  it("picks the first result on Enter when results are showing, without searching again", async () => {
    const fetchMock = stubGeocode();
    const map = { setView: vi.fn(), fitBounds: vi.fn() };
    const user = userEvent.setup();
    setup({ mapRef: { current: map as never } });
    const input = screen.getByRole("searchbox", { name: "Search for a location" });
    await user.type(input, "Leeds{Enter}");
    await screen.findByRole("button", { name: "Leeds, West Yorkshire" });
    await user.keyboard("{Enter}");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(map.setView).toHaveBeenCalledWith([53.8, -1.55], 15, { animate: false });
    expect(input).toHaveValue("Leeds, West Yorkshire");
    expect(screen.queryByRole("list", { name: "Location suggestions" })).not.toBeInTheDocument();
  });

  it.each([
    [
      "failed",
      () =>
        vi.stubGlobal(
          "fetch",
          vi.fn(
            async () =>
              new Response(JSON.stringify({ error: "geocoder_unavailable" }), { status: 502 }),
          ),
        ),
      "Place search isn't working right now. Try again in a moment.",
    ],
    ["found nothing", () => stubGeocode([]), "No places found. Try a postcode or street name."],
  ])("says (and announces) when a search %s", async (_label, stub, message) => {
    stub();
    const user = userEvent.setup();
    setup();
    await user.type(
      screen.getByRole("searchbox", { name: "Search for a location" }),
      "Leeds{Enter}",
    );
    expect(await screen.findByRole("status")).toHaveTextContent(message);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
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
