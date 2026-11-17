import { render, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLooDetailCache, type LooDetail } from "../../api/loos";
import { PENDING_KEY_PREFIX } from "../../api/reports";
import ReportProblem from "./ReportProblem";

const ID = "0123456789abcdef01234567";
const DUP = "fedcba9876543210fedcba98";
const UPDATED_AT = "2026-11-01T10:00:00.000Z";

const loo: LooDetail = {
  id: ID,
  name: "High Street toilets",
  location: { lat: 51.5, lng: -0.14 },
  accessible: null,
  allGender: null,
  men: null,
  women: null,
  children: null,
  babyChange: null,
  radar: null,
  automatic: null,
  noPayment: null,
  paymentDetails: null,
  openingTimes: null,
  updatedAt: UPDATED_AT,
  active: true,
};

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

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Route = (url: URL, init: RequestInit | undefined) => Response | Promise<Response> | undefined;
let routes: Route[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

const posts = (action: string) =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith(`/${action}`))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));

beforeEach(() => {
  routes = [];
  vi.stubGlobal("localStorage", memoryStorage());
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost");
    for (const route of routes) {
      const response = await route(url, init);
      if (response) return response;
    }
    throw new Error(`Unexpected fetch ${input}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  clearLooDetailCache();
  history.replaceState(null, "", `/loos/${ID}/remove`);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const onReport = (status: number, body: unknown) =>
  routes.push((url) =>
    url.pathname === `/api/loos/${ID}/report` ? jsonResponse(status, body) : undefined,
  );
const onRestore = (status: number, body: unknown) =>
  routes.push((url) =>
    url.pathname === `/api/loos/${ID}/restore` ? jsonResponse(status, body) : undefined,
  );
const onProximity = (status: number, body: unknown) =>
  routes.push((url) =>
    url.pathname === "/api/loos/proximity" ? jsonResponse(status, body) : undefined,
  );

const setup = (props: Partial<Parameters<typeof ReportProblem>[0]> = {}) => {
  const user = userEvent.setup();
  render(<ReportProblem loo={loo} apiUrl="" isAuthenticated={false} {...props} />);
  return user;
};

const choose = (user: ReturnType<typeof userEvent.setup>, label: RegExp | string) =>
  user.click(screen.getByRole("radio", { name: label }));

const continueToConfirm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Continue" }));
  const heading = await screen.findByRole("heading", { name: "Check your report" });
  await waitFor(() => expect(heading).toHaveFocus());
};

describe("ReportProblem — step 1", () => {
  it("asks what's wrong with every reason in a labelled group", () => {
    setup();
    expect(
      screen.getByRole("heading", { level: 1, name: "Report a problem with High Street toilets" }),
    ).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "What's wrong with this toilet?" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((r) => r.closest("label")?.textContent),
    ).toEqual([
      "It's permanently closed or demolished",
      "It's in the wrong place on the map",
      "It doesn't exist",
      "It's temporarily closed",
      "It's not open to the public (customers only)",
      "It's a duplicate of another toilet",
      "Something else",
    ]);
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", `/loos/${ID}`);
  });

  it("requires a choice and focuses the first option", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Choose what's wrong with this toilet.")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")[0]).toHaveFocus();
    expect(screen.queryByRole("heading", { name: "Check your report" })).not.toBeInTheDocument();
  });

  it("sends temporarily closed toilets to the hours and notes edit instead", async () => {
    const user = setup();
    await choose(user, "It's temporarily closed");
    expect(screen.getByText(/Temporarily closed toilets stay on the map/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /update opening hours or notes/i })).toHaveAttribute(
      "href",
      `/loos/${ID}/edit#hours`,
    );
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/anything else/i)).not.toBeInTheDocument();
  });

  it("explains customers-only toilets and links to the notes edit", async () => {
    const user = setup();
    await choose(user, /not open to the public/);
    expect(screen.getByRole("link", { name: "add a note" })).toHaveAttribute(
      "href",
      `/loos/${ID}/edit#notes`,
    );
    // Still reportable when there's no public access at all.
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("sends a toilet in the wrong place to move its pin, not to be removed", async () => {
    const user = setup();
    await choose(user, "It's in the wrong place on the map");
    expect(screen.getByText(/it stays on the map/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Move the pin" })).toHaveAttribute(
      "href",
      `/loos/${ID}/edit#location`,
    );
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/anything else/i)).not.toBeInTheDocument();
  });

  it("reports a toilet that doesn't exist as does_not_exist", async () => {
    onReport(202, { queued: true, id: "p-dne" });
    const user = setup();
    await choose(user, "It doesn't exist");
    expect(screen.queryByRole("link", { name: "Move the pin" })).not.toBeInTheDocument();
    await continueToConfirm(user);
    expect(screen.getByText("Problem").nextElementSibling).toHaveTextContent("It doesn't exist");
    await user.click(screen.getByRole("button", { name: "Report it" }));
    await screen.findByRole("heading", { name: /moderator will review/ });
    expect(posts("report")).toEqual([{ reason: "does_not_exist", baseUpdatedAt: UPDATED_AT }]);
  });

  it("requires details for 'Something else'", async () => {
    const user = setup();
    await choose(user, "Something else");
    const details = screen.getByLabelText("What's wrong?");
    expect(details).toBeRequired();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Tell us what's wrong.")).toBeInTheDocument();
    expect(details).toHaveFocus();
    expect(details).toHaveAttribute("aria-invalid", "true");
    expect(details.getAttribute("aria-describedby")).toContain("report-details-error");
  });

  it("makes details optional for the other reasons", async () => {
    const user = setup();
    await choose(user, /permanently closed/);
    expect(screen.getByLabelText("Anything else we should know? (optional)")).not.toBeRequired();
    await continueToConfirm(user);
  });
});

