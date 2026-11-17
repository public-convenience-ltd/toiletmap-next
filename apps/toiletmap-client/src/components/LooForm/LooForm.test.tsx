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
import { draftKey } from "./draft";
import LooForm, { LIVE_STRAIGHT_AWAY, MESSAGES, MODERATOR_WILL_CHECK } from "./LooForm";
import { formStateFromLoo } from "./payload";

const pendingKey = (looId: string) => `toiletmap-pending:${looId}`;

/** Node's own (non-functional) localStorage shadows happy-dom's here, so use a memory one. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => Array.from(map.keys())[index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, String(value));
    },
  };
}

// The real cache module runs (against fake-indexeddb); this spy wraps it so tests can
// assert the read-your-writes call and simulate a cache failure.
vi.mock("../../api/mapCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/mapCache")>();
  return { ...actual, applyLocalMutation: vi.fn(actual.applyLocalMutation) };
});

const OTHER_ID = "fffffffffffffffffffffff1";

// Leaflet does not run in happy-dom, so the map picker is replaced with a stub that drives
// the same callbacks the real picker does (its own behaviour is tested in LocationPicker.test).
const pickerProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
vi.mock("./LocationPicker", () => ({
  default: function LocationPickerStub(props: {
    location: { lat: number; lng: number } | null;
    onChange: (lat: number, lng: number) => void;
    onMovingChange?: (moving: boolean) => void;
    onEditExisting?: (id: string) => void;
    onRestoreExisting?: (id: string) => void;
  }) {
    pickerProps.last = props as unknown as Record<string, unknown>;
    const { location, onChange, onMovingChange, onEditExisting, onRestoreExisting } = props;
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
        <button type="button" onClick={() => onMovingChange?.(true)}>
          Stub: start moving
        </button>
        <button type="button" onClick={() => onEditExisting?.("fffffffffffffffffffffff1")}>
          Stub: edit existing
        </button>
        <button type="button" onClick={() => onRestoreExisting?.("fffffffffffffffffffffff1")}>
          Stub: restore existing
        </button>
      </div>
    );
  },
}));

// The opening-hours widget has its own tests in the design system; here it is a stub that
// drives the same controlled value/onChange contract and mirrors its structure: `id` is on the
// first question's group (the mode radios), and the time inputs come after that group, the
// first invalid one marked `data-first-invalid-for="<id>"`.
vi.mock("toiletmap-design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toiletmap-design-system")>();
  type Hours = ([string, string] | [])[] | null;
  return {
    ...actual,
    OpeningHoursInput: ({
      value,
      onChange,
      error,
      id,
    }: {
      value: Hours;
      onChange: (v: Hours) => void;
      error?: string;
      id?: string;
    }) => (
      <div data-testid="opening-hours">
        <fieldset id={id} tabIndex={id ? -1 : undefined}>
          <legend>When is it open?</legend>
          <label>
            <input type="radio" checked={value === null} onChange={() => onChange(null)} />
            Don't know
          </label>
        </fieldset>
        <button
          type="button"
          onClick={() =>
            onChange(
              (value ?? Array.from({ length: 7 }, () => ["09:00", "17:00"])).map((day, i) =>
                i === 0 ? ["", "17:00"] : day,
              ) as Hours,
            )
          }
        >
          Stub: clear Monday opening
        </button>
        <button
          type="button"
          onClick={() => onChange(Array.from({ length: 7 }, () => ["00:00", "00:00"]) as Hours)}
        >
          Stub: open 24/7
        </button>
        {/* Stands in for the widget's time input, marked invalid alongside the error. */}
        <input
          aria-label="Monday opens"
          aria-invalid={error ? "true" : undefined}
          data-first-invalid-for={error && id ? id : undefined}
        />
        {error && <span>{error}</span>}
      </div>
    ),
  };
});

const LOO_ID = "0123456789abcdef01234567";
const BASE_UPDATED_AT = "2026-11-01T10:00:00.000Z";
const NEWER_UPDATED_AT = "2026-11-02T12:30:00.000Z";
const START_HREF = "http://localhost:3000/loos/edit";

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
  urinalOnly: null,
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
let locationStub: { href: string; pathname: string; search: string };

beforeEach(async () => {
  vi.mocked(applyLocalMutation).mockClear();
  pickerProps.last = null;
  await clearMapCache();
  resetMapCacheForTests();
  sessionStorage.clear();
  vi.stubGlobal("localStorage", memoryStorage());
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  originalLocation = window.location;
  locationStub = { href: START_HREF, pathname: `/loos/${LOO_ID}/edit`, search: "" };
  Object.defineProperty(window, "location", {
    configurable: true,
    value: locationStub,
  });
});

