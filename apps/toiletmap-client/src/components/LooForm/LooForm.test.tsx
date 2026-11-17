import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { LooDetail } from "../../api/loos";
import {
  applyLocalMutation,
  type CompressedLoo,
  clearMapCache,
  loadMapCache,
  resetMapCacheForTests,
  saveSnapshot,
} from "../../api/mapCache";
import LooForm from "./LooForm";

// The real cache module runs (against fake-indexeddb); this spy wraps it so tests can
// assert the read-your-writes call and simulate a cache failure.
vi.mock("../../api/mapCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/mapCache")>();
  return { ...actual, applyLocalMutation: vi.fn(actual.applyLocalMutation) };
});

// The picker's Leaflet map, as handed to LooForm through onMapReady. Address search must
// only ever pan this map; it must never move the toilet's pin.
const pickerMap = vi.hoisted(() => ({
  setView: vi.fn(),
  flyTo: vi.fn(),
  panTo: vi.fn(),
  fitBounds: vi.fn(),
}));

// Leaflet does not run in happy-dom, so the map picker is replaced with a stub
// that can place/move the pin through the same onChange callback.
vi.mock("./LocationPicker", async () => {
  const { useEffect } = await import("preact/hooks");
  return {
    default: function LocationPickerStub({
      location,
      onChange,
      onMapReady,
    }: {
      location: { lat: number; lng: number } | null;
      onChange: (lat: number, lng: number) => void;
      onMapReady?: (map: unknown) => void;
    }) {
      useEffect(() => {
        onMapReady?.(pickerMap);
        return () => onMapReady?.(null);
      }, [onMapReady]);
      return (
        <div data-testid="location-picker">
          <span data-testid="picker-location">
            {location ? `${location.lat},${location.lng}` : "none"}
          </span>
          <button type="button" onClick={() => onChange(51.5074, -0.1278)}>
            Stub: place pin
          </button>
          <button type="button" onClick={() => onChange(51.6, -0.2)}>
            Stub: move pin far
          </button>
        </div>
      );
    },
  };
});

const LOO_ID = "0123456789abcdef01234567";
const BASE_UPDATED_AT = "2026-11-01T10:00:00.000Z";
const NEWER_UPDATED_AT = "2026-11-02T12:30:00.000Z";

const weekHours = (): ([string, string] | [])[] =>
  Array.from({ length: 7 }, () => ["09:00", "17:00"] as [string, string]);

const makeLoo = (overrides: Partial<LooDetail> = {}): LooDetail => ({
  id: LOO_ID,
  name: "High Street toilets",
  location: { lat: 51.501234567, lng: -0.141234567 },
  accessible: true,
  allGender: false,
  men: true,
  women: true,
  children: null,
  babyChange: true,
  radar: false,
  automatic: null,
  noPayment: true,
  paymentDetails: null,
  openingTimes: weekHours(),
  updatedAt: BASE_UPDATED_AT,
  notes: "Closed Sundays",
  active: true,
  removalReason: null,
  ...overrides,
});

/** A row for some other toilet, which a save must never touch. */
const OTHER_ROW: CompressedLoo = ["fffffffffffffffffffffff0", "gcpvj0", 3];

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let fetchMock: Mock<typeof fetch>;
let originalLocation: Location;
let locationStub: { href: string };

beforeEach(async () => {
  for (const spy of Object.values(pickerMap)) spy.mockReset();
  vi.mocked(applyLocalMutation).mockClear();
  await clearMapCache();
  resetMapCacheForTests();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  originalLocation = window.location;
  locationStub = { href: "http://localhost:3000/loos/edit" };
  Object.defineProperty(window, "location", {
    configurable: true,
    value: locationStub,
  });
});

