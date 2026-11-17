import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLooDetailCache, type LooDetail, primeLooDetail } from "../../api/loos";
import { PENDING_KEY_PREFIX, PENDING_TTL_MS } from "../../api/reports";
import ToiletDetailsPanel, {
  PENDING_MESSAGE,
  REMOVED_MESSAGE,
  RESTORE_BUTTON_LABEL,
  RESTORE_NOW_BUTTON_LABEL,
  RESTORE_QUEUED_MESSAGE,
  RESTORED_MESSAGE,
  removalSummary,
  SAVED_MESSAGE,
  type ToiletDetailsPanelProps,
  VERIFIED_MESSAGE,
  VERIFY_LABEL,
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

const weekdays: LooDetail["openingTimes"] = [
  ["09:00", "17:00"],
  ["09:00", "17:00"],
  ["09:00", "17:00"],
  ["09:00", "17:00"],
  ["09:00", "17:00"],
  ["10:00", "16:00"],
  [],
];

const noop = () => undefined;

/** Text without the icons' (aria-hidden) SVG titles. */
const visibleText = (el: Element | null | undefined) => {
  if (!el) return "";
  const copy = el.cloneNode(true) as Element;
  for (const svg of Array.from(copy.querySelectorAll("svg"))) svg.remove();
  return copy.textContent ?? "";
};
const editLinks = () => screen.queryAllByRole("link", { name: /edit/i });
const restoreButton = () =>
  screen.getByRole("button", { name: /^It's still here — (ask to restore|restore it)$/ });
const VERIFY_PROMPT = "Still here?";
const detailsToggle = () => screen.getByRole("button", { name: "Details" });

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

/** Desktop (card) or mobile (sheet): stubs the ≥768px media query. */
function setViewport(kind: "card" | "sheet") {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("min-width: 768px") ? kind === "card" : false,
      media: query,
      addEventListener: noop,
      removeEventListener: noop,
    })),
  );
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;