describe("ReportProblem — duplicates", () => {
  const nearby = {
    data: [
      {
        id: DUP,
        name: "Station toilets",
        distance: 23.4,
        active: true,
        // About 23 m north of the reported toilet (51.5, -0.14).
        location: { lat: 51.50021, lng: -0.14 },
      },
      { id: ID, name: "Self", distance: 0, active: true },
      { id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: null, distance: 61, active: true },
    ],
  };

  it("lists nearby toilets and requires one to be picked", async () => {
    onProximity(200, nearby);
    onReport(202, { queued: true, id: "p1" });
    const user = setup();
    await choose(user, /duplicate/);

    const group = await screen.findByRole("group", { name: "Which toilet is it a duplicate of?" });
    const options = await within(group).findAllByRole("radio");
    // Which way it is tells unnamed toilets apart; without a location only the distance shows.
    expect(options.map((o) => o.closest("label")?.textContent)).toEqual([
      "Station toilets23 m north",
      "Unnamed toilet61 m away",
    ]);
    const view = within(group).getByRole("link", { name: /^View Station toilets/ });
    expect(view).toHaveAttribute("href", `/loos/${DUP}`);
    expect(view).toHaveAttribute("target", "_blank");
    expect(view).toHaveAccessibleName("View Station toilets (opens in a new tab)");
    const proximity = new URL(fetchMock.mock.calls[0][0] as string, "http://localhost");
    expect(proximity.searchParams.get("radius")).toBe("100");
    expect(proximity.searchParams.get("exclude")).toBe(ID);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Choose the toilet this one duplicates.")).toBeInTheDocument();
    expect(options[0]).toHaveFocus();

    await user.click(within(group).getByRole("radio", { name: /Station toilets/ }));
    await continueToConfirm(user);
    expect(screen.getByText("Duplicate of").nextElementSibling).toHaveTextContent(
      "Station toilets (23 m north)",
    );

    await user.click(screen.getByRole("button", { name: "Report it" }));
    await screen.findByRole("heading", { name: /moderator will review/ });
    expect(posts("report")).toEqual([
      { reason: "duplicate", duplicateOf: DUP, baseUpdatedAt: UPDATED_AT },
    ]);
  });

  it("says when there are no other toilets nearby", async () => {
    onProximity(200, { data: [{ id: ID, name: "Self", distance: 0, active: true }] });
    const user = setup();
    await choose(user, /duplicate/);
    expect(await screen.findByText(/no other toilets within 100 m/)).toBeInTheDocument();
  });

  it("can retry when nearby toilets fail to load", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let calls = 0;
    routes.push((url) => {
      if (url.pathname !== "/api/loos/proximity") return undefined;
      calls += 1;
      return calls === 1 ? jsonResponse(500, {}) : jsonResponse(200, nearby);
    });
    const user = setup();
    await choose(user, /duplicate/);
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("radio", { name: /Station toilets/ })).toBeInTheDocument();
  });
});