afterEach(async () => {
  // A successful save keeps running after the test's last assertion: it patches the IndexedDB
  // cache (a macrotask in fake-indexeddb) and only then sets window.location.href. Without this
  // wait, that late redirect lands on the *next* test's location stub and fails it at random.
  // "Saving…" stays on the buttons until the submit handler has fully finished.
  await waitFor(() => expect(screen.queryByText("Saving…")).not.toBeInTheDocument());
  vi.unstubAllGlobals();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

const renderEdit = (
  loo: LooDetail = makeLoo(),
  isAuthenticated = true,
  extra: { skipReview?: boolean; canWriteDirectly?: boolean } = {},
) =>
  render(
    <LooForm
      mode="edit"
      initialData={loo}
      looId={loo.id}
      apiUrl=""
      isAuthenticated={isAuthenticated}
      {...extra}
    />,
  );

const renderAdd = (isAuthenticated = true) =>
  render(<LooForm mode="add" initialData={null} apiUrl="" isAuthenticated={isAuthenticated} />);

/** The parsed JSON body and init of the n-th fetch call. */
const request = (index = 0) => {
  const [url, init] = fetchMock.mock.calls[index];
  return {
    url: String(url),
    init: init as RequestInit,
    body: JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>,
  };
};

const nameInput = () =>
  screen.getByRole("textbox", { name: /^What's it called\?/ }) as HTMLInputElement;
const notesInput = () =>
  screen.getByRole("textbox", {
    name: /^Anything else people should know\?/,
  }) as HTMLTextAreaElement;
const saveButton = () => screen.getByRole("button", { name: /^(save|no changes|add toilet)/i });
const facility = (label: string) => within(screen.getByRole("group", { name: label }));
const reviewSheet = () => screen.getByRole("dialog", { name: /^Check / });
const confirmButton = () => screen.getByRole("button", { name: "Confirm and save" });

type User = ReturnType<typeof userEvent.setup>;

const changeName = async (user: User, value: string) => {
  await user.clear(nameInput());
  await user.type(nameInput(), value);
};

/** Save through the review sheet. */
const saveAndConfirm = async (user: User) => {
  await user.click(saveButton());
  await user.click(await screen.findByRole("button", { name: "Confirm and save" }));
};

/** Text of each line of the review sheet. */
const reviewLines = () =>
  within(reviewSheet())
    .getAllByRole("listitem")
    .map((li) => li.textContent?.replace(/\s+/g, " ").trim());

const expectNoForbiddenKeys = (body: Record<string, unknown>) => {
  expect(body).not.toHaveProperty("active");
  expect(body).not.toHaveProperty("removalReason");
};

describe("LooForm (edit)", () => {
  it("disables Save until something changes, reviews it, then sends only the changed field", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, makeLoo({ name: "Market Square toilets" })));
    renderEdit();

    expect(saveButton()).toHaveTextContent("No changes to save");
    expect(saveButton()).toBeDisabled();

    await changeName(user, "Market Square toilets");
    expect(saveButton()).toHaveTextContent("Save 1 change");
    expect(saveButton()).toBeEnabled();

    await user.click(saveButton());
    expect(reviewSheet()).toBeInTheDocument();
    expect(reviewLines()).toEqual(["Name: High Street toilets → changes to Market Square toilets"]);
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(confirmButton());

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
    await saveAndConfirm(user);

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
    await saveAndConfirm(user);

    await waitFor(() => expect(locationStub.href).toBe(`/loos/${LOO_ID}?saved=1`));
    expect(applyLocalMutation).toHaveBeenCalledWith(LOO_ID, null, BASE_UPDATED_AT);
    expect((await loadMapCache())?.data).toEqual([OTHER_ROW]);
  });

  it.each([
    ["no compressed field", makeLoo({ name: "New" })],
    [
      "a row for another toilet",
      { ...makeLoo({ name: "New" }), compressed: ["someone-else", "x", 1] },
    ],
  ])("leaves the cached map alone when the response has %s", async (_label, responseBody) => {
    const user = userEvent.setup();
    const rows: CompressedLoo[] = [[LOO_ID, "gcpuvp", 1], OTHER_ROW];
    await saveSnapshot(rows, "2026-11-01T09:58:00.000Z");
    fetchMock.mockResolvedValue(jsonResponse(200, responseBody));

    renderEdit();
    await changeName(user, "New");
    await saveAndConfirm(user);
    await waitFor(() => expect(locationStub.href).toBe(`/loos/${LOO_ID}?saved=1`));

    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    await saveAndConfirm(user);

    await waitFor(() => expect(locationStub.href).toBe(`/loos/${LOO_ID}?saved=1`));
    expect(applyLocalMutation).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("sends only the toggled facility", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, makeLoo({ radar: true })));
    renderEdit();

    await user.click(facility("Does it need a RADAR key?").getByLabelText("Yes"));
    expect(saveButton()).toHaveTextContent("Save 1 change");
    await saveAndConfirm(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(request().body).toEqual({ radar: true, baseUpdatedAt: BASE_UPDATED_AT });
  });

  it("sends urinalOnly from the Who can use it question", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, makeLoo({ urinalOnly: true })));
    renderEdit();

    const who = within(screen.getByRole("region", { name: "Who can use it?" }));
    await user.click(within(who.getByRole("group", { name: "Urinal only" })).getByLabelText("Yes"));
    await user.click(saveButton());
    expect(reviewLines()).toEqual(["Urinal only: Don't know → changes to Yes"]);
    await user.click(confirmButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(request().body).toEqual({ urinalOnly: true, baseUpdatedAt: BASE_UPDATED_AT });
  });

  it("sends null for a toilet facility set back to Don't know", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, makeLoo({ accessible: null })));
    renderEdit();

    await user.click(
      facility("Is there a wheelchair-accessible toilet?").getByLabelText("Don't know"),
    );
    await saveAndConfirm(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(request().body).toEqual({ accessible: null, baseUpdatedAt: BASE_UPDATED_AT });
  });

  it("sends notes: null when the notes are cleared", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, makeLoo({ notes: null })));
    renderEdit();

    await user.clear(notesInput());
    await user.click(saveButton());
    expect(reviewLines()).toEqual(["Notes: Closed Sundays → changes to Nothing"]);
    await user.click(confirmButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(request().body).toEqual({ notes: null, baseUpdatedAt: BASE_UPDATED_AT });
  });

  it("does not send openingTimes for a toilet with unknown hours when only the name changes", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(200, makeLoo({ openingTimes: null, name: "Renamed" })),
    );
    renderEdit(makeLoo({ openingTimes: null }));

    expect(
      within(screen.getByTestId("opening-hours")).getByRole("radio", { name: "Don't know" }),
    ).toBeChecked();
    await changeName(user, "Renamed");
    await saveAndConfirm(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { body } = request();
    expect(body).not.toHaveProperty("openingTimes");
    expect(body).toEqual({ name: "Renamed", baseUpdatedAt: BASE_UPDATED_AT });
  });

  it("sends a moved pin as the new location, described as a distance and direction", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, makeLoo({ location: { lat: 51.6, lng: -0.2 } })));
    renderEdit();

    await user.click(screen.getByRole("button", { name: "Stub: move pin far" }));
    await user.click(saveButton());
    expect(reviewLines()).toEqual([expect.stringMatching(/^Location: Moved 11\.7 km north$/)]);
    await user.click(confirmButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(request().body).toEqual({
      location: { lat: 51.6, lng: -0.2 },
      baseUpdatedAt: BASE_UPDATED_AT,
    });
  });

  it("passes the picker its mode, the API origin and the toilet to exclude", () => {
    renderEdit();
    expect(pickerProps.last).toMatchObject({
      mode: "edit",
      apiUrl: "",
      excludeId: LOO_ID,
      originalLocation: { lat: 51.501234567, lng: -0.141234567 },
    });
    expect(screen.queryByRole("textbox", { name: /latitude|longitude/i })).toBeNull();
  });

  it("opens the other toilet's edit page or restore flow from the picker's prompts", async () => {
    const user = userEvent.setup();
    renderEdit();

    await user.click(screen.getByRole("button", { name: "Stub: edit existing" }));
    expect(locationStub.href).toBe(`/loos/${OTHER_ID}/edit`);

    await user.click(screen.getByRole("button", { name: "Stub: restore existing" }));
    expect(locationStub.href).toBe(`/loos/${OTHER_ID}?restore=1`);
  });

  it("asks before the picker's prompts leave unsaved changes behind", async () => {
    const user = userEvent.setup();
    renderEdit();
    await changeName(user, "Renamed");

    await user.click(screen.getByRole("button", { name: "Stub: edit existing" }));
    const dialog = screen.getByRole("alertdialog", { name: "Discard your changes?" });
    expect(locationStub.href).toBe(START_HREF);
    await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(nameInput()).toHaveValue("Renamed");
    expect(locationStub.href).toBe(START_HREF);

    await user.click(screen.getByRole("button", { name: "Stub: restore existing" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(locationStub.href).toBe(`/loos/${OTHER_ID}?restore=1`);
    expect(sessionStorage.getItem(draftKey(LOO_ID))).toBeNull();
  });

  it("won't save while the pin is being moved and not yet confirmed", async () => {
    const user = userEvent.setup();
    renderEdit();

    await changeName(user, "Renamed");
    await user.click(screen.getByRole("button", { name: "Stub: start moving" }));
    await user.click(saveButton());

    expect(screen.getByRole("link", { name: MESSAGES.locationUnconfirmed })).toHaveAttribute(
      "href",
      "#field-location",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
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
    await saveAndConfirm(user);

    const banner = await screen.findByText(
      "This toilet was changed by someone else while you were editing.",
    );
    // The review sheet closes so the conflict can be dealt with.
    expect(screen.queryByRole("dialog")).toBeNull();
    const alert = banner.closest('[role="alert"]') as HTMLElement;
    expect(alert).not.toBeNull();
    const listed = within(alert)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(listed).toEqual(["Notes"]);
    expect(locationStub.href).toBe(START_HREF);

    await user.click(screen.getByRole("button", { name: "Load latest and keep my changes" }));

    expect(
      screen.queryByText("This toilet was changed by someone else while you were editing."),
    ).not.toBeInTheDocument();
    // The other person's name change is now the baseline; the user's notes are kept.
    expect(nameInput()).toHaveValue("Renamed by someone else");
    expect(notesInput()).toHaveValue("Closed Sundays, key at café");
    expect(saveButton()).toHaveTextContent("Save 1 change");

    await saveAndConfirm(user);

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
    await saveAndConfirm(user);

    expect(
      await screen.findByText(
        "None of the fields you changed were affected. Your changes will be kept.",
      ),
    ).toBeInTheDocument();
  });

  it("on 202 shows the queued screen and remembers the suggestion in localStorage", async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-17T09:00:00.000Z") });
    fetchMock.mockResolvedValue(jsonResponse(202, { queued: true, id: "pending-42" }));
    renderEdit(makeLoo(), false);

    expect(screen.getByText(MODERATOR_WILL_CHECK)).toBeInTheDocument();
    await changeName(user, "Queued name");
    await saveAndConfirm(user);

    expect(
      await screen.findByText("Thanks — a moderator will review your suggestion"),
    ).toBeInTheDocument();
    expect(screen.getByText(/awaiting review by a moderator/)).toBeInTheDocument();
    // Focus moves to the confirmation so screen readers announce it.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByText("Thanks — a moderator will review your suggestion").closest("[tabindex]"),
      ),
    );
    expect(screen.getByRole("link", { name: "View this toilet" })).toHaveAttribute(
      "href",
      `/loos/${LOO_ID}`,
    );
    expect(screen.getByRole("link", { name: "Back to map" })).toHaveAttribute("href", "/");
    // The prompt promises tracking, not that edits go live (a blocked account is queued too).
    expect(
      screen.getByRole("link", { name: "Sign in to keep track of your contributions" }),
    ).toHaveAttribute("href", `/auth/login?returnTo=${encodeURIComponent(`/loos/${LOO_ID}`)}`);
    expect(screen.queryByText(/go live/)).toBeNull();
    expect(locationStub.href).toBe(START_HREF);
    // Nothing is live yet, so the map cache is not touched.
    expect(applyLocalMutation).not.toHaveBeenCalled();

    expect(JSON.parse(localStorage.getItem(`toiletmap-pending:${LOO_ID}`) ?? "null")).toEqual({
      kind: "edit",
      pendingId: "pending-42",
      at: "2026-11-17T09:00:00.000Z",
    });
    // The draft is done with.
    expect(sessionStorage.getItem(draftKey(LOO_ID))).toBeNull();
    vi.useRealTimers();
  });

  it("does not offer sign-in on the queued screen to a signed-in user", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(202, { queued: true, id: "pending-43" }));
    renderEdit(makeLoo(), true);

    await changeName(user, "Queued name");
    await saveAndConfirm(user);

    expect(
      await screen.findByText("Thanks — a moderator will review your suggestion"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Sign in/ })).toBeNull();
  });

  it("says the user already suggested changes when a recent marker exists", () => {
    localStorage.setItem(
      pendingKey(LOO_ID),
      JSON.stringify({ kind: "edit", pendingId: "p1", at: new Date().toISOString() }),
    );
    renderEdit();
    expect(
      screen.getByText(/You suggested changes to this toilet .* awaiting review by a moderator/),
    ).toBeInTheDocument();
  });

  it("ignores an expired suggestion marker", () => {
    localStorage.setItem(
      pendingKey(LOO_ID),
      JSON.stringify({ kind: "edit", pendingId: "p1", at: "2020-01-01T00:00:00.000Z" }),
    );
    renderEdit();
    expect(screen.queryByText(/You suggested changes/)).toBeNull();
    expect(localStorage.getItem(pendingKey(LOO_ID))).toBeNull();
  });

  it("shows a message and does not redirect when the server reports nothing changed", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, { queued: false, unchanged: true }));
    renderEdit(makeLoo(), false);

    await changeName(user, "Same as stored");
    await saveAndConfirm(user);

    expect(
      await screen.findByText(/No changes were needed — this toilet already has these details/),
    ).toBeInTheDocument();
    expect(locationStub.href).toBe(START_HREF);
    expect(locationStub.href).not.toContain("undefined");
  });

  it("on 401 offers sign-in that returns to this page, and keeps the changes", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(401, { message: "Unauthorized" }));
    renderEdit();

    await changeName(user, "Needs auth");
    await saveAndConfirm(user);

    const link = await screen.findByRole("link", { name: "Sign in again" });
    expect(link).toHaveAttribute(
      "href",
      `/auth/login?returnTo=${encodeURIComponent(`/loos/${LOO_ID}/edit`)}`,
    );
    expect(screen.getByText("Your sign-in has expired")).toBeInTheDocument();
    expect(screen.getByText(/your changes are kept/)).toBeInTheDocument();
    expect(locationStub.href).toBe(START_HREF);
    expect(nameInput()).toHaveValue("Needs auth");
    const draft = JSON.parse(sessionStorage.getItem(draftKey(LOO_ID)) ?? "null");
    expect(draft?.form?.name).toBe("Needs auth");
  });

  it("blocks submit and links the error summary to the opening hours", async () => {
    const user = userEvent.setup();
    renderEdit();

    await user.click(screen.getByRole("button", { name: "Stub: clear Monday opening" }));
    expect(saveButton()).toHaveTextContent("Save 1 change");
    await user.click(saveButton());

    const link = await screen.findByRole("link", {
      name: "Enter both opening and closing times for Monday.",
    });
    expect(link).toHaveAttribute("href", "#field-openingTimes");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    // The summary takes focus so screen readers announce it.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByText("There's a problem").closest("[tabindex]"),
      ),
    );
    // Its link goes to the invalid time, not the first control in the hours question.
    fireEvent.click(link);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Monday opens" }));
  });

  it("maps server validation issues onto fields, with links that focus them", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        message: "Invalid upsert request body",
        issues: { _errors: [], name: { _errors: ["Too long"] } },
      }),
    );
    renderEdit();

    await changeName(user, "A very long name");
    await saveAndConfirm(user);

    const link = await screen.findByRole("link", { name: "Name: Too long" });
    expect(link).toHaveAttribute("href", "#field-name");
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    expect(nameInput().getAttribute("aria-describedby")).toContain("error-name");
    await user.click(link);
    expect(document.activeElement).toBe(nameInput());
  });

  it("never sends active or removalReason, even for a removed toilet", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, makeLoo()));
    renderEdit(makeLoo({ active: false, removalReason: "Demolished" }));

    await changeName(user, "Back again");
    await user.clear(notesInput());
    await user.type(notesInput(), "Reopened");
    await user.click(facility("Baby changing").getByLabelText("No"));
    await user.click(
      within(screen.getByTestId("opening-hours")).getByRole("radio", { name: "Don't know" }),
    );
    expect(saveButton()).toHaveTextContent("Save 4 changes");
    await user.click(saveButton());
    expect(reviewLines()).toEqual([
      "Name: High Street toilets → changes to Back again",
      "Baby changing: Yes → changes to No",
      "Opening hours: Every day 9am–5pm → changes to Opening hours not known",
      "Notes: Closed Sundays → changes to Reopened",
    ]);
    await user.click(confirmButton());

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
    await saveAndConfirm(user);

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

