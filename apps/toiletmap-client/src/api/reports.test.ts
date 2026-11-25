import { clear } from "idb-keyval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLooDetailCache, type LooDetail, peekLooDetail, primeLooDetail } from "./loos";
import { type CompressedLoo, loadMapCache, resetMapCacheForTests, saveSnapshot } from "./mapCache";
import {
  clearPendingChange,
  fetchNearbyLoos,
  formatDistance,
  PENDING_KEY_PREFIX,
  PENDING_TTL_MS,
  readPendingChange,
  rememberPendingChange,
  removalCategoryLabel,
  reportLoo,
  restoreLoo,
  verifyLoo,
} from "./reports";

const ID = "0123456789abcdef01234567";
const OTHER = "fedcba9876543210fedcba98";
const ROW: CompressedLoo = [ID, "gcpvj0", 5];
const OTHER_ROW: CompressedLoo = [OTHER, "gcpvj1", 1];
const UPDATED_AT = "2026-11-17T10:00:00.000Z";

const loo = (overrides: Partial<LooDetail> = {}): LooDetail => ({
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
  ...overrides,
});

const jsonResponse = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

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

let fetchMock: ReturnType<typeof vi.fn>;

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, body: init.body ? JSON.parse(init.body as string) : undefined };
};

beforeEach(async () => {
  resetMapCacheForTests();
  await clear();
  clearLooDetailCache();
  vi.stubGlobal("localStorage", memoryStorage());
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reportLoo", () => {
  it("posts the report to the same-origin proxy with only the relevant fields", async () => {
    fetchMock.mockResolvedValue(jsonResponse(202, { queued: true, id: "p1" }));
    await reportLoo("", ID, {
      reason: "permanently_closed",
      details: "   ",
      duplicateOf: OTHER,
      baseUpdatedAt: UPDATED_AT,
    });
    const { url, init, body } = lastCall();
    expect(url).toBe(`/api/loos/${ID}/report`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    // Blank details and a duplicateOf for a non-duplicate reason are dropped.
    expect(body).toEqual({ reason: "permanently_closed", baseUpdatedAt: UPDATED_AT });
  });

  it("sends duplicateOf and trimmed details for a duplicate", async () => {
    fetchMock.mockResolvedValue(jsonResponse(202, { queued: true, id: "p1" }));
    await reportLoo("", ID, { reason: "duplicate", duplicateOf: OTHER, details: "  same one " });
    expect(lastCall().body).toEqual({
      reason: "duplicate",
      duplicateOf: OTHER,
      details: "same one",
    });
  });

  it("on 200 removes the toilet from the cached map and evicts its detail", async () => {
    await saveSnapshot([ROW, OTHER_ROW], "2026-11-17T09:00:00.000Z");
    primeLooDetail(loo());
    const removed = loo({ active: false, removalCategory: "permanently_closed" });
    fetchMock.mockResolvedValue(jsonResponse(200, { ...removed, compressed: null }));

    const outcome = await reportLoo("", ID, { reason: "permanently_closed" });

    expect(outcome).toEqual({ kind: "applied", loo: { ...removed, compressed: null } });
    const cache = await loadMapCache();
    expect(cache?.data).toEqual([OTHER_ROW]);
    expect(cache?.patched?.[ID]).toBe(UPDATED_AT);
    expect(peekLooDetail(ID)).toBeNull();
  });

  it("removes the cached row even when the 200 body lacks `compressed`", async () => {
    await saveSnapshot([ROW], "2026-11-17T09:00:00.000Z");
    fetchMock.mockResolvedValue(jsonResponse(200, loo({ active: false })));
    await reportLoo("", ID, { reason: "does_not_exist" });
    expect((await loadMapCache())?.data).toEqual([]);
  });

  it("returns queued with the pending id on 202 and leaves the cache alone", async () => {
    await saveSnapshot([ROW], "2026-11-17T09:00:00.000Z");
    primeLooDetail(loo());
    fetchMock.mockResolvedValue(jsonResponse(202, { queued: true, id: "pending-1" }));
    const outcome = await reportLoo("", ID, { reason: "not_public" });
    expect(outcome).toEqual({ kind: "queued", pendingId: "pending-1" });
    expect((await loadMapCache())?.data).toEqual([ROW]);
    expect(peekLooDetail(ID)).not.toBeNull();
  });

  it.each([
    [409, { error: "already_removed" }, { kind: "alreadyRemoved" }],
    [
      409,
      { error: "conflict", current: loo({ name: "New" }) },
      { kind: "conflict", current: loo({ name: "New" }) },
    ],
    [409, { error: "conflict" }, { kind: "conflict", current: null }],
    [404, { message: "Not found" }, { kind: "notFound" }],
    [401, { message: "Unauthorized" }, { kind: "auth" }],
    [429, { message: "Too many" }, { kind: "rateLimited" }],
    [503, { error: "read_only", message: "Paused" }, { kind: "paused" }],
  ])("maps HTTP %i %j", async (status, body, expected) => {
    fetchMock.mockResolvedValue(jsonResponse(status, body));
    expect(await reportLoo("", ID, { reason: "other", details: "x" })).toEqual(expected);
  });

  it("maps a 400 with issues to readable details", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        message: "Invalid report",
        issues: [{ path: ["details"], message: "Required for other" }],
      }),
    );
    expect(await reportLoo("", ID, { reason: "other" })).toEqual({
      kind: "error",
      message: "Invalid report",
      details: ["details: Required for other"],
    });
  });

  it("maps server errors, unexpected bodies and network failures to errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));
    expect(await reportLoo("", ID, { reason: "other", details: "x" })).toMatchObject({
      kind: "error",
      message: expect.stringContaining("error 500"),
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "someone-else" }));
    expect((await reportLoo("", ID, { reason: "other", details: "x" })).kind).toBe("error");
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    expect(await reportLoo("", ID, { reason: "other", details: "x" })).toMatchObject({
      kind: "error",
      message: expect.stringContaining("connection"),
    });
  });
});