/** Renders the panel with its details open (where the Phase 3 actions live). */
const renderExpanded = (props: Partial<ToiletDetailsPanelProps> = {}) =>
  render(<ToiletDetailsPanel toilet={toilet} onClose={noop} initialExpanded {...props} />);

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  setViewport("card");
  clearLooDetailCache();
  history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ToiletDetailsPanel", () => {
  describe("summary", () => {
    it("opens as the compact summary, with no notices by default", () => {
      render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
      expect(screen.getByRole("heading", { level: 2, name: "High Street toilets" })).toBeVisible();
      expect(screen.getByRole("link", { name: /directions/i })).toBeInTheDocument();
      expect(detailsToggle()).toHaveAttribute("aria-expanded", "false");
      // The details aren't rendered until asked for.
      expect(screen.queryByText(VERIFY_PROMPT)).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /opening hours/i })).not.toBeInTheDocument();
      expect(screen.queryByText(SAVED_MESSAGE)).not.toBeInTheDocument();
      expect(screen.queryByText(new RegExp(REMOVED_MESSAGE))).not.toBeInTheDocument();
      expect(screen.queryByText(PENDING_MESSAGE)).not.toBeInTheDocument();
      expect(screen.queryAllByRole("status")).toHaveLength(0);
    });

    it("is a region named by its heading", () => {
      render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
      const region = screen.getByRole("region", { name: "High Street toilets" });
      expect(region).toHaveClass("toilet-panel");
    });

    it("names an unnamed toilet", () => {
      render(<ToiletDetailsPanel toilet={{ ...toilet, name: "  " }} onClose={noop} />);
      expect(screen.getByRole("heading", { level: 2, name: "Toilet" })).toBeInTheDocument();
    });

    it("shows the key features as named icons, all-gender as the toilet icon", () => {
      render(
        <ToiletDetailsPanel
          toilet={{ ...toilet, babyChange: true, radar: true, allGender: true }}
          onClose={noop}
        />,
      );
      const list = screen.getByRole("list", { name: "Key features" });
      const icons = within(list)
        .getAllByRole("img")
        .map((img) => [
          img.getAttribute("aria-label"),
          img.querySelector("use")?.getAttribute("href"),
        ]);
      expect(icons).toEqual([
        ["Accessible", "/sprites/solid.svg#wheelchair-move"],
        ["Baby changing", "/sprites/solid.svg#baby"],
        ["RADAR key", "/sprites/solid.svg#key"],
        // Not the women's icon (person-dress).
        ["All-gender", "/sprites/solid.svg#toilet"],
      ]);
    });

    it.each([
      [{ noPayment: true }, "Free"],
      [{ noPayment: false, paymentDetails: null }, "Paid"],
      [{ noPayment: false, paymentDetails: " 20p " }, "Paid: 20p"],
    ] as const)("shows payment %j as a text chip, not an icon", (fields, text) => {
      render(<ToiletDetailsPanel toilet={{ ...toilet, ...fields }} onClose={noop} />);
      const chip = screen.getByTestId("payment");
      expect(chip).toHaveTextContent(new RegExp(`^${text}$`));
      expect(chip.parentElement).toBe(screen.getByTestId("open-now").parentElement);
      // The same £ icon used to mean both free and paid.
      expect(document.querySelector('use[href$="#sterling-sign"]')).toBeNull();
    });

    it("leaves the payment chip out when it isn't known, or the toilet is removed", () => {
      const { unmount } = render(
        <ToiletDetailsPanel toilet={{ ...toilet, noPayment: null }} onClose={noop} />,
      );
      expect(screen.queryByTestId("payment")).toBeNull();
      unmount();
      render(<ToiletDetailsPanel toilet={removedToilet} onClose={noop} />);
      expect(screen.queryByTestId("payment")).toBeNull();
    });

    it("keeps the key features on the open-now line, so the summary stays short", () => {
      render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
      const list = screen.getByRole("list", { name: "Key features" });
      expect(list.parentElement).toBe(screen.getByTestId("open-now").parentElement);
    });

    it("leaves out unknown features (and the list when there are none)", () => {
      render(
        <ToiletDetailsPanel
          toilet={{ ...toilet, accessible: false, noPayment: null }}
          onClose={noop}
        />,
      );
      expect(screen.queryByRole("list", { name: "Key features" })).not.toBeInTheDocument();
    });

    it("shows the distance when the viewer's location is known", () => {
      const { rerender } = render(
        <ToiletDetailsPanel
          toilet={toilet}
          onClose={noop}
          userLocation={{ lat: 51.5, lng: -0.145 }}
        />,
      );
      expect(screen.getByText("350 m away")).toBeInTheDocument();
      rerender(<ToiletDetailsPanel toilet={toilet} onClose={noop} userLocation={null} />);
      expect(screen.queryByText(/away$/)).not.toBeInTheDocument();
    });

    it.each([
      ["Tuesday 10:30, open", "2026-11-17T10:30:00Z", weekdays, "Open now · closes 5pm", "open"],
      ["Sunday, closed", "2026-11-22T12:00:00Z", weekdays, "Closed · opens 9am tomorrow", "closed"],
      [
        "Tuesday 08:00, opens later",
        "2026-11-17T08:00:00Z",
        weekdays,
        "Closed · opens 9am",
        "closed",
      ],
      [
        "open 24 hours",
        "2026-11-17T03:00:00Z",
        Array.from({ length: 7 }, () => ["00:00", "00:00"]),
        "Open 24 hours",
        "open",
      ],
      [
        "overnight, after midnight",
        "2026-11-18T01:00:00Z",
        Array.from({ length: 7 }, () => ["18:00", "02:00"]),
        "Open now · closes 2am",
        "open",
      ],
      ["hours unknown", "2026-11-17T10:30:00Z", null, "Hours not known", "unknown"],
    ] as const)("status chip: %s", (_label, now, openingTimes, text, tone) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(now));
      render(
        <ToiletDetailsPanel
          toilet={{ ...toilet, openingTimes: openingTimes as LooDetail["openingTimes"] }}
          onClose={noop}
        />,
      );
      const chip = screen.getByTestId("open-now");
      expect(chip).toHaveTextContent(text);
      expect(chip).toHaveAttribute("data-tone", tone);
    });

    describe("directions", () => {
      const stubPlatform = (userAgent: string, platform: string) => {
        vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
        vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      };

      it("opens Apple Maps on an iPhone, in a new tab", () => {
        stubPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "iPhone");
        render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
        const link = screen.getByRole("link", { name: /directions/i });
        expect(link).toHaveAttribute("href", "https://maps.apple.com/?daddr=51.5,-0.14&dirflg=w");
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
      });

      it("opens Google Maps on Android", () => {
        stubPlatform("Mozilla/5.0 (Linux; Android 15; Pixel 7)", "Linux armv81");
        render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
        expect(screen.getByRole("link", { name: /directions/i })).toHaveAttribute(
          "href",
          "https://www.google.com/maps/dir/?api=1&destination=51.5,-0.14&travelmode=walking",
        );
      });

      it("is left out for a toilet with no location", () => {
        render(<ToiletDetailsPanel toilet={{ ...toilet, location: null }} onClose={noop} />);
        expect(screen.queryByRole("link", { name: /directions/i })).not.toBeInTheDocument();
      });
    });
  });

  describe("expand, collapse and close", () => {
    it("Details expands and collapses the rest", async () => {
      const user = userEvent.setup();
      render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
      await user.click(detailsToggle());
      expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
      const detailsId = detailsToggle().getAttribute("aria-controls");
      expect(detailsId).toBeTruthy();
      expect(document.getElementById(detailsId ?? "")).toContainElement(
        screen.getByText(VERIFY_PROMPT),
      );
      await user.click(detailsToggle());
      expect(detailsToggle()).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText(VERIFY_PROMPT)).not.toBeInTheDocument();
    });

    it.each(["card", "sheet"] as const)(
      "the X closes in one tap, even with the details open (%s)",
      async (kind) => {
        setViewport(kind);
        const user = userEvent.setup();
        const onClose = vi.fn();
        renderExpanded({ onClose });
        expect(screen.queryByRole("button", { name: "Close details" })).toBeNull();
        await user.click(screen.getByRole("button", { name: "Close" }));
        expect(onClose).toHaveBeenCalledTimes(1);
      },
    );

    it("Escape inside the panel collapses, then closes, and stays out of page handlers", () => {
      const onClose = vi.fn();
      const onWindowKey = vi.fn();
      window.addEventListener("keydown", onWindowKey);
      renderExpanded({ onClose });
      const heading = screen.getByRole("heading", { level: 2 });
      fireEvent.keyDown(heading, { key: "Escape" });
      expect(detailsToggle()).toHaveAttribute("aria-expanded", "false");
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.keyDown(heading, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
      window.removeEventListener("keydown", onWindowKey);
      expect(onWindowKey).not.toHaveBeenCalled();
    });

    it("ignores Escape outside the panel", () => {
      const onClose = vi.fn();
      renderExpanded({ onClose });
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
      expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
    });

    it("keeps focus on the Details toggle when collapsing from inside the details", () => {
      renderExpanded();
      const edit = screen.getByRole("link", { name: /suggest an edit/i });
      edit.focus();
      fireEvent.keyDown(edit, { key: "Escape" });
      expect(detailsToggle()).toHaveFocus();
    });
  });

  describe("focus", () => {
    it("moves focus to the heading on open", async () => {
      render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
      await waitFor(() => expect(screen.getByRole("heading", { level: 2 })).toHaveFocus());
    });

    it("returns focus to the opener on close", async () => {
      const user = userEvent.setup();
      const opener = document.createElement("button");
      document.body.appendChild(opener);
      render(<ToiletDetailsPanel toilet={toilet} onClose={noop} returnFocusTo={opener} />);
      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(opener).toHaveFocus();
      opener.remove();
    });

    it("falls back to the search input, also when closed from outside", async () => {
      const search = document.createElement("input");
      search.type = "search";
      document.body.appendChild(search);
      const { unmount } = render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
      await waitFor(() => expect(screen.getByRole("heading", { level: 2 })).toHaveFocus());
      unmount();
      expect(search).toHaveFocus();
      search.remove();
    });
  });

  describe("mobile bottom sheet", () => {
    beforeEach(() => setViewport("sheet"));

    it("renders as a non-modal sheet with a handle that toggles the details", async () => {
      const user = userEvent.setup();
      const { container } = render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
      const region = screen.getByRole("region", { name: "High Street toilets" });
      expect(region).toHaveClass("bottom-sheet", "toilet-panel");
      expect(region).toHaveAttribute("data-state", "peek");
      expect(container.querySelector('[aria-modal="true"]')).toBeNull();
      const handle = screen.getByRole("button", { name: "Toilet details" });
      expect(handle).toHaveAttribute("aria-expanded", "false");
      await user.click(handle);
      expect(region).toHaveAttribute("data-state", "expanded");
      expect(handle).toHaveAttribute("aria-expanded", "true");
      expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText(VERIFY_PROMPT)).toBeInTheDocument();
    });

    it("keeps the summary a direct child of the scrolling body, so it can stay pinned", () => {
      const { container } = renderExpanded();
      const region = screen.getByRole("region", { name: "High Street toilets" });
      expect(region).toHaveAttribute("data-state", "expanded");
      const body = container.querySelector(".bottom-sheet__body") as HTMLElement;
      const heading = screen.getByRole("heading", { level: 2 });
      const summary = Array.from(body.children).find((child) => child.contains(heading));
      expect(summary).toBeDefined();
      // The X and Directions are in it, above the details.
      expect(summary).toContainElement(screen.getByRole("button", { name: "Close" }));
      expect(summary).toContainElement(screen.getByRole("link", { name: /directions/i }));
      expect(summary).not.toContainElement(screen.getByText(VERIFY_PROMPT));
    });

    it("pads the scroller by the pinned summary's height while expanded, following its size", async () => {
      const observers: Array<{ callback: ResizeObserverCallback; targets: Element[] }> = [];
      vi.stubGlobal(
        "ResizeObserver",
        class {
          targets: Element[] = [];
          constructor(callback: ResizeObserverCallback) {
            observers.push({ callback, targets: this.targets });
          }
          observe(el: Element) {
            this.targets.push(el);
          }
          unobserve() {
            // Not used.
          }
          disconnect() {
            this.targets.length = 0;
          }
        },
      );
      let summaryHeight = 132;
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.contains(screen.queryByRole("heading", { level: 2 })) &&
          !this.classList.contains("bottom-sheet") &&
          !this.classList.contains("bottom-sheet__body")
          ? summaryHeight
          : 0;
      });
      const user = userEvent.setup();
      render(<ToiletDetailsPanel toilet={toilet} onClose={noop} />);
      const region = screen.getByRole("region", { name: "High Street toilets" });
      // At peek the summary isn't pinned: nothing to pad.
      expect(region.style.getPropertyValue("--panel-summary-height")).toBe("");

      await user.click(detailsToggle());
      expect(region).toHaveAttribute("data-state", "expanded");
      expect(region.style.getPropertyValue("--panel-summary-height")).toBe("132px");

      // A notice or a wrapped name makes it taller: the padding follows.
      summaryHeight = 180;
      const summary = observers
        .flatMap((o) => o.targets)
        .find((t) => t.contains(region.querySelector("h2")));
      expect(summary).toBeDefined();
      for (const o of observers) o.callback([], {} as ResizeObserver);
      expect(region.style.getPropertyValue("--panel-summary-height")).toBe("180px");

      await user.click(detailsToggle());
      expect(region.style.getPropertyValue("--panel-summary-height")).toBe("");
    });

    it("Escape collapses expanded → peek → closes", () => {
      const onClose = vi.fn();
      renderExpanded({ onClose });
      const heading = screen.getByRole("heading", { level: 2 });
      fireEvent.keyDown(heading, { key: "Escape" });
      expect(screen.getByRole("region")).toHaveAttribute("data-state", "peek");
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.keyDown(heading, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("Phase 3 behaviour", () => {
    it("shows a dismissible saved notice as a status message in the summary", async () => {
      const user = userEvent.setup();
      const onDismiss = vi.fn();
      render(
        <ToiletDetailsPanel toilet={toilet} onClose={noop} saved onDismissSaved={onDismiss} />,
      );
      const status = screen.getByText(SAVED_MESSAGE).closest('[role="status"]');
      expect(status).not.toBeNull();
      await user.click(screen.getByRole("button", { name: "Dismiss message" }));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("shows the removed state and hides directions and edit actions", () => {
      renderExpanded({ removed: true, saved: true });
      const status = screen.getByText(new RegExp(REMOVED_MESSAGE)).closest('[role="status"]');
      expect(status).not.toBeNull();
      // The saved notice is superseded by the removed state.
      expect(screen.queryByText(SAVED_MESSAGE)).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /directions/i })).not.toBeInTheDocument();
      expect(editLinks()).toHaveLength(0);
      expect(screen.queryByRole("link", { name: /report a problem/i })).not.toBeInTheDocument();
      expect(screen.queryByText(VERIFY_PROMPT)).not.toBeInTheDocument();
      expect(screen.queryByTestId("open-now")).not.toBeInTheDocument();
      // Without the removed record there's nothing to restore from here.
      expect(screen.queryByRole("button", { name: /ask to restore/i })).not.toBeInTheDocument();
      // Still closable.
      expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
    });

    it("renders a custom notice slot (e.g. offline) in the summary", () => {
      render(<ToiletDetailsPanel toilet={toilet} onClose={noop} notice={<p>You're offline</p>} />);
      expect(screen.getByText("You're offline")).toBeInTheDocument();
    });

    it("links to suggest an edit and to report a problem", () => {
      renderExpanded();
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
        renderExpanded();
        expect(screen.getByText("Last updated: 1 November 2026")).toBeInTheDocument();
      });

      it("shows the verified date when it is more recent than the last update", () => {
        renderExpanded({ toilet: { ...toilet, verifiedAt: "2026-11-05T10:00:00.000Z" } });
        expect(screen.getByText("Last verified: 5 November 2026")).toBeInTheDocument();
        expect(screen.queryByText(/^Last updated/)).toBeNull();
      });

      it("shows a later edit instead of an older verification", () => {
        renderExpanded({ toilet: { ...toilet, verifiedAt: "2025-10-05T10:00:00.000Z" } });
        expect(screen.getByText("Last updated: 1 November 2026")).toBeInTheDocument();
        expect(screen.queryByText(/^Last verified/)).toBeNull();
      });
    });

    it('asks "Still here?" with a compact secondary Yes, so Directions is the one primary action', () => {
      const { container } = renderExpanded();
      const yes = screen.getByRole("button", { name: VERIFY_LABEL });
      expect(visibleText(yes)).toBe("Yes");
      expect(yes).toHaveClass("button", "button--secondary");
      expect(screen.getByText(VERIFY_PROMPT).parentElement).toBe(yes.parentElement);
      const primary = Array.from(container.querySelectorAll(".button")).filter(
        (el) => !el.classList.contains("button--secondary"),
      );
      expect(primary.map((el) => visibleText(el).trim())).toEqual(["Directions"]);
    });

    it("offers Suggest an edit and Report a problem as one row of text actions", () => {
      renderExpanded();
      const edit = screen.getByRole("link", { name: "Suggest an edit" });
      const report = screen.getByRole("link", { name: "Report a problem" });
      expect(edit.parentElement).toBe(report.parentElement);
      expect(edit).not.toHaveClass("button");
      expect(report).not.toHaveClass("button");
    });

    it("has no second, tiny edit link under the hours", () => {
      renderExpanded({ toilet: { ...toilet, openingTimes: weekdays } });
      expect(screen.getByText("Hours may vary on bank holidays.").querySelector("a")).toBeNull();
      expect(screen.queryByRole("link", { name: "Edit this toilet" })).toBeNull();
      expect(screen.getAllByRole("link", { name: /edit/i })).toHaveLength(1);
    });

    describe("restore copy", () => {
      it("says a moderator will check first for someone who can't write directly", async () => {
        const user = userEvent.setup();
        render(<ToiletDetailsPanel toilet={removedToilet} onClose={noop} />);
        expect(restoreButton()).toHaveTextContent(RESTORE_BUTTON_LABEL);
        await user.click(restoreButton());
        expect(
          screen.getByText(
            "If High Street toilets is still here and open to the public, tell us and a moderator will check before it goes back on the map.",
          ),
        ).toBeInTheDocument();
      });

      it("says it goes back straight away for a trusted user", async () => {
        const user = userEvent.setup();
        render(<ToiletDetailsPanel toilet={removedToilet} onClose={noop} canWriteDirectly />);
        // Not "ask to": a trusted restore goes live at once.
        expect(restoreButton()).toHaveTextContent(RESTORE_NOW_BUTTON_LABEL);
        expect(screen.queryByRole("button", { name: /ask to restore/i })).toBeNull();
        await user.click(restoreButton());
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
        renderExpanded();

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

      it("keeps the verification across collapsing and expanding", async () => {
        const user = userEvent.setup();
        fetchMock.mockResolvedValue(
          jsonResponse(200, { id: ID, verifiedAt: "2026-11-17T09:30:00.000Z" }),
        );
        renderExpanded();
        await user.click(screen.getByRole("button", { name: "Yes, it's still here" }));
        await screen.findByText(VERIFIED_MESSAGE);
        await user.click(detailsToggle());
        await user.click(detailsToggle());
        expect(screen.getByText("Last verified: 17 November 2026")).toBeInTheDocument();
      });

      it("explains a rate limit and keeps the button", async () => {
        const user = userEvent.setup();
        fetchMock.mockResolvedValue(jsonResponse(429, { message: "Too many requests" }));
        renderExpanded();
        await user.click(screen.getByRole("button", { name: "Yes, it's still here" }));
        expect(await screen.findByText(/a lot in a short time/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Yes, it's still here" })).toBeEnabled();
      });

      it("says when the toilet has been removed meanwhile", async () => {
        const user = userEvent.setup();
        fetchMock.mockResolvedValue(jsonResponse(409, { error: "removed" }));
        renderExpanded();
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
        expect(
          removalSummary({ ...removedToilet, removalCategory: null, removalReason: " " }),
        ).toBe(null);
      });

      it("shows an inactive toilet as removed in the summary, with a restore action", () => {
        render(<ToiletDetailsPanel toilet={removedToilet} onClose={noop} />);
        const notice = screen.getByText(
          "Removed from the map: Permanently closed or demolished — Demolished in October",
        );
        expect(notice.closest('[role="status"]')).not.toBeNull();
        expect(screen.queryByRole("link", { name: /directions/i })).not.toBeInTheDocument();
        expect(editLinks()).toHaveLength(0);
        expect(
          screen.queryByRole("button", { name: "Yes, it's still here" }),
        ).not.toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: /it's still here — ask to restore/i }),
        ).toBeVisible();
      });

      it("has no edit links in its details either", () => {
        renderExpanded({ toilet: removedToilet });
        expect(editLinks()).toHaveLength(0);
        expect(screen.queryByText(VERIFY_PROMPT)).not.toBeInTheDocument();
      });

      it("falls back to the generic message without a recorded reason", () => {
        render(
          <ToiletDetailsPanel
            toilet={{ ...toilet, active: false, removalCategory: null, removalReason: null }}
            onClose={noop}
          />,
        );
        expect(screen.getByText(`${REMOVED_MESSAGE}.`)).toBeInTheDocument();
        expect(restoreButton()).toBeInTheDocument();
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
        expect(restoreButton()).toBeInTheDocument();
      });
    });

    describe("restore", () => {
      const openPrompt = async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(restoreButton());
        const heading = screen.getByRole("heading", { name: "Is it still here?" });
        await waitFor(() => expect(heading).toHaveFocus());
      };

      it("opens the prompt in the details", async () => {
        const user = userEvent.setup();
        render(<ToiletDetailsPanel toilet={removedToilet} onClose={noop} />);
        await openPrompt(user);
        expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
      });

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
        await waitFor(() =>
          expect(screen.getByText(RESTORED_MESSAGE).closest('[role="status"]')).toHaveFocus(),
        );
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

      it("can be cancelled, returning focus to its trigger", async () => {
        const user = userEvent.setup();
        render(<ToiletDetailsPanel toilet={removedToilet} onClose={noop} />);
        await openPrompt(user);
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        expect(
          screen.queryByRole("heading", { name: "Is it still here?" }),
        ).not.toBeInTheDocument();
        await waitFor(() => expect(restoreButton()).toHaveFocus());
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
        expect(
          screen.queryByRole("heading", { name: "Is it still here?" }),
        ).not.toBeInTheDocument();
        expect(detailsToggle()).toHaveAttribute("aria-expanded", "false");
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
  });

  describe("details", () => {
    it("lists a varied week as Mon–Sun rows (no repeated summary), highlighting today (London)", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      // Tuesday 17 Nov 2026, 10:30 in London (GMT).
      vi.setSystemTime(new Date("2026-11-17T10:30:00Z"));
      const { container } = renderExpanded({ toilet: { ...toilet, openingTimes: weekdays } });
      // The table says it; the week's summary sentence isn't repeated above it.
      expect(screen.queryByText("Mon–Fri 9am–5pm · Sat 10am–4pm · Sun closed")).toBeNull();
      const table = screen.getByRole("table");
      const rows = within(table)
        .getAllByRole("row")
        .map((row) => {
          const [th, td] = Array.from(row.children);
          return `${th.querySelector('[aria-hidden="true"]')?.textContent} ${td.textContent}`;
        });
      expect(rows).toEqual([
        "Mon 9am–5pm",
        "Tue 9am–5pm",
        "Wed 9am–5pm",
        "Thu 9am–5pm",
        "Fri 9am–5pm",
        "Sat 10am–4pm",
        "Sun Closed",
      ]);
      // Screen readers get the full day name, and which one is today.
      expect(within(table).getByRole("rowheader", { name: "Tuesday (today)" })).toBeInTheDocument();
      expect(within(table).getByRole("rowheader", { name: "Monday" })).toBeInTheDocument();
      const today = container.querySelector('tr[aria-current="date"]');
      expect(today?.textContent).toContain("Tuesday");
      expect(container.querySelectorAll('tr[aria-current="date"]')).toHaveLength(1);
      // No extra "Today" pill: the highlight and aria-current say it.
      expect(screen.queryByText("Today")).toBeNull();
    });

    it("uses the London day near midnight UTC in summer", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      // 23:30 UTC on Monday 6 July 2026 is 00:30 on Tuesday in London (BST).
      vi.setSystemTime(new Date("2026-07-06T23:30:00Z"));
      const { container } = renderExpanded({ toilet: { ...toilet, openingTimes: weekdays } });
      expect(container.querySelector('tr[aria-current="date"]')?.textContent).toContain("Tuesday");
    });

    it.each([
      ["24 hours", Array.from({ length: 7 }, () => ["00:00", "00:00"]), "Open 24 hours, every day"],
      ["the same hours", Array.from({ length: 7 }, () => ["09:00", "17:00"]), "Every day 9am–5pm"],
      ["closed", Array.from({ length: 7 }, () => []), "Closed every day"],
    ])("says a uniform week (%s) in one sentence, without the table", (_l, openingTimes, text) => {
      renderExpanded({
        toilet: { ...toilet, openingTimes: openingTimes as LooDetail["openingTimes"] },
      });
      const hours = screen.getByRole("heading", { name: /opening hours/i }).closest("section");
      expect(within(hours as HTMLElement).getByText(text)).toBeInTheDocument();
      expect(screen.queryByRole("table")).toBeNull();
    });

    it("says when the hours aren't known", () => {
      renderExpanded();
      expect(screen.getByText("Opening hours not known")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.queryByText("Hours may vary on bank holidays.")).toBeNull();
      expect(screen.getByTestId("open-now")).toHaveTextContent("Hours not known");
    });

    const facilitiesSection = () => {
      const section = screen.getByRole("heading", { name: "Facilities" }).closest("section");
      if (!section) throw new Error("no facilities section");
      return section as HTMLElement;
    };

    it("lists known facilities as icon rows, with Yes / No for screen readers only", () => {
      const { unmount } = renderExpanded();
      const section = facilitiesSection();
      const rows = Array.from(section.querySelectorAll("dt")).map(
        (dt) => `${visibleText(dt)}: ${visibleText(dt.nextElementSibling)}`,
      );
      expect(rows).toEqual([
        "Accessible: Yes",
        "Men: Yes",
        "Women: Yes",
        "Baby changing: No",
        "Payment: Free",
      ]);
      // The answer is a check or a cross; its words are visually hidden.
      const babyChange = Array.from(section.querySelectorAll("dt")).find((dt) =>
        dt.textContent?.includes("Baby changing"),
      )?.nextElementSibling as HTMLElement;
      expect(babyChange.querySelector("use")?.getAttribute("href")).toBe(
        "/sprites/solid.svg#xmark",
      );
      expect(within(babyChange).getByText("No").className).toMatch(/visuallyHidden/);
      // All-gender is the toilet icon here too.
      unmount();
      renderExpanded({ toilet: { ...toilet, allGender: true } });
      const allGender = within(facilitiesSection()).getByText("All-gender").closest("dt");
      expect(allGender?.querySelector("use")?.getAttribute("href")).toBe(
        "/sprites/solid.svg#toilet",
      );
    });

    it("collapses the unknown facilities into one line, with a link to add them", () => {
      renderExpanded({ toilet: { ...toilet, noPayment: null } });
      const section = facilitiesSection();
      expect(
        within(section).getByText(
          /^Not known: All-gender, Children, RADAR key, Automatic, Payment\./,
        ),
      ).toBeInTheDocument();
      expect(within(section).queryByText(/Don't know/)).toBeNull();
      expect(within(section).getByRole("link", { name: "Add what you know" })).toHaveAttribute(
        "href",
        `/loos/${ID}/edit`,
      );
    });

    it("says so when no facilities are known, and offers no edit link for a removed toilet", () => {
      const unknown = {
        accessible: null,
        allGender: null,
        men: null,
        women: null,
        children: null,
        babyChange: null,
        radar: null,
        automatic: null,
        noPayment: null,
      };
      const { unmount } = renderExpanded({ toilet: { ...toilet, ...unknown } });
      expect(
        within(facilitiesSection()).getByText(/^Facilities not known yet\./),
      ).toBeInTheDocument();
      expect(within(facilitiesSection()).queryByRole("term")).toBeNull();
      unmount();
      renderExpanded({ toilet: { ...removedToilet, ...unknown } });
      expect(within(facilitiesSection()).queryByRole("link")).toBeNull();
    });

    it.each([
      [{ noPayment: false, paymentDetails: "20p coin" }, "Paid: 20p coin"],
      [{ noPayment: false, paymentDetails: null }, "Paid"],
      [{ noPayment: true }, "Free"],
    ] as const)("shows payment details %j", (fields, text) => {
      renderExpanded({ toilet: { ...toilet, ...fields } });
      const payment = within(facilitiesSection()).getByText("Payment").closest("div");
      expect(payment?.querySelector("dd")).toHaveTextContent(text);
    });

    it("shows notes with their line breaks", () => {
      renderExpanded({
        toilet: { ...toilet, notes: "  Key from the café\nClosed on match days " },
      });
      const notes = screen.getByText(/Key from the café/);
      expect(notes.tagName).toBe("P");
      expect(notes.textContent).toBe("Key from the café\nClosed on match days");
      expect(screen.getByRole("heading", { name: "Notes" })).toBeInTheDocument();
    });

    it("leaves out empty notes", () => {
      renderExpanded({ toilet: { ...toilet, notes: "   " } });
      expect(screen.queryByRole("heading", { name: "Notes" })).not.toBeInTheDocument();
    });
  });
});
