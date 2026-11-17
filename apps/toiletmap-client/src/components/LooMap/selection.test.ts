import { describe, expect, it } from "vitest";
import type { LooDetail } from "../../api/loos";
import {
  consumeSavedParam,
  freshnessNotice,
  historyOpFor,
  idFromPath,
  initialLoadOutcome,
  interpretRefetch,
  isGoneFromMap,
  looPath,
  selectionNeedsRefresh,
} from "./selection";

type Row = [string, string, number];
const A: Row = ["aaa", "gcpvj0", 1];
const B: Row = ["bbb", "gcpvj1", 2];

const loo = (overrides: Partial<LooDetail> = {}): LooDetail =>
  ({
    id: "aaa",
    name: "A",
    location: null,
    updatedAt: null,
    active: true,
    ...overrides,
  }) as LooDetail;

describe("looPath / idFromPath", () => {
  it("round-trips a toilet id", () => {
    expect(looPath("aaa")).toBe("/loos/aaa");
    expect(idFromPath(looPath("aaa"))).toBe("aaa");
    expect(looPath(null)).toBe("/");
  });

  it("encodes and decodes unusual ids", () => {
    expect(looPath("a b")).toBe("/loos/a%20b");
    expect(idFromPath("/loos/a%20b")).toBe("a b");
  });

  it("accepts a trailing slash", () => {
    expect(idFromPath("/loos/aaa/")).toBe("aaa");
  });

  it("returns null for the root and for non-detail pages", () => {
    expect(idFromPath("/")).toBeNull();
    expect(idFromPath("/loos/add")).toBeNull();
    expect(idFromPath("/loos/aaa/edit")).toBeNull();
    expect(idFromPath("/about")).toBeNull();
    expect(idFromPath("/loos/%E0%A4%A")).toBeNull(); // malformed escape
  });
});

describe("historyOpFor", () => {
  it("pushes when opening the panel from no selection", () => {
    expect(historyOpFor(null, "aaa", "/")).toEqual({ kind: "push", url: "/loos/aaa" });
  });

  it("replaces when switching between toilets", () => {
    expect(historyOpFor("aaa", "bbb", "/loos/aaa")).toEqual({
      kind: "replace",
      url: "/loos/bbb",
    });
  });

  it("replaces when closing the panel", () => {
    expect(historyOpFor("aaa", null, "/loos/aaa")).toEqual({ kind: "replace", url: "/" });
  });

  it("does nothing when the address bar already matches (initial load, Back/Forward)", () => {
    expect(historyOpFor(null, "aaa", "/loos/aaa")).toBeNull();
    expect(historyOpFor("aaa", null, "/")).toBeNull();
    expect(historyOpFor("bbb", "aaa", "/loos/aaa")).toBeNull();
  });

  it("does nothing when a refresh keeps the same selection", () => {
    expect(historyOpFor("aaa", "aaa", "/loos/aaa")).toBeNull();
  });

  it("replaces when the address bar names a toilet whose panel never opened", () => {
    // A marker tapped while the initial /loos/aaa was still loading.
    expect(historyOpFor(null, "bbb", "/loos/aaa")).toEqual({ kind: "replace", url: "/loos/bbb" });
  });
});

describe("initialLoadOutcome", () => {
  it("selects the loaded toilet when nothing was selected meanwhile", () => {
    const detail = loo();
    expect(initialLoadOutcome("aaa", detail, false, "/loos/aaa")).toEqual({
      kind: "select",
      toilet: detail,
    });
  });

  it("is ignored when the user selected something while it loaded", () => {
    expect(initialLoadOutcome("aaa", loo(), true, "/loos/bbb")).toEqual({ kind: "ignore" });
    // Even if the URL still names the initial toilet (e.g. the panel was closed again).
    expect(initialLoadOutcome("aaa", loo(), true, "/loos/aaa")).toEqual({ kind: "ignore" });
  });

  it("is ignored when the address bar moved on (Back/Forward)", () => {
    expect(initialLoadOutcome("aaa", loo(), false, "/")).toEqual({ kind: "ignore" });
  });

  it("resets the address bar to the map when the toilet couldn't be loaded", () => {
    expect(initialLoadOutcome("aaa", null, false, "/loos/aaa")).toEqual({
      kind: "reset",
      url: "/",
    });
    expect(initialLoadOutcome("aaa", null, true, "/loos/bbb")).toEqual({ kind: "ignore" });
  });
});

describe("consumeSavedParam", () => {
  it("detects saved=1 and strips it, keeping other params and the hash", () => {
    expect(consumeSavedParam("https://x.test/loos/aaa?saved=1")).toEqual({
      saved: true,
      cleanUrl: "/loos/aaa",
    });
    expect(consumeSavedParam("https://x.test/loos/aaa?a=1&saved=1#h")).toEqual({
      saved: true,
      cleanUrl: "/loos/aaa?a=1#h",
    });
  });

  it("strips a saved param with another value without showing the banner", () => {
    expect(consumeSavedParam("https://x.test/loos/aaa?saved=0")).toEqual({
      saved: false,
      cleanUrl: "/loos/aaa",
    });
  });

  it("leaves URLs without the param alone", () => {
    expect(consumeSavedParam("https://x.test/loos/aaa?a=1")).toEqual({
      saved: false,
      cleanUrl: null,
    });
  });
});