describe("LooForm layout", () => {
  it("asks the seven questions in order, as labelled regions", () => {
    renderEdit();
    const titles = screen
      .getAllByRole("region")
      .map((region) => region.getAttribute("aria-labelledby"))
      .map((id) => document.getElementById(id ?? "")?.textContent?.replace(/^\d+/, ""));
    expect(titles).toEqual([
      "What's it called?",
      "Where is it?",
      "Who can use it?",
      "Accessibility",
      "Does it cost money?",
      "When is it open?",
      "Anything else people should know?",
    ]);
    expect(
      screen.getByTestId("opening-hours").contains(document.getElementById("field-openingTimes")),
    ).toBe(true);
  });

  it("asks for payment details only when the toilet isn't free", async () => {
    const user = userEvent.setup();
    renderEdit();
    const question = "How much does it cost, and how can people pay?";
    expect(screen.queryByLabelText(question)).toBeNull();
    await user.click(facility("Is it free to use?").getByLabelText("No"));
    expect(screen.getByLabelText(question)).toHaveAttribute("id", "field-paymentDetails");
  });
});

describe("LooForm deep links", () => {
  it.each([
    ["hours", "opening-hours"],
    ["notes", null],
  ])("focuses the #%s question on load", async (hash, testId) => {
    Object.assign(locationStub, { hash: `#${hash}` });
    renderEdit();
    const section = document.getElementById(hash);
    expect(section?.tagName).toBe("SECTION");
    await waitFor(() => {
      const active = document.activeElement as HTMLElement;
      if (testId) expect(screen.getByTestId(testId).contains(active)).toBe(true);
      else expect(active).toBe(notesInput());
    });
  });

  it("focuses the location question for #location", async () => {
    Object.assign(locationStub, { hash: "#location" });
    renderEdit();
    await waitFor(() =>
      expect(document.getElementById("field-location")?.contains(document.activeElement)).toBe(
        true,
      ),
    );
  });

  it("ignores unknown hashes", async () => {
    Object.assign(locationStub, { hash: "#constructor" });
    renderEdit();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(document.activeElement).toBe(document.body);
  });
});