describe("restoreLoo", () => {
  it("on 200 puts the toilet back on the cached map and evicts its detail", async () => {
    await saveSnapshot([OTHER_ROW], "2026-11-17T09:00:00.000Z");
    primeLooDetail(loo({ active: false }));
    fetchMock.mockResolvedValue(jsonResponse(200, { ...loo(), compressed: ROW }));

    const outcome = await restoreLoo("", ID, { details: "Still here", baseUpdatedAt: UPDATED_AT });

    expect(lastCall().url).toBe(`/api/loos/${ID}/restore`);
    expect(lastCall().body).toEqual({ details: "Still here", baseUpdatedAt: UPDATED_AT });
    expect(outcome.kind).toBe("applied");
    expect((await loadMapCache())?.data).toEqual([OTHER_ROW, ROW]);
    expect(peekLooDetail(ID)).toBeNull();
  });

  it("does not touch the map when the 200 has no usable row", async () => {
    await saveSnapshot([OTHER_ROW], "2026-11-17T09:00:00.000Z");
    fetchMock.mockResolvedValue(jsonResponse(200, { ...loo(), compressed: ["other", "x", 1] }));
    await restoreLoo("", ID);
    expect(lastCall().body).toEqual({});
    expect((await loadMapCache())?.data).toEqual([OTHER_ROW]);
  });

  it("maps 202 and 409 not_removed", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(202, { queued: true, id: "p2" }));
    expect(await restoreLoo("", ID)).toEqual({ kind: "queued", pendingId: "p2" });
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { error: "not_removed" }));
    expect(await restoreLoo("", ID)).toEqual({ kind: "notRemoved" });
  });
});