describe("selectionNeedsRefresh", () => {
  it("is false with no selection or no data change", () => {
    const data = [A, B];
    expect(selectionNeedsRefresh(null, [A], [A, B])).toBe(false);
    expect(selectionNeedsRefresh("aaa", data, data)).toBe(false);
  });

  it("is false for the first load of map data", () => {
    expect(selectionNeedsRefresh("aaa", [], [A, B])).toBe(false);
  });

  it("revalidates on any data change when no change set is known", () => {
    // B changed, A identical: a name-only edit to A wouldn't change its row, so still revalidate.
    expect(selectionNeedsRefresh("aaa", [A, B], [A, ["bbb", "gcpvj1", 3]])).toBe(true);
    expect(selectionNeedsRefresh("aaa", [A, B], [B])).toBe(true);
  });

  it("uses the change set when one is given", () => {
    const data = [A, B];
    // Same rows (a name-only edit re-delivered by /updates): the change set still counts.
    expect(selectionNeedsRefresh("aaa", data, data, { upserted: ["aaa"] })).toBe(true);
    expect(selectionNeedsRefresh("aaa", data, data, { upserted: ["bbb"], deleted: [] })).toBe(
      false,
    );
    const next = [A, ["bbb", "gcpvj1", 3] as Row];
    expect(selectionNeedsRefresh("aaa", [A, B], next, { upserted: ["bbb"] })).toBe(false);
    expect(selectionNeedsRefresh("aaa", [A, B], next, { upserted: [A] })).toBe(true);
    expect(selectionNeedsRefresh("aaa", [A, B], [B], { deleted: ["aaa"] })).toBe(true);
  });
});

describe("isGoneFromMap", () => {
  it("is true when deleted or missing from the latest data", () => {
    expect(isGoneFromMap("aaa", [A, B], { deleted: ["aaa"] })).toBe(true);
    expect(isGoneFromMap("aaa", [B])).toBe(true);
  });

  it("is false when still on the map, or when there is no data to judge by", () => {
    expect(isGoneFromMap("aaa", [A, B])).toBe(false);
    expect(isGoneFromMap("aaa", [])).toBe(false);
  });
});

describe("interpretRefetch", () => {
  it("updates the panel with a fresh active record", () => {
    const fresh = loo({ name: "Renamed" });
    expect(interpretRefetch({ loo: fresh, fresh: true }, false)).toEqual({
      kind: "update",
      toilet: fresh,
    });
  });

  it("shows the removed state for a fresh inactive record", () => {
    expect(interpretRefetch({ loo: loo({ active: false }), fresh: true }, false)).toEqual({
      kind: "removed",
    });
  });

  it("shows the removed state for a 404", () => {
    expect(interpretRefetch({ loo: null, fresh: true }, true)).toEqual({ kind: "removed" });
    expect(interpretRefetch({ loo: null, fresh: true }, false)).toEqual({ kind: "removed" });
  });

  it("a failed fetch's stale cached copy doesn't hide that the toilet left the map", () => {
    expect(interpretRefetch({ loo: loo(), fresh: false }, true)).toEqual({ kind: "removed" });
    expect(interpretRefetch({ loo: null, fresh: false }, true)).toEqual({ kind: "removed" });
  });

  it("keeps the panel when the fetch failed but the toilet is still on the map", () => {
    expect(interpretRefetch({ loo: loo({ name: "Stale" }), fresh: false }, false)).toEqual({
      kind: "keep",
    });
    expect(interpretRefetch({ loo: null, fresh: false }, false)).toEqual({ kind: "keep" });
  });
});

describe("freshnessNotice", () => {
  it("shows nothing while fresh or loading", () => {
    expect(freshnessNotice("ok", Date.now())).toBeNull();
    expect(freshnessNotice(undefined)).toBeNull();
  });

  it("shows the offline notice", () => {
    expect(freshnessNotice("offline", Date.now())).toBe("Offline — showing saved data");
  });

  it("shows the time of the last good sync when stale", () => {
    const at = new Date(2026, 10, 17, 9, 5).getTime();
    expect(freshnessNotice("stale", at)).toBe("Couldn't refresh — showing data from 09:05");
  });

  it("falls back when the last sync time is unknown or invalid", () => {
    expect(freshnessNotice("stale", null)).toBe("Couldn't refresh — showing saved data");
    expect(freshnessNotice("stale", "not a date")).toBe("Couldn't refresh — showing saved data");
  });
});