describe("ReportProblem — confirm and submit", () => {
  it("tells a trusted user the toilet is removed straight away, and can go back", async () => {
    const user = setup({ isAuthenticated: true, canWriteDirectly: true });
    await choose(user, /permanently closed/);
    await user.type(screen.getByLabelText(/anything else/i), "Knocked down last week");
    await continueToConfirm(user);

    expect(
      screen.getByText(
        "High Street toilets will be removed from the map straight away. You can undo this on the next screen.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/moderator/)).toBeNull();
    expect(screen.getByText("Problem").nextElementSibling).toHaveTextContent(
      "It's permanently closed or demolished",
    );
    expect(screen.getByText("Knocked down last week")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("radio", { name: /permanently closed/ })).toBeChecked();
    expect(screen.getByLabelText(/anything else/i)).toHaveValue("Knocked down last week");
  });

  it.each([
    ["anonymous users", { isAuthenticated: false }],
    ["signed-in users without report:loo", { isAuthenticated: true, canWriteDirectly: false }],
  ])("tells %s a moderator checks first", async (_label, props) => {
    const user = setup(props);
    await choose(user, /permanently closed/);
    await continueToConfirm(user);
    expect(
      screen.getByText(
        "A moderator will check your report before High Street toilets is removed from the map.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/straight away/)).toBeNull();
  });

  it("removes the toilet on 200 and offers Undo", async () => {
    onReport(200, {
      ...loo,
      active: false,
      updatedAt: "2026-11-17T10:00:00.000Z",
      compressed: null,
    });
    onRestore(200, {
      ...loo,
      updatedAt: "2026-11-17T10:01:00.000Z",
      compressed: [ID, "gcpvj0", 1],
    });
    const user = setup({ isAuthenticated: true });
    await choose(user, /permanently closed/);
    await user.type(screen.getByLabelText(/anything else/i), "Gone");
    await continueToConfirm(user);
    await user.click(screen.getByRole("button", { name: "Report it" }));

    const heading = await screen.findByRole("heading", { name: "Removed — thanks." });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(posts("report")).toEqual([
      { reason: "permanently_closed", details: "Gone", baseUpdatedAt: UPDATED_AT },
    ]);
    expect(screen.getByRole("link", { name: "Back to map" })).toHaveAttribute("href", "/");

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText(/High Street toilets is back on the map/)).toBeInTheDocument();
    // The heading follows the undo, so the page never says "Removed" and "back" at once.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Undone — it's back on the map",
    );
    expect(screen.queryByText("Removed — thanks.")).toBeNull();
    expect(posts("restore")).toEqual([
      {
        details: "Undone straight after reporting it by mistake.",
        baseUpdatedAt: "2026-11-17T10:00:00.000Z",
      },
    ]);
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("keeps Undo available when undoing fails", async () => {
    onReport(200, { ...loo, active: false, compressed: null });
    onRestore(500, { message: "Try later" });
    const user = setup({ isAuthenticated: true });
    await choose(user, /permanently closed/);
    await continueToConfirm(user);
    await user.click(screen.getByRole("button", { name: "Report it" }));
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Try later")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  });

  it("thanks the user on 202 and remembers the pending report", async () => {
    onReport(202, { queued: true, id: "pending-7" });
    const user = setup();
    await choose(user, /not open to the public/);
    await continueToConfirm(user);
    await user.click(screen.getByRole("button", { name: "Report it" }));

    expect(
      await screen.findByRole("heading", { name: "Thanks — a moderator will review your report" }),
    ).toBeInTheDocument();
    expect(posts("report")[0]).toMatchObject({ reason: "not_public" });
    expect(JSON.parse(localStorage.getItem(`${PENDING_KEY_PREFIX}${ID}`) ?? "null")).toMatchObject({
      kind: "remove",
      pendingId: "pending-7",
    });
    expect(screen.getByRole("link", { name: "Back to the toilet" })).toHaveAttribute(
      "href",
      `/loos/${ID}`,
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/auth/login?returnTo=${encodeURIComponent(`/loos/${ID}/remove`)}`,
    );
    // Signing in no longer promises that reports go live.
    expect(screen.getByText(/to keep track of your contributions/)).toBeInTheDocument();
    expect(screen.queryByText(/go live/)).toBeNull();
  });

  it("says 'Undo requested' when the undo is queued", async () => {
    onReport(200, { ...loo, active: false, compressed: null });
    onRestore(202, { queued: true, id: "pending-undo" });
    const user = setup({ isAuthenticated: true, canWriteDirectly: true });
    await choose(user, /permanently closed/);
    await continueToConfirm(user);
    await user.click(screen.getByRole("button", { name: "Report it" }));
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(
      await screen.findByText("A moderator will review your request to put it back."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Undo requested");
  });

  it("submits 'Something else' as reason other with its details", async () => {
    onReport(202, { queued: true, id: "p" });
    const user = setup();
    await choose(user, "Something else");
    await user.type(screen.getByLabelText("What's wrong?"), "Wrong name");
    await continueToConfirm(user);
    await user.click(screen.getByRole("button", { name: "Report it" }));
    await screen.findByRole("heading", { name: /moderator will review/ });
    expect(posts("report")).toEqual([
      { reason: "other", details: "Wrong name", baseUpdatedAt: UPDATED_AT },
    ]);
  });

  it("says when the toilet was already removed", async () => {
    onReport(409, { error: "already_removed" });
    const user = setup();
    await choose(user, /permanently closed/);
    await continueToConfirm(user);
    await user.click(screen.getByRole("button", { name: "Report it" }));
    expect(
      await screen.findByRole("heading", { name: "It's already been removed" }),
    ).toBeInTheDocument();
  });

  it("asks for a reload after a conflict", async () => {
    onReport(409, { error: "conflict", current: { ...loo, name: "Renamed" } });
    const user = setup();
    await choose(user, /permanently closed/);
    await continueToConfirm(user);
    await user.click(screen.getByRole("button", { name: "Report it" }));
    expect(
      await screen.findByRole("heading", { name: "This toilet has just been changed" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload page" })).toBeInTheDocument();
  });

  it("stays on the confirm step with a focused error when sending fails", async () => {
    onReport(500, { message: "Database unavailable" });
    const user = setup();
    await choose(user, /permanently closed/);
    await continueToConfirm(user);
    await user.click(screen.getByRole("button", { name: "Report it" }));
    const error = await screen.findByText("Database unavailable");
    await waitFor(() => expect(error.closest("[tabindex]")).toHaveFocus());
    expect(screen.getByRole("button", { name: "Report it" })).toBeEnabled();
  });

  it("explains rate limits and expired sign-ins", async () => {
    onReport(429, {});
    const user = setup({ isAuthenticated: true });
    await choose(user, /permanently closed/);
    await continueToConfirm(user);
    await user.click(screen.getByRole("button", { name: "Report it" }));
    expect(await screen.findByText(/a lot of reports in a short time/)).toBeInTheDocument();

    routes = [];
    onReport(401, {});
    await user.click(screen.getByRole("button", { name: "Report it" }));
    expect(await screen.findByRole("link", { name: "Sign in again" })).toHaveAttribute(
      "href",
      `/auth/login?returnTo=${encodeURIComponent(`/loos/${ID}/remove`)}`,
    );
  });
});

describe("ReportProblem — already removed", () => {
  it("doesn't offer to report a removed toilet again and links to restore it", () => {
    setup({ loo: { ...loo, active: false } });
    expect(
      screen.getByRole("heading", {
        name: "High Street toilets has already been removed from the map",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ask to restore it/ })).toHaveAttribute(
      "href",
      `/loos/${ID}?restore=1`,
    );
  });
});