describe("verifyLoo", () => {
  it("posts without a body and evicts the detail, leaving the map cache alone", async () => {
    await saveSnapshot([ROW], "2026-11-17T09:00:00.000Z");
    primeLooDetail(loo());
    fetchMock.mockResolvedValue(jsonResponse(200, { id: ID, verifiedAt: "2026-11-17T12:00:00Z" }));

    expect(await verifyLoo("", ID)).toEqual({
      kind: "verified",
      verifiedAt: "2026-11-17T12:00:00Z",
    });
    const { url, init } = lastCall();
    expect(url).toBe(`/api/loos/${ID}/verify`);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe("same-origin");
    expect((await loadMapCache())?.data).toEqual([ROW]);
    expect(peekLooDetail(ID)).toBeNull();
  });

  it.each([
    [409, { error: "removed" }, "removed"],
    [404, {}, "notFound"],
    [429, {}, "rateLimited"],
    [503, { error: "read_only" }, "paused"],
    [503, { message: "Upstream down" }, "error"],
    [500, {}, "error"],
  ])("maps HTTP %i %j", async (status, body, kind) => {
    fetchMock.mockResolvedValue(jsonResponse(status, body));
    expect((await verifyLoo("", ID)).kind).toBe(kind);
  });
});

describe("pending changes", () => {
  const now = new Date("2026-11-17T12:00:00.000Z");

  it("stores the C5 shape and reads it back", () => {
    rememberPendingChange(ID, "remove", "p1", now);
    expect(JSON.parse(localStorage.getItem(`${PENDING_KEY_PREFIX}${ID}`) ?? "null")).toEqual({
      kind: "remove",
      pendingId: "p1",
      at: now.toISOString(),
    });
    expect(readPendingChange(ID, now)).toEqual({
      kind: "remove",
      pendingId: "p1",
      at: now.toISOString(),
    });
  });

  it("expires entries after 30 days and drops malformed ones", () => {
    rememberPendingChange(ID, "edit", "p1", now);
    expect(readPendingChange(ID, new Date(now.getTime() + PENDING_TTL_MS - 1))).not.toBeNull();
    expect(readPendingChange(ID, new Date(now.getTime() + PENDING_TTL_MS))).toBeNull();
    expect(localStorage.getItem(`${PENDING_KEY_PREFIX}${ID}`)).toBeNull();

    localStorage.setItem(`${PENDING_KEY_PREFIX}${ID}`, "{not json");
    expect(readPendingChange(ID, now)).toBeNull();
    localStorage.setItem(`${PENDING_KEY_PREFIX}${ID}`, JSON.stringify({ kind: "bogus", at: now }));
    expect(readPendingChange(ID, now)).toBeNull();
  });

  it("clears an entry", () => {
    rememberPendingChange(ID, "create", null, now);
    expect(readPendingChange(ID, now)).toMatchObject({ kind: "create", pendingId: null });
    clearPendingChange(ID);
    expect(readPendingChange(ID, now)).toBeNull();
  });
});

describe("fetchNearbyLoos", () => {
  it("queries proximity and returns other active toilets, nearest first", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: [
          { id: "far", name: "Far", distance: 80, active: true },
          { id: ID, name: "Self", distance: 0, active: true },
          { id: "gone", name: "Gone", distance: 5, active: false },
          {
            id: "near",
            name: "  ",
            distance: 8,
            active: true,
            location: { lat: 51.50007, lng: -0.14 },
          },
        ],
      }),
    );
    const items = await fetchNearbyLoos(
      "",
      { lat: 51.5, lng: -0.14 },
      { radius: 100, excludeId: ID },
    );
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://localhost");
    expect(url.pathname).toBe("/api/loos/proximity");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      lat: "51.5",
      lng: "-0.14",
      radius: "100",
      exclude: ID,
    });
    expect(items).toEqual([
      {
        id: "near",
        name: null,
        distance: 8,
        active: true,
        location: { lat: 51.50007, lng: -0.14 },
      },
      { id: "far", name: "Far", distance: 80, active: true, location: null },
    ]);
  });

  it("throws on an error response", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    await expect(fetchNearbyLoos("", { lat: 0, lng: 0 })).rejects.toThrow();
  });
});

describe("formatting", () => {
  it("formats distances", () => {
    expect(formatDistance(7.6)).toBe("8 m away");
    expect(formatDistance(1234)).toBe("1.2 km away");
    expect(formatDistance(Number.NaN)).toBe("");
  });

  it("labels removal categories", () => {
    expect(removalCategoryLabel("duplicate")).toBe("Duplicate of another toilet");
    expect(removalCategoryLabel("nonsense")).toBeNull();
    expect(removalCategoryLabel(null)).toBeNull();
  });
});