afterEach(async () => {
  // A successful save keeps running after the test's last assertion: it patches the IndexedDB
  // cache (a macrotask in fake-indexeddb) and only then sets window.location.href. Without this
  // wait, that late redirect lands on the *next* test's location stub and fails it at random.
  // "Saving…" stays on the button until the submit handler has fully finished.
  await waitFor(() => expect(screen.queryByText("Saving…")).not.toBeInTheDocument());
  vi.unstubAllGlobals();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

const renderEdit = (loo: LooDetail = makeLoo(), isAuthenticated = true) =>
  render(
    <LooForm
      mode="edit"
      initialData={loo}
      looId={loo.id}
      apiUrl=""
      isAuthenticated={isAuthenticated}
    />,
  );

const renderAdd = () =>
  render(<LooForm mode="add" initialData={null} apiUrl="" isAuthenticated={true} />);

/** The parsed JSON body and init of the n-th fetch call. */
const request = (index = 0) => {
  const [url, init] = fetchMock.mock.calls[index];
  return {
    url: String(url),
    init: init as RequestInit,
    body: JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>,
  };
};

const nameInput = () => screen.getByLabelText(/^Name/) as HTMLInputElement;
const notesInput = () => screen.getByLabelText("Notes") as HTMLTextAreaElement;
const saveButton = () => screen.getByRole("button", { name: /save|no changes|add toilet/i });
const facility = (label: string) => within(screen.getByRole("group", { name: label }));

const changeName = async (user: ReturnType<typeof userEvent.setup>, value: string) => {
  await user.clear(nameInput());
  await user.type(nameInput(), value);
};

const SUGGESTION = {
  place_id: 7,
  display_name: "Trafalgar Square, London",
  lat: "51.508039",
  lon: "-0.128069",
};

/** Answers Nominatim address searches with SUGGESTION and everything else with `api`. */
const routeFetch = (api: () => Response) =>
  fetchMock.mockImplementation(async (input) =>
    String(input).startsWith("https://nominatim.openstreetmap.org/")
      ? jsonResponse(200, [SUGGESTION])
      : api(),
  );

/** Calls made to the toilet API (i.e. not address searches). */
const apiCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/"));

const searchAndChooseSuggestion = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(
    screen.getByLabelText("Search for an address to move the map there"),
    "Trafalgar",
  );
  await user.click(await screen.findByRole("button", { name: SUGGESTION.display_name }));
  expect(screen.queryByRole("button", { name: SUGGESTION.display_name })).toBeNull();
};

const expectPickerPannedToSuggestion = () => {
  expect(pickerMap.setView).toHaveBeenCalledWith([51.508039, -0.128069], 17, { animate: false });
};

const expectNoForbiddenKeys = (body: Record<string, unknown>) => {
  expect(body).not.toHaveProperty("active");
  expect(body).not.toHaveProperty("removalReason");
};

describe("LooForm (edit)", () => {
  it("disables Save until something changes, then sends only the changed field", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, makeLoo({ name: "Market Square toilets" })));
    renderEdit();

    expect(saveButton()).toHaveTextContent("No changes to save");
    expect(saveButton()).toBeDisabled();

    await changeName(user, "Market Square toilets");
    expect(saveButton()).toHaveTextContent("Save 1 change");
    expect(saveButton()).toBeEnabled();

    await user.click(saveButton());

    await waitFor(() => expect(locationStub.href).toBe(`/loos/${LOO_ID}?saved=1`));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init, body } = request();
    expect(url).toBe(`/api/loos/${LOO_ID}`);
    expect(init.method).toBe("PUT");
    expect(body).toEqual({ name: "Market Square toilets", baseUpdatedAt: BASE_UPDATED_AT });
  });

  it("patches the cached map row, marked with the save's updatedAt, after a save", async () => {
    const user = userEvent.setup();
    const cursor = "2026-11-01T09:58:00.000Z";
    await saveSnapshot([[LOO_ID, "gcpuvp", 1], OTHER_ROW], cursor);
    const compressed: CompressedLoo = [LOO_ID, "gcpvhf", 5];
    fetchMock.mockResolvedValue(jsonResponse(200, { ...makeLoo({ name: "New" }), compressed }));
    renderEdit();

    await changeName(user, "New");
    await user.click(saveButton());

    await waitFor(() => expect(locationStub.href).toBe(`/loos/${LOO_ID}?saved=1`));
    expect(applyLocalMutation).toHaveBeenCalledWith(LOO_ID, compressed, BASE_UPDATED_AT);
    const cached = await loadMapCache();
    expect(cached?.data).toEqual([compressed, OTHER_ROW]);
    // A local patch never moves the server cursor, and protects the row from older deltas.
    expect(cached?.cursor).toBe(cursor);
    expect(cached?.patched).toEqual({ [LOO_ID]: BASE_UPDATED_AT });
  });

  it("removes the toilet from the cached map when the save made it inactive", async () => {
    const user = userEvent.setup();
    await saveSnapshot([[LOO_ID, "gcpuvp", 1], OTHER_ROW], "2026-11-01T09:58:00.000Z");
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ...makeLoo({ name: "New", active: false }), compressed: null }),
    );
    renderEdit();

    await changeName(user, "New");
    await user.click(saveButton());

    await waitFor(() => expect(locationStub.href).toBe(`/loos/${LOO_ID}?saved=1`));
    expect(applyLocalMutation).toHaveBeenCalledWith(LOO_ID, null, BASE_UPDATED_AT);
    expect((await loadMapCache())?.data).toEqual([OTHER_ROW]);
  });

  it("leaves the cached map alone when the response has no usable compressed row", async () => {
    const user = userEvent.setup();
    const rows: CompressedLoo[] = [[LOO_ID, "gcpuvp", 1], OTHER_ROW];
    await saveSnapshot(rows, "2026-11-01T09:58:00.000Z");
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, makeLoo({ name: "New" })))
      .mockResolvedValueOnce(
        jsonResponse(200, { ...makeLoo({ name: "New" }), compressed: ["someone-else", "x", 1] }),
      );

    renderEdit();
    await changeName(user, "New");
    await user.click(saveButton());
    await waitFor(() => expect(locationStub.href).toBe(`/loos/${LOO_ID}?saved=1`));

    locationStub.href = "http://localhost:3000/loos/edit";
    await user.click(saveButton());
    await waitFor(() => expect(locationStub.href).toBe(`/loos/${LOO_ID}?saved=1`));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(applyLocalMutation).not.toHaveBeenCalled();
    expect((await loadMapCache())?.data).toEqual(rows);
  });

  it("still opens the toilet's page when the cache can't be updated", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(applyLocalMutation).mockRejectedValueOnce(new Error("QuotaExceededError"));
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ...makeLoo({ name: "New" }), compressed: [LOO_ID, "gcpvhf", 5] }),
    );
    renderEdit();

    await changeName(user, "New");
    await user.click(saveButton());

    await waitFor(() => expect(locationStub.href).toBe(`/loos/${LOO_ID}?saved=1`));
    expect(applyLocalMutation).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("sends only the toggled facility", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, makeLoo({ radar: true })));
    renderEdit();

    await user.click(facility("Radar key").getByLabelText("Yes"));
    expect(saveButton()).toHaveTextContent("Save 1 change");
    await user.click(saveButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(request().body).toEqual({ radar: true, baseUpdatedAt: BASE_UPDATED_AT });
  });

  it("sends null for a toilet facility set back to Unknown", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, makeLoo({ accessible: null })));
    renderEdit();

    await user.click(facility("Accessible").getByLabelText("Unknown"));
    await user.click(saveButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(request().body).toEqual({ accessible: null, baseUpdatedAt: BASE_UPDATED_AT });
  });

  it("sends notes: null when the notes are cleared", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, makeLoo({ notes: null })));
    renderEdit();

    await user.clear(notesInput());
    await user.click(saveButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(request().body).toEqual({ notes: null, baseUpdatedAt: BASE_UPDATED_AT });
  });

  it("does not send openingTimes for a toilet with unknown hours when only the name changes", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(200, makeLoo({ openingTimes: null, name: "Renamed" })),
    );
    renderEdit(makeLoo({ openingTimes: null }));

    expect(screen.getByRole("radio", { name: "Don't know" })).toBeChecked();
    await changeName(user, "Renamed");
    await user.click(saveButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { body } = request();
    expect(body).not.toHaveProperty("openingTimes");
    expect(body).toEqual({ name: "Renamed", baseUpdatedAt: BASE_UPDATED_AT });
  });

  it("sends a moved pin as the new location", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, makeLoo({ location: { lat: 51.6, lng: -0.2 } })));
    renderEdit();

    await user.click(screen.getByRole("button", { name: "Stub: move pin far" }));
    await user.click(saveButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(request().body).toEqual({
      location: { lat: 51.6, lng: -0.2 },
      baseUpdatedAt: BASE_UPDATED_AT,
    });
  });

  it("on 409 lists the conflicting fields and resubmits the user's change against the latest version", async () => {
    const user = userEvent.setup();
    const current = makeLoo({
      name: "Renamed by someone else",
      notes: "Open Sundays since June",
      updatedAt: NEWER_UPDATED_AT,
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(409, { error: "conflict", current }))
      .mockResolvedValueOnce(
        jsonResponse(200, { ...current, notes: "Closed Sundays, key at café" }),
      );
    renderEdit();

    await user.clear(notesInput());
    await user.type(notesInput(), "Closed Sundays, key at café");
    await user.click(saveButton());

    const banner = await screen.findByText(
      "This toilet was changed by someone else while you were editing.",
    );
    const alert = banner.closest('[role="alert"]') as HTMLElement;
    expect(alert).not.toBeNull();
    const listed = within(alert)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(listed).toEqual(["Notes"]);
    expect(locationStub.href).toBe("http://localhost:3000/loos/edit");

    await user.click(screen.getByRole("button", { name: "Load latest and keep my changes" }));

    expect(
      screen.queryByText("This toilet was changed by someone else while you were editing."),
    ).not.toBeInTheDocument();
    // The other person's name change is now the baseline; the user's notes are kept.
    expect(nameInput()).toHaveValue("Renamed by someone else");
    expect(notesInput()).toHaveValue("Closed Sundays, key at café");
    expect(saveButton()).toHaveTextContent("Save 1 change");

    await user.click(saveButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(request(0).body).toEqual({
      notes: "Closed Sundays, key at café",
      baseUpdatedAt: BASE_UPDATED_AT,
    });
    expect(request(1).body).toEqual({
      notes: "Closed Sundays, key at café",
      baseUpdatedAt: NEWER_UPDATED_AT,
    });
    await waitFor(() => expect(locationStub.href).toBe(`/loos/${LOO_ID}?saved=1`));
  });

  it("on 409 with no overlapping fields says the user's changes are unaffected", async () => {
    const user = userEvent.setup();
    const current = makeLoo({ notes: "Changed elsewhere", updatedAt: NEWER_UPDATED_AT });
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { error: "conflict", current }));
    renderEdit();

    await changeName(user, "Mine");
    await user.click(saveButton());

    expect(
      await screen.findByText(
        "None of the fields you changed were affected. Your changes will be kept.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a thank-you screen with a link back to the toilet when the edit is queued (202)", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    renderEdit(makeLoo(), false);

    expect(screen.getByText(/your change will be reviewed before going live/)).toBeInTheDocument();
    await changeName(user, "Queued name");
    await user.click(saveButton());

    expect(await screen.findByText("Thank you!")).toBeInTheDocument();
    expect(screen.getByText(/awaiting review by a moderator/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View this toilet" })).toHaveAttribute(
      "href",
      `/loos/${LOO_ID}`,
    );
    expect(screen.getByRole("link", { name: "Back to map" })).toHaveAttribute("href", "/");
    expect(locationStub.href).toBe("http://localhost:3000/loos/edit");
    // Nothing is live yet, so the map cache is not touched.
    expect(applyLocalMutation).not.toHaveBeenCalled();
  });

  it("shows a message and does not redirect when the server reports nothing changed", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, { queued: false, unchanged: true }));
    renderEdit(makeLoo(), false);

    await changeName(user, "Same as stored");
    await user.click(saveButton());

    expect(
      await screen.findByText(/No changes were needed — this toilet already has these details/),
    ).toBeInTheDocument();
    expect(locationStub.href).toBe("http://localhost:3000/loos/edit");
    expect(locationStub.href).not.toContain("undefined");
  });

  it("asks the user to sign in again on 401", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(401, { message: "Unauthorized" }));
    renderEdit();

    await changeName(user, "Needs auth");
    await user.click(saveButton());

    const link = await screen.findByRole("link", { name: "sign in again" });
    expect(link).toHaveAttribute("href", "/auth/login");
    expect(screen.getByText(/Your sign-in has expired/)).toBeInTheDocument();
    expect(locationStub.href).toBe("http://localhost:3000/loos/edit");
  });

  it("blocks submit and explains why when an opening time is empty", async () => {
    const user = userEvent.setup();
    renderEdit();

    fireEvent.input(screen.getByLabelText("Monday opening time"), { target: { value: "" } });
    expect(saveButton()).toHaveTextContent("Save 1 change");
    await user.click(saveButton());

    expect(
      (await screen.findAllByText("Enter both opening and closing times for Monday.")).length,
    ).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never sends active or removalReason, even for a removed toilet", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, makeLoo()));
    renderEdit(makeLoo({ active: false, removalReason: "Demolished" }));

    await changeName(user, "Back again");
    await user.clear(notesInput());
    await user.type(notesInput(), "Reopened");
    await user.click(facility("Baby change").getByLabelText("No"));
    await user.click(screen.getByRole("radio", { name: "Don't know" }));
    expect(saveButton()).toHaveTextContent("Save 4 changes");
    await user.click(saveButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { body } = request();
    expectNoForbiddenKeys(body);
    expect(body).toEqual({
      name: "Back again",
      notes: "Reopened",
      babyChange: false,
      openingTimes: null,
      baseUpdatedAt: BASE_UPDATED_AT,
    });
  });

  it("calls the same-origin /api proxy with cookies and no Authorization header", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, makeLoo()));
    renderEdit();

    await changeName(user, "Proxy check");
    await user.click(saveButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { url, init } = request();
    expect(url.startsWith("/api/")).toBe(true);
    expect(url).not.toMatch(/^https?:/);
    expect(init.credentials).toBe("same-origin");
    const headers = new Headers(init.headers);
    expect(headers.has("Authorization")).toBe(false);
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});

