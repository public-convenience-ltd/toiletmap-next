import { render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLooDetailCache, type LooDetail, primeLooDetail } from "../../api/loos";
import { PENDING_KEY_PREFIX, PENDING_TTL_MS } from "../../api/reports";
import ToiletDetailsPanel, {
  PENDING_MESSAGE,
  REMOVED_MESSAGE,
  RESTORE_QUEUED_MESSAGE,
  RESTORED_MESSAGE,
  removalSummary,
  SAVED_MESSAGE,
  VERIFIED_MESSAGE,
} from "./index";

const ID = "0123456789abcdef01234567";
const DUP = "fedcba9876543210fedcba98";

const toilet: LooDetail = {
  id: ID,
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

const removedToilet: LooDetail = {
  ...toilet,
  active: false,
  removalCategory: "permanently_closed",
  removalReason: "Demolished in October",
  updatedAt: "2026-11-02T10:00:00.000Z",
};

const noop = () => undefined;
const editLinks = () => screen.queryAllByRole("link", { name: /edit/i });

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

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  clearLooDetailCache();
  history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ToiletDetailsPanel", () => {
  it("renders no notices by default", () => {
    render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
    expect(screen.getByRole("heading", { name: "High Street toilets" })).toBeInTheDocument();
    expect(screen.queryByText(SAVED_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(REMOVED_MESSAGE))).not.toBeInTheDocument();
    expect(screen.queryByText(PENDING_MESSAGE)).not.toBeInTheDocument();
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
    expect(screen.queryByRole("link", { name: /report a problem/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Is this toilet still here?")).not.toBeInTheDocument();
    // Without the removed record there's nothing to restore from here.
    expect(screen.queryByRole("button", { name: /ask to restore/i })).not.toBeInTheDocument();
    // Still closable.
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("renders a custom notice slot", () => {
    render(<ToiletDetailsPanel toilet={toilet} onClose={noop} notice={<p>Custom notice</p>} />);
    expect(screen.getByText("Custom notice")).toBeInTheDocument();
  });

  it("links to suggest an edit and to report a problem", () => {
    render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
    expect(screen.getByRole("link", { name: /suggest an edit/i })).toHaveAttribute(
      "href",
      `/loos/${ID}/edit`,
    );
    expect(screen.getByRole("link", { name: /report a problem/i })).toHaveAttribute(
      "href",
      `/loos/${ID}/remove`,
    );
  });

  describe("last verified", () => {
    it("falls back to the last update when never verified", () => {
      render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
      expect(screen.getByText("Last updated: 1 November 2026")).toBeInTheDocument();
    });

    it("shows the verified date when it is more recent than the last update", () => {
      render(
        <ToiletDetailsPanel
          toilet={{ ...toilet, verifiedAt: "2026-11-05T10:00:00.000Z" }}
          onClose={noop}
        />,
      );
      expect(screen.getByText("Last verified: 5 November 2026")).toBeInTheDocument();
      expect(screen.queryByText(/^Last updated/)).toBeNull();
    });

    it("shows a later edit instead of an older verification", () => {
      render(
        <ToiletDetailsPanel
          toilet={{ ...toilet, verifiedAt: "2025-10-05T10:00:00.000Z" }}
          onClose={noop}
        />,
      );
      expect(screen.getByText("Last updated: 1 November 2026")).toBeInTheDocument();
      expect(screen.queryByText(/^Last verified/)).toBeNull();
    });
  });

  it("asks whether the toilet is still here, matching its Yes button", () => {
    render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
    expect(screen.getByText("Is this toilet still here?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes, it's still here" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /suggest an edit/i })).toBeInTheDocument();
  });

  describe("restore copy", () => {
    it("says a moderator will check first for someone who can't write directly", async () => {
      const user = userEvent.setup();
      render(<ToiletDetailsPanel toilet={removedToilet} onClose={noop} />);
      await user.click(screen.getByRole("button", { name: /ask to restore/i }));
      expect(
        screen.getByText(
          "If High Street toilets is still here and open to the public, tell us and a moderator will check before it goes back on the map.",
        ),
      ).toBeInTheDocument();
    });

    it("says it goes back straight away for a signed-in user", async () => {
      const user = userEvent.setup();
      render(<ToiletDetailsPanel toilet={removedToilet} onClose={noop} canWriteDirectly />);
      await user.click(screen.getByRole("button", { name: /ask to restore/i }));
      expect(
        screen.getByText(
          "If High Street toilets is still here and open to the public, it will go back on the map straight away.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/moderator/)).toBeNull();
      // The server ignores details on a trusted restore, so there is nothing to ask for.
      expect(screen.queryByLabelText("Anything we should know? (optional)")).toBeNull();
    });
  });

  describe("Yes, it's still here", () => {
    it("verifies the toilet, says thanks and updates the date", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(
        jsonResponse(200, { id: ID, verifiedAt: "2026-11-17T09:30:00.000Z" }),
      );
      render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);

      await user.click(screen.getByRole("button", { name: "Yes, it's still here" }));

      const thanks = await screen.findByText(VERIFIED_MESSAGE);
      expect(thanks.closest('[role="status"]')).not.toBeNull();
      expect(screen.getByText("Last verified: 17 November 2026")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Yes, it's still here" }),
      ).not.toBeInTheDocument();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/loos/${ID}/verify`);
      expect(init.method).toBe("POST");
    });

    it("explains a rate limit and keeps the button", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(429, { message: "Too many requests" }));
      render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
      await user.click(screen.getByRole("button", { name: "Yes, it's still here" }));
      expect(await screen.findByText(/a lot in a short time/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Yes, it's still here" })).toBeEnabled();
    });

    it("says when the toilet has been removed meanwhile", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(409, { error: "removed" }));
      render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
      await user.click(screen.getByRole("button", { name: "Yes, it's still here" }));
      expect(await screen.findByText(`${REMOVED_MESSAGE}.`)).toBeInTheDocument();
    });
  });

  describe("removed toilets", () => {
    it("summarises the removal category and reason", () => {
      expect(removalSummary(removedToilet)).toBe(
        "Removed from the map: Permanently closed or demolished — Demolished in October",
      );
      expect(removalSummary({ ...removedToilet, removalCategory: null })).toBe(
        "Removed from the map — Demolished in October",
      );
      expect(removalSummary({ ...removedToilet, removalReason: null })).toBe(
        "Removed from the map: Permanently closed or demolished",
      );
      expect(removalSummary({ ...removedToilet, removalCategory: null, removalReason: " " })).toBe(
        null,
      );
    });

    it("shows an inactive toilet as removed, with its reason and a restore action", () => {
      render(<ToiletDetailsPanel toilet={removedToilet} onClose={noop} />);
      const banner = screen.getByText(
        "Removed from the map: Permanently closed or demolished — Demolished in October",
      );
      expect(banner.closest('[role="status"]')).not.toBeNull();
      expect(screen.queryByRole("link", { name: /directions/i })).not.toBeInTheDocument();
      expect(editLinks()).toHaveLength(0);
      expect(
        screen.queryByRole("button", { name: "Yes, it's still here" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /it's still here — ask to restore/i }),
      ).toBeVisible();
    });

    it("falls back to the generic message without a recorded reason", () => {
      render(
        <ToiletDetailsPanel
          toilet={{ ...toilet, active: false, removalCategory: null, removalReason: null }}
          onClose={noop}
        />,
      );
      expect(screen.getByText(`${REMOVED_MESSAGE}.`)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /ask to restore/i })).toBeInTheDocument();
    });

    it("links to the toilet a duplicate was merged into", () => {
      render(
        <ToiletDetailsPanel
          toilet={{ ...removedToilet, removalCategory: "duplicate", duplicateOf: DUP }}
          onClose={noop}
        />,
      );
      expect(screen.getByRole("link", { name: "See the toilet it duplicates" })).toHaveAttribute(
        "href",
        `/loos/${DUP}`,
      );
    });

    it("uses the cached removed record when the map reports the toilet gone", () => {
      primeLooDetail(removedToilet);
      render(<ToiletDetailsPanel toilet={toilet} onClose={noop} removed />);
      expect(
        screen.getByText(
          "Removed from the map: Permanently closed or demolished — Demolished in October",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /ask to restore/i })).toBeInTheDocument();
    });
  });

  describe("restore", () => {
    const openPrompt = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole("button", { name: /ask to restore/i }));
      const heading = screen.getByRole("heading", { name: "Is it still here?" });
      await waitFor(() => expect(heading).toHaveFocus());
    };

    it("restores the toilet and updates the panel on 200", async () => {
      const user = userEvent.setup();
      const restored = { ...toilet, updatedAt: "2026-11-17T10:00:00.000Z" };
      fetchMock.mockResolvedValue(
        jsonResponse(200, { ...restored, compressed: [ID, "gcpvj0", 1] }),
      );
      render(<ToiletDetailsPanel toilet={removedToilet} onClose={noop} />);

      await openPrompt(user);
      await user.type(screen.getByLabelText("Anything we should know? (optional)"), "Open today");
      await user.click(screen.getByRole("button", { name: "Restore it" }));

      expect(await screen.findByText(RESTORED_MESSAGE)).toBeInTheDocument();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/loos/${ID}/restore`);
      expect(JSON.parse(init.body as string)).toEqual({
        details: "Open today",
        baseUpdatedAt: removedToilet.updatedAt,
      });
      expect(screen.queryByText(/Removed from the map/)).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: /directions/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Yes, it's still here" })).toBeInTheDocument();
    });

    it("says a moderator will review on 202 and remembers the suggestion", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(202, { queued: true, id: "pending-9" }));
      render(<ToiletDetailsPanel toilet={removedToilet} onClose={noop} />);

      await openPrompt(user);
      await user.click(screen.getByRole("button", { name: "Restore it" }));

      expect(await screen.findByText(RESTORE_QUEUED_MESSAGE)).toBeInTheDocument();
      const stored = JSON.parse(localStorage.getItem(`${PENDING_KEY_PREFIX}${ID}`) ?? "null");
      expect(stored).toMatchObject({ kind: "restore", pendingId: "pending-9" });
      // Still removed until a moderator acts; no second restore button.
      expect(screen.getByText(/Removed from the map/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /ask to restore/i })).not.toBeInTheDocument();
    });

    it("says a moderator will review when a restore expected to apply is queued", async () => {
      // A user blocked in Auth0 looks signed in to the client; the API queues their restore.
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(202, { queued: true, id: "pending-blocked" }));
      render(<ToiletDetailsPanel toilet={removedToilet} onClose={noop} canWriteDirectly />);

      await openPrompt(user);
      await user.click(screen.getByRole("button", { name: "Restore it" }));

      expect(await screen.findByText(RESTORE_QUEUED_MESSAGE)).toBeInTheDocument();
      expect(screen.getByText(/Removed from the map/)).toBeInTheDocument();
    });

    it("keeps the prompt open with an error when the request fails", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(500, { message: "Database unavailable" }));
      render(<ToiletDetailsPanel toilet={removedToilet} onClose={noop} />);
      await openPrompt(user);
      await user.click(screen.getByRole("button", { name: "Restore it" }));
      expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Restore it" })).toBeEnabled();
    });

    it("offers a reload on a conflict", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(409, { error: "conflict", current: toilet }));
      render(<ToiletDetailsPanel toilet={removedToilet} onClose={noop} />);
      await openPrompt(user);
      await user.click(screen.getByRole("button", { name: "Restore it" }));
      expect(await screen.findByText(/Someone else changed this toilet/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    });

    it("can be cancelled", async () => {
      const user = userEvent.setup();
      render(<ToiletDetailsPanel toilet={removedToilet} onClose={noop} />);
      await openPrompt(user);
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("heading", { name: "Is it still here?" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /ask to restore/i })).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("opens the prompt from ?restore=1 and strips the parameter", async () => {
      history.replaceState(null, "", `/loos/${ID}?restore=1&x=2`);
      render(<ToiletDetailsPanel toilet={removedToilet} onClose={noop} />);
      const heading = await screen.findByRole("heading", { name: "Is it still here?" });
      await waitFor(() => expect(heading).toHaveFocus());
      expect(`${location.pathname}${location.search}`).toBe(`/loos/${ID}?x=2`);
    });

    it("ignores ?restore=1 for a toilet that is on the map", () => {
      history.replaceState(null, "", `/loos/${ID}?restore=1`);
      render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
      expect(screen.queryByRole("heading", { name: "Is it still here?" })).not.toBeInTheDocument();
      expect(location.search).toBe("");
    });
  });

  describe("pending suggestion", () => {
    it("shows the awaiting-review notice for a recent suggestion", () => {
      localStorage.setItem(
        `${PENDING_KEY_PREFIX}${ID}`,
        JSON.stringify({ kind: "edit", pendingId: "p1", at: new Date().toISOString() }),
      );
      render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
      expect(screen.getByText(PENDING_MESSAGE).closest('[role="status"]')).not.toBeNull();
    });

    it("ignores a suggestion older than 30 days", () => {
      localStorage.setItem(
        `${PENDING_KEY_PREFIX}${ID}`,
        JSON.stringify({
          kind: "edit",
          pendingId: "p1",
          at: new Date(Date.now() - PENDING_TTL_MS - 1000).toISOString(),
        }),
      );
      render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
      expect(screen.queryByText(PENDING_MESSAGE)).not.toBeInTheDocument();
    });

    it("ignores suggestions for other toilets", () => {
      localStorage.setItem(
        `${PENDING_KEY_PREFIX}${DUP}`,
        JSON.stringify({ kind: "edit", pendingId: "p1", at: new Date().toISOString() }),
      );
      render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
      expect(screen.queryByText(PENDING_MESSAGE)).not.toBeInTheDocument();
    });
  });

  describe("opening hours", () => {
    const weekdays: LooDetail["openingTimes"] = [
      ["09:00", "17:00"],
      ["09:00", "17:00"],
      ["09:00", "17:00"],
      ["09:00", "17:00"],
      ["09:00", "17:00"],
      ["10:00", "16:00"],
      [],
    ];

    afterEach(() => {
      vi.useRealTimers();
    });

    it("summarises the hours, formats each day and says whether it is open now", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      // Tuesday 17 Nov 2026, 10:30 in London (GMT).
      vi.setSystemTime(new Date("2026-11-17T10:30:00Z"));
      const { container } = render(
        <ToiletDetailsPanel toilet={{ ...toilet, openingTimes: weekdays }} onClose={noop} />,
      );
      expect(screen.getByText("Mon–Fri 9am–5pm · Sat 10am–4pm · Sun closed")).toBeInTheDocument();
      expect(screen.getByTestId("open-now")).toHaveTextContent("Open now · closes 5pm");
      const rows = Array.from(container.querySelectorAll("li")).map((li) => li.textContent);
      expect(rows).toContain("Tuesday9am–5pm");
      expect(rows).toContain("Sunday" + "Closed");
    });

    it("says when a closed toilet opens next", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      // Sunday 22 Nov 2026, midday: closed, opens Monday.
      vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
      render(<ToiletDetailsPanel toilet={{ ...toilet, openingTimes: weekdays }} onClose={noop} />);
      expect(screen.getByTestId("open-now")).toHaveTextContent("Closed now · opens 9am tomorrow");
    });

    it("shows 24-hour days and no open-now line when the hours are unknown", () => {
      const { unmount } = render(
        <ToiletDetailsPanel
          toilet={{ ...toilet, openingTimes: Array.from({ length: 7 }, () => ["00:00", "00:00"]) }}
          onClose={noop}
        />,
      );
      expect(screen.getByText("Open 24 hours, every day")).toBeInTheDocument();
      expect(screen.getAllByText("Open 24 hours")).toHaveLength(7);
      unmount();
      render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
      expect(screen.getByText("Opening hours not known")).toBeInTheDocument();
      expect(screen.queryByTestId("open-now")).not.toBeInTheDocument();
    });

    it("has no open-now line for a removed toilet", () => {
      render(
        <ToiletDetailsPanel toilet={{ ...removedToilet, openingTimes: weekdays }} onClose={noop} />,
      );
      expect(screen.queryByTestId("open-now")).not.toBeInTheDocument();
    });
  });
});