describe("LooForm review sheet", () => {
  it("goes back to editing without saving, keeping the changes", async () => {
    const user = userEvent.setup();
    renderEdit();

    await changeName(user, "Renamed");
    await user.click(saveButton());
    expect(document.activeElement).toBe(
      within(reviewSheet()).getByRole("heading", { name: "Check your changes" }),
    );
    await user.click(screen.getByRole("button", { name: "Back to editing" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(nameInput()).toHaveValue("Renamed");
    expect(fetchMock).not.toHaveBeenCalled();
    // Focus returns to where it was.
    expect(document.activeElement).toBe(saveButton());
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    renderEdit();
    await changeName(user, "Renamed");
    await user.click(saveButton());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("describes yes/no answers and opening hours in plain language", async () => {
    const user = userEvent.setup();
    renderEdit();

    await user.click(facility("Women").getByLabelText("Don't know"));
    await user.click(facility("Is there a wheelchair-accessible toilet?").getByLabelText("No"));
    await user.click(screen.getByRole("button", { name: "Stub: open 24/7" }));
    await user.click(saveButton());

    expect(reviewLines()).toEqual([
      "Women: Yes → changes to Don't know",
      "Wheelchair accessible: Yes → changes to No",
      "Opening hours: Every day 9am–5pm → changes to Open 24 hours, every day",
    ]);
    expect(within(reviewSheet()).getByText("You're changing 3 things:")).toBeInTheDocument();
  });

  it("tells anonymous users a moderator will check, and is shown even if skipReview is set", async () => {
    const user = userEvent.setup();
    renderEdit(makeLoo(), false, { skipReview: true });
    await changeName(user, "Renamed");
    await user.click(saveButton());
    expect(
      within(reviewSheet()).getByText(
        "A moderator will check your change before it appears on the map.",
      ),
    ).toBeInTheDocument();
  });

  it("tells a signed-in user whose session has expired a moderator will check, too", async () => {
    const user = userEvent.setup();
    renderEdit(makeLoo(), true, { canWriteDirectly: false });
    expect(screen.getByText(MODERATOR_WILL_CHECK)).toBeInTheDocument();
    await changeName(user, "Renamed");
    expect(screen.getByText(MODERATOR_WILL_CHECK)).toBeInTheDocument();
    await user.click(saveButton());
    expect(
      within(reviewSheet()).getByText(
        "A moderator will check your change before it appears on the map.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/go live/)).toBeNull();
  });

  it("tells a trusted user their change goes live straight away", async () => {
    const user = userEvent.setup();
    renderEdit(makeLoo(), true, { canWriteDirectly: true });
    await changeName(user, "Renamed");
    expect(screen.getByText(LIVE_STRAIGHT_AWAY)).toBeInTheDocument();
    await user.click(saveButton());
    expect(
      within(reviewSheet()).getByText("Your change will go live straight away."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/moderator/)).toBeNull();
  });

  it("shows the queued screen when the server queues a save it was expected to apply", async () => {
    // A user blocked in Auth0 looks signed in to the client; the API queues their change.
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(202, { queued: true, id: "pending-blocked" }));
    renderEdit(makeLoo(), true, { canWriteDirectly: true });
    await changeName(user, "Renamed");
    expect(screen.getByText(LIVE_STRAIGHT_AWAY)).toBeInTheDocument();
    await saveAndConfirm(user);

    expect(
      await screen.findByText("Thanks — a moderator will review your suggestion"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/go live/)).toBeNull();
    // Already signed in: no sign-in prompt.
    expect(screen.queryByRole("link", { name: /Sign in/ })).toBeNull();
    expect(locationStub.href).toBe(START_HREF);
    expect(applyLocalMutation).not.toHaveBeenCalled();
  });

  it("can be skipped for signed-in users", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, makeLoo({ name: "Renamed" })));
    renderEdit(makeLoo(), true, { skipReview: true });
    await changeName(user, "Renamed");
    await user.click(saveButton());
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(locationStub.href).toBe(`/loos/${LOO_ID}?saved=1`));
  });

  it("lists the answered questions for a new toilet", async () => {
    const user = userEvent.setup();
    renderAdd();
    await user.type(nameInput(), "Brand new toilet");
    await user.click(screen.getByRole("button", { name: "Stub: place pin" }));
    await user.click(facility("Is there a wheelchair-accessible toilet?").getByLabelText("Yes"));
    await user.click(saveButton());

    expect(
      within(reviewSheet()).getByRole("heading", { name: "Check the new toilet" }),
    ).toBeVisible();
    expect(reviewLines()).toEqual([
      "Name: Brand new toilet",
      "Location: Placed on the map",
      "Wheelchair accessible: Yes",
    ]);
  });
});

describe("LooForm sticky action bar", () => {
  it("counts changes and disables saving when there are none", async () => {
    const user = userEvent.setup();
    renderEdit(makeLoo(), true, { canWriteDirectly: true });
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText("Change any answer to save.")).toBeInTheDocument();

    await changeName(user, "Renamed");
    await user.click(facility("Men").getByLabelText("No"));
    expect(saveButton()).toHaveTextContent("Save 2 changes");
    expect(saveButton()).toBeEnabled();

    await changeName(user, "High Street toilets");
    expect(saveButton()).toHaveTextContent("Save 1 change");
  });

  it("offers Add toilet once something has been entered", async () => {
    const user = userEvent.setup();
    renderAdd();
    expect(saveButton()).toHaveTextContent("Add toilet");
    expect(saveButton()).toBeDisabled();
    await user.type(nameInput(), "X");
    expect(saveButton()).toBeEnabled();
  });

  it("tells anonymous users their change will be reviewed, with a sign-in link back here", () => {
    locationStub.pathname = "/loos/add";
    locationStub.search = "?lat=51.5&lng=-0.1&zoom=17";
    renderAdd(false);
    expect(screen.getByText(MODERATOR_WILL_CHECK)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/auth/login?returnTo=${encodeURIComponent("/loos/add?lat=51.5&lng=-0.1&zoom=17")}`,
    );
  });
});

describe("LooForm unsaved changes", () => {
  it("Cancel is a plain link back to the toilet while nothing has changed", async () => {
    const user = userEvent.setup();
    renderEdit();
    const cancel = screen.getByRole("link", { name: "Cancel" });
    expect(cancel).toHaveAttribute("href", `/loos/${LOO_ID}`);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    cancel.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await user.tab();
  });

  it("Cancel with changes asks before discarding them", async () => {
    const user = userEvent.setup();
    renderEdit();
    await changeName(user, "Renamed");
    expect(sessionStorage.getItem(draftKey(LOO_ID))).not.toBeNull();

    await user.click(screen.getByRole("link", { name: "Cancel" }));
    const dialog = screen.getByRole("alertdialog", { name: "Discard your changes?" });
    expect(within(dialog).getByText("You've made 1 change that haven't been saved.")).toBeVisible();
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Keep editing" }),
    );
    expect(locationStub.href).toBe(START_HREF);

    await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(nameInput()).toHaveValue("Renamed");

    await user.click(screen.getByRole("link", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(locationStub.href).toBe(`/loos/${LOO_ID}`);
    expect(sessionStorage.getItem(draftKey(LOO_ID))).toBeNull();
  });

  it("warns on beforeunload only while there are unsaved changes", async () => {
    const user = userEvent.setup();
    const addSpy = vi.spyOn(window, "addEventListener");
    fetchMock.mockResolvedValue(jsonResponse(200, makeLoo({ name: "Renamed" })));
    renderEdit();

    const fire = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(addSpy.mock.calls.some(([type]) => String(type) === "beforeunload")).toBe(false);
    expect(fire()).toBe(false);

    await changeName(user, "Renamed");
    expect(addSpy.mock.calls.some(([type]) => String(type) === "beforeunload")).toBe(true);
    expect(fire()).toBe(true);

    // A successful save navigates away without a prompt.
    await saveAndConfirm(user);
    await waitFor(() => expect(locationStub.href).toBe(`/loos/${LOO_ID}?saved=1`));
    expect(fire()).toBe(false);
    addSpy.mockRestore();
  });
});

describe("LooForm drafts", () => {
  it("autosaves to sessionStorage and restores on the next load, with a Discard option", async () => {
    const user = userEvent.setup();
    const first = renderEdit();
    await changeName(user, "Draft name");
    await user.click(facility("Children").getByLabelText("Yes"));
    first.unmount();

    const stored = JSON.parse(sessionStorage.getItem(`loo-draft:${LOO_ID}`) ?? "null");
    expect(stored.form).toMatchObject({ name: "Draft name", children: "true" });

    renderEdit();
    expect(screen.getByText(/Restored your unsaved changes/)).toBeInTheDocument();
    expect(nameInput()).toHaveValue("Draft name");
    expect(saveButton()).toHaveTextContent("Save 2 changes");

    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByText(/Restored your unsaved changes/)).toBeNull();
    expect(nameInput()).toHaveValue("High Street toilets");
    expect(saveButton()).toBeDisabled();
    expect(sessionStorage.getItem(`loo-draft:${LOO_ID}`)).toBeNull();
  });

  it("re-applies only the draft's changes on top of a newer version of the toilet", () => {
    const old = makeLoo();
    const initialForm = formStateFromLoo(old, "edit");
    sessionStorage.setItem(
      draftKey(LOO_ID),
      JSON.stringify({
        v: 1,
        initialForm,
        form: { ...initialForm, name: "Mine" },
        baseUpdatedAt: BASE_UPDATED_AT,
        savedAt: new Date().toISOString(),
      }),
    );
    renderEdit(makeLoo({ notes: "Updated elsewhere", updatedAt: NEWER_UPDATED_AT }));

    expect(nameInput()).toHaveValue("Mine");
    expect(notesInput()).toHaveValue("Updated elsewhere");
    expect(saveButton()).toHaveTextContent("Save 1 change");
  });

  it("never overwrites a field someone else changed since the draft, and lets the user choose", async () => {
    const user = userEvent.setup();
    const initialForm = formStateFromLoo(makeLoo(), "edit");
    sessionStorage.setItem(
      draftKey(LOO_ID),
      JSON.stringify({
        v: 1,
        initialForm,
        form: { ...initialForm, name: "My name", women: "false" },
        baseUpdatedAt: BASE_UPDATED_AT,
        savedAt: new Date().toISOString(),
      }),
    );
    fetchMock.mockResolvedValue(jsonResponse(200, makeLoo({ name: "My name" })));
    renderEdit(makeLoo({ name: "Their newer name", updatedAt: NEWER_UPDATED_AT }));

    // The newer server value is kept; the non-overlapping change is restored.
    expect(nameInput()).toHaveValue("Their newer name");
    expect(facility("Women").getByLabelText("No")).toBeChecked();
    expect(saveButton()).toHaveTextContent("Save 1 change");
    const banner = screen
      .getByText("This toilet was changed by someone else while you were editing.")
      .closest('[role="alert"]') as HTMLElement;
    expect(
      within(banner)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Name"]);

    await user.click(within(banner).getByRole("button", { name: "Use my changes instead" }));
    expect(nameInput()).toHaveValue("My name");
    expect(saveButton()).toHaveTextContent("Save 2 changes");
    expect(
      screen.queryByText("This toilet was changed by someone else while you were editing."),
    ).toBeNull();

    await saveAndConfirm(user);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Sent against the version the user has now seen.
    expect(request().body).toEqual({
      name: "My name",
      women: false,
      baseUpdatedAt: NEWER_UPDATED_AT,
    });
  });

  it("can keep the other person's version of a conflicting field", async () => {
    const user = userEvent.setup();
    const initialForm = formStateFromLoo(makeLoo(), "edit");
    sessionStorage.setItem(
      draftKey(LOO_ID),
      JSON.stringify({
        v: 1,
        initialForm,
        form: { ...initialForm, name: "My name" },
        baseUpdatedAt: BASE_UPDATED_AT,
        savedAt: new Date().toISOString(),
      }),
    );
    renderEdit(makeLoo({ name: "Their newer name", updatedAt: NEWER_UPDATED_AT }));
    await user.click(screen.getByRole("button", { name: "Keep their version" }));
    expect(nameInput()).toHaveValue("Their newer name");
    expect(saveButton()).toBeDisabled();
  });

  it("keeps the user's own value for an unresolved conflict across a reload", async () => {
    const user = userEvent.setup();
    const initialForm = formStateFromLoo(makeLoo(), "edit");
    sessionStorage.setItem(
      draftKey(LOO_ID),
      JSON.stringify({
        v: 1,
        initialForm,
        form: { ...initialForm, name: "My name", women: "false" },
        baseUpdatedAt: BASE_UPDATED_AT,
        savedAt: new Date().toISOString(),
      }),
    );
    const newer = makeLoo({ name: "Their newer name", updatedAt: NEWER_UPDATED_AT });
    const first = renderEdit(newer);
    expect(nameInput()).toHaveValue("Their newer name");
    first.unmount();

    // Reloaded before choosing: the conflict is asked about again, with the user's value kept.
    renderEdit(newer);
    expect(nameInput()).toHaveValue("Their newer name");
    expect(facility("Women").getByLabelText("No")).toBeChecked();
    const banner = screen
      .getByText("This toilet was changed by someone else while you were editing.")
      .closest('[role="alert"]') as HTMLElement;
    expect(
      within(banner)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Name"]);
    await user.click(within(banner).getByRole("button", { name: "Use my changes instead" }));
    expect(nameInput()).toHaveValue("My name");
    expect(saveButton()).toHaveTextContent("Save 2 changes");
  });

  it("keeps a draft whose only change is an unresolved conflict, until the user chooses", async () => {
    const user = userEvent.setup();
    const initialForm = formStateFromLoo(makeLoo(), "edit");
    sessionStorage.setItem(
      draftKey(LOO_ID),
      JSON.stringify({
        v: 1,
        initialForm,
        form: { ...initialForm, name: "My name" },
        baseUpdatedAt: BASE_UPDATED_AT,
        savedAt: new Date().toISOString(),
      }),
    );
    const newer = makeLoo({ name: "Their newer name", updatedAt: NEWER_UPDATED_AT });
    renderEdit(newer).unmount();
    expect(JSON.parse(sessionStorage.getItem(draftKey(LOO_ID)) ?? "null")?.form?.name).toBe(
      "My name",
    );

    renderEdit(newer);
    await user.click(screen.getByRole("button", { name: "Keep their version" }));
    expect(sessionStorage.getItem(draftKey(LOO_ID))).toBeNull();
  });

  it("drops a draft older than a day", () => {
    const initialForm = formStateFromLoo(makeLoo(), "edit");
    sessionStorage.setItem(
      draftKey(LOO_ID),
      JSON.stringify({
        v: 1,
        initialForm,
        form: { ...initialForm, name: "Stale" },
        baseUpdatedAt: BASE_UPDATED_AT,
        savedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      }),
    );
    renderEdit();
    expect(nameInput()).toHaveValue("High Street toilets");
    expect(screen.queryByText(/Restored your unsaved changes/)).toBeNull();
    expect(sessionStorage.getItem(draftKey(LOO_ID))).toBeNull();
  });

  it("opens a new toilet where ?lat&lng asked, not at an old draft's pin", () => {
    const empty = formStateFromLoo(null, "add");
    sessionStorage.setItem(
      draftKey(null),
      JSON.stringify({
        v: 1,
        initialForm: empty,
        form: { ...empty, name: "Half-added", location: { lat: 51.6, lng: -0.2 } },
        savedAt: new Date().toISOString(),
      }),
    );
    render(
      <LooForm
        mode="add"
        apiUrl=""
        isAuthenticated
        initialView={{ lat: 51.5, lng: -0.12, zoom: 18 }}
      />,
    );
    expect(screen.getByTestId("picker-location")).toHaveTextContent("none");
    expect(nameInput()).toHaveValue("Half-added");
    expect(screen.getByText(/The map is where you asked/)).toBeInTheDocument();
  });

  it("keeps a new toilet's draft pin when the page was opened at that same spot", () => {
    const empty = formStateFromLoo(null, "add");
    sessionStorage.setItem(
      draftKey(null),
      JSON.stringify({
        v: 1,
        initialForm: empty,
        form: { ...empty, name: "Half-added", location: { lat: 51.5, lng: -0.12 } },
        savedAt: new Date().toISOString(),
      }),
    );
    locationStub.search = "?lat=51.5&lng=-0.12&zoom=18";
    renderAdd();
    expect(screen.getByTestId("picker-location")).toHaveTextContent("51.5,-0.12");
  });

  it("keeps a new toilet's own pin when it comes back to the ?lat&lng the draft began at", async () => {
    const user = userEvent.setup();
    locationStub.pathname = "/loos/add";
    locationStub.search = "?lat=51.5&lng=-0.12&zoom=18";
    const first = renderAdd();
    await user.type(nameInput(), "Half-added");
    await user.click(screen.getByRole("button", { name: "Stub: move pin far" }));
    first.unmount();

    // Back from signing in (or reloaded): same page, so the pin the user placed stays.
    const second = renderAdd();
    expect(screen.getByTestId("picker-location")).toHaveTextContent("51.6,-0.2");
    expect(screen.queryByText(/The map is where you asked/)).toBeNull();
    second.unmount();

    // Opened at a different spot, the map goes there instead.
    locationStub.search = "?lat=51.4&lng=-0.3&zoom=18";
    renderAdd();
    expect(screen.getByTestId("picker-location")).toHaveTextContent("none");
    expect(nameInput()).toHaveValue("Half-added");
  });

  it("ignores a corrupt draft", () => {
    sessionStorage.setItem(draftKey(LOO_ID), "{not json");
    renderEdit();
    expect(screen.queryByText(/Restored your unsaved changes/)).toBeNull();
    expect(nameInput()).toHaveValue("High Street toilets");
  });

  it("keeps a new toilet's draft under loo-draft:new and clears it after saving", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(201, { ...makeLoo(), id: "fedcba9876543210fedcba98" }),
    );
    const first = renderAdd();
    await user.type(nameInput(), "New one");
    await user.click(screen.getByRole("button", { name: "Stub: place pin" }));
    first.unmount();
    expect(sessionStorage.getItem("loo-draft:new")).not.toBeNull();

    renderAdd();
    expect(nameInput()).toHaveValue("New one");
    expect(screen.getByTestId("picker-location")).toHaveTextContent("51.5074,-0.1278");
    await saveAndConfirm(user);
    await waitFor(() => expect(locationStub.href).toBe("/loos/fedcba9876543210fedcba98?saved=1"));
    expect(sessionStorage.getItem("loo-draft:new")).toBeNull();
  });
});

describe("LooForm (add)", () => {
  it("requires a location before submitting", async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.type(nameInput(), "Brand new toilet");
    await user.click(saveButton());

    expect(screen.getByRole("link", { name: MESSAGES.locationRequired })).toHaveAttribute(
      "href",
      "#field-location",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tells the user to place the pin when it hasn't been confirmed yet", async () => {
    const user = userEvent.setup();
    renderAdd();
    // A new toilet's picker starts moving, with nothing to cancel back to.
    await user.click(screen.getByRole("button", { name: "Stub: start moving" }));
    await user.type(nameInput(), "Brand new toilet");
    await user.click(saveButton());

    expect(screen.getByRole("link", { name: MESSAGES.locationNotPlaced })).toHaveAttribute(
      "href",
      "#field-location",
    );
    expect(screen.queryByText(/cancel the move/)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives a single location instruction, from the picker", () => {
    renderAdd();
    const question = screen.getByRole("region", { name: /Where is it\?/ });
    expect(within(question).queryByText(/entrance/)).toBeNull();
  });

  it("requires a name before submitting", async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.click(screen.getByRole("button", { name: "Stub: place pin" }));
    await user.click(saveButton());

    const link = screen.getByRole("link", { name: MESSAGES.nameRequired });
    expect(link).toHaveAttribute("href", "#field-name");
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(link);
    expect(document.activeElement).toBe(nameInput());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the new toilet without baseUpdatedAt or active, then opens its page", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(201, { ...makeLoo(), id: "fedcba9876543210fedcba98" }),
    );
    renderAdd();

    expect(pickerProps.last).toMatchObject({ mode: "add", apiUrl: "", originalLocation: null });
    expect(saveButton()).toHaveTextContent("Add toilet");
    await user.type(nameInput(), "Brand new toilet");
    await user.click(screen.getByRole("button", { name: "Stub: place pin" }));
    expect(screen.getByTestId("picker-location")).toHaveTextContent("51.5074,-0.1278");
    await user.click(facility("Is there a wheelchair-accessible toilet?").getByLabelText("Yes"));
    await saveAndConfirm(user);

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
      urinalOnly: null,
    });
    // Opening hours default to "Don't know", so none are sent.
    expect(body).not.toHaveProperty("openingTimes");
  });

  it("passes the initial map view to the picker", () => {
    render(
      <LooForm
        mode="add"
        apiUrl=""
        isAuthenticated={true}
        initialView={{ lat: 51.5, lng: -0.12, zoom: 18 }}
      />,
    );
    expect(pickerProps.last).toMatchObject({ initialView: { lat: 51.5, lng: -0.12, zoom: 18 } });
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
    await saveAndConfirm(user);

    await waitFor(() => expect(locationStub.href).toBe(`/loos/${newId}?saved=1`));
    expect(applyLocalMutation).toHaveBeenCalledWith(newId, compressed, BASE_UPDATED_AT);
    expect((await loadMapCache())?.data).toEqual([OTHER_ROW, compressed]);
  });

  it("remembers a queued new toilet under a create marker", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(202, { queued: true, id: "pending-new" }));
    renderAdd(false);

    await user.type(nameInput(), "Suggested toilet");
    await user.click(screen.getByRole("button", { name: "Stub: place pin" }));
    await saveAndConfirm(user);

    expect(
      await screen.findByText("Thanks — a moderator will review your suggestion"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View this toilet" })).toBeNull();
    expect(
      JSON.parse(localStorage.getItem("toiletmap-pending:new:pending-new") ?? "null"),
    ).toMatchObject({ kind: "create", pendingId: "pending-new" });
  });
});