describe("LooForm address search", () => {
  it("pans the picker map to the chosen address without moving the toilet (edit)", async () => {
    const user = userEvent.setup();
    routeFetch(() => jsonResponse(200, makeLoo({ name: "Renamed" })));
    renderEdit();

    await searchAndChooseSuggestion(user);

    expectPickerPannedToSuggestion();
    expect(screen.getByTestId("picker-location")).toHaveTextContent("51.501234567,-0.141234567");
    expect(screen.getByLabelText("Latitude")).toHaveValue("51.501235");
    expect(saveButton()).toHaveTextContent("No changes to save");
    expect(saveButton()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Reset to original location" })).toBeNull();

    // Saving another change afterwards still leaves the location out of the request.
    await changeName(user, "Renamed");
    expect(saveButton()).toHaveTextContent("Save 1 change");
    await user.click(saveButton());

    await waitFor(() => expect(locationStub.href).toBe(`/loos/${LOO_ID}?saved=1`));
    expect(apiCalls()).toHaveLength(1);
    const body = JSON.parse(String((apiCalls()[0][1] as RequestInit).body));
    expect(body).not.toHaveProperty("location");
    expect(body).toEqual({ name: "Renamed", baseUpdatedAt: BASE_UPDATED_AT });
  });

  it("does not place a pin from the chosen address (add)", async () => {
    const user = userEvent.setup();
    routeFetch(() => jsonResponse(201, makeLoo()));
    renderAdd();

    await searchAndChooseSuggestion(user);

    expectPickerPannedToSuggestion();
    expect(screen.getByTestId("picker-location")).toHaveTextContent("none");
    expect(screen.getByLabelText("Latitude")).toHaveValue("");

    await user.type(nameInput(), "Brand new toilet");
    await user.click(saveButton());

    expect(
      (await screen.findAllByText("Please set the toilet's location on the map.")).length,
    ).toBeGreaterThan(0);
    expect(apiCalls()).toHaveLength(0);
  });
});

describe("LooForm (add)", () => {
  it("requires a location before submitting", async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.type(nameInput(), "Brand new toilet");
    await user.click(saveButton());

    expect(
      (await screen.findAllByText("Please set the toilet's location on the map.")).length,
    ).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a name before submitting", async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.click(screen.getByRole("button", { name: "Stub: place pin" }));
    await user.click(saveButton());

    expect((await screen.findAllByText("Name is required.")).length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the new toilet without baseUpdatedAt or active, then opens its page", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(201, { ...makeLoo(), id: "fedcba9876543210fedcba98" }),
    );
    renderAdd();

    expect(saveButton()).toHaveTextContent("Add toilet");
    await user.type(nameInput(), "Brand new toilet");
    await user.click(screen.getByRole("button", { name: "Stub: place pin" }));
    expect(screen.getByTestId("picker-location")).toHaveTextContent("51.5074,-0.1278");
    expect(screen.getByLabelText("Latitude")).toHaveValue("51.5074");
    await user.click(facility("Accessible").getByLabelText("Yes"));
    await user.click(saveButton());

    await waitFor(() => expect(locationStub.href).toBe("/loos/fedcba9876543210fedcba98?saved=1"));
    const { url, init, body } = request();
    expect(url).toBe("/api/loos");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(body).not.toHaveProperty("baseUpdatedAt");
    expectNoForbiddenKeys(body);
    expect(body).toMatchObject({
      name: "Brand new toilet",
      location: { lat: 51.5074, lng: -0.1278 },
      accessible: true,
      radar: null,
    });
    // Opening hours default to "Don't know", so none are sent.
    expect(body).not.toHaveProperty("openingTimes");
  });

  it("adds the new toilet to the cached map so it shows on the next map load", async () => {
    const user = userEvent.setup();
    const newId = "fedcba9876543210fedcba98";
    const compressed: CompressedLoo = [newId, "gcpvj0", 1];
    await saveSnapshot([OTHER_ROW], "2026-11-01T09:58:00.000Z");
    fetchMock.mockResolvedValue(jsonResponse(201, { ...makeLoo(), id: newId, compressed }));
    renderAdd();

    await user.type(nameInput(), "Brand new toilet");
    await user.click(screen.getByRole("button", { name: "Stub: place pin" }));
    await user.click(saveButton());

    await waitFor(() => expect(locationStub.href).toBe(`/loos/${newId}?saved=1`));
    expect(applyLocalMutation).toHaveBeenCalledWith(newId, compressed, BASE_UPDATED_AT);
    expect((await loadMapCache())?.data).toEqual([OTHER_ROW, compressed]);
  });
});
