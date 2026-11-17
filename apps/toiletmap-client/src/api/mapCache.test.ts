import { clear, get, set } from "idb-keyval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_KEYS, MAP_CACHE_KEY } from "./constants";
import {
  applyDelta,
  applyLocalMutation,
  type CompressedLoo,
  clearMapCache,
  isCursorOlder,
  loadMapCache,
  MAP_CACHE_CHANNEL,
  type MapCacheEvent,
  mergeRows,
  resetMapCacheForTests,
  saveSnapshot,
  subscribe,
} from "./mapCache";

const A: CompressedLoo = ["a", "gcpvj0", 1];
const B: CompressedLoo = ["b", "gcpvj1", 2];
const C: CompressedLoo = ["c", "gcpvj2", 3];

const T0 = "2026-11-17T10:00:00.000Z";
const T1 = "2026-11-17T10:01:00.000Z";
const T2 = "2026-11-17T10:02:00.000Z";

const nextEvent = (listen: (cb: (e: MapCacheEvent) => void) => () => void) =>
  new Promise<MapCacheEvent>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("no event")), 1000);
    const off = listen((event) => {
      clearTimeout(timeout);
      off();
      resolve(event);
    });
  });

/** Lets pending (deferred) local notifications from setup writes fire. */
const flush = () => new Promise((r) => setTimeout(r, 5));

beforeEach(async () => {
  resetMapCacheForTests();
  await clear();
});

afterEach(() => {
  resetMapCacheForTests();
});

describe("pure helpers", () => {
  it("mergeRows upserts, deletes and is idempotent", () => {
    const first = mergeRows([A, B], [["b", "gcpvj9", 7], C], ["a"]);
    expect(first.changed).toBe(true);
    expect(first.data).toEqual([["b", "gcpvj9", 7], C]);

    const again = mergeRows(first.data, [["b", "gcpvj9", 7], C], ["a"]);
    expect(again.changed).toBe(false);
    expect(again.data).toBe(first.data);
  });

  it("isCursorOlder compares by time and treats null as oldest", () => {
    expect(isCursorOlder(T0, T1)).toBe(true);
    expect(isCursorOlder(T1, T0)).toBe(false);
    expect(isCursorOlder(T1, T1)).toBe(false);
    expect(isCursorOlder(null, T0)).toBe(true);
    expect(isCursorOlder(T0, null)).toBe(false);
  });
});

describe("loadMapCache / saveSnapshot", () => {
  it("returns null when empty and the stored record after a snapshot", async () => {
    expect(await loadMapCache()).toBeNull();
    await saveSnapshot([A, B], T0);
    const record = await loadMapCache();
    expect(record).toMatchObject({ schemaVersion: 2, cursor: T0, data: [A, B], rev: 1 });
    expect(record?.syncedAt).toEqual(expect.any(Number));
  });

  it("stores everything under the single versioned key", async () => {
    await saveSnapshot([A], T0);
    expect(await get(MAP_CACHE_KEY)).toMatchObject({ cursor: T0, data: [A] });
  });

  it("ignores a record with another schema version", async () => {
    await set(MAP_CACHE_KEY, { schemaVersion: 1, cursor: T0, data: [A], rev: 1 });
    expect(await loadMapCache()).toBeNull();
  });

  it("deletes the legacy keys on first load", async () => {
    await set(CACHE_KEYS.LOOS_LIST, [A]);
    await set(CACHE_KEYS.LAST_UPDATED, T0);
    await loadMapCache();
    expect(await get(CACHE_KEYS.LOOS_LIST)).toBeUndefined();
    expect(await get(CACHE_KEYS.LAST_UPDATED)).toBeUndefined();
  });

  it("keeps a newer snapshot written by another tab", async () => {
    await saveSnapshot([A, B], T2);
    const record = await saveSnapshot([A], T1);
    expect(record).toMatchObject({ cursor: T2, data: [A, B] });
    expect((await loadMapCache())?.cursor).toBe(T2);
  });

  it("replace: stores the dump even over a newer cursor (the stored cursor was rejected)", async () => {
    await saveSnapshot([A, B], T2);
    const record = await saveSnapshot([C], T0, { replace: true });
    expect(record).toMatchObject({ cursor: T0, data: [C], rev: 2 });
    expect(await loadMapCache()).toMatchObject({ cursor: T0, data: [C] });
  });

  it("clearMapCache removes the record", async () => {
    await saveSnapshot([A], T0);
    await clearMapCache();
    expect(await loadMapCache()).toBeNull();
  });
});

describe("applyDelta", () => {
  it("merges rows and advances to the server cursor", async () => {
    await saveSnapshot([A, B], T0);
    const result = await applyDelta({ upserted: [C], deleted: ["a"], cursor: T1 });
    expect(result).toMatchObject({ changed: true, applied: true });
    expect(await loadMapCache()).toMatchObject({ cursor: T1, data: [B, C], rev: 2 });
  });

  it("advances the cursor without bumping rev when nothing changed", async () => {
    await saveSnapshot([A], T0);
    const result = await applyDelta({ upserted: [A], deleted: [], cursor: T1 });
    expect(result).toMatchObject({ changed: false, applied: true });
    expect(await loadMapCache()).toMatchObject({ cursor: T1, rev: 1 });
  });

  it("ignores a delta whose cursor is older than the stored one", async () => {
    await saveSnapshot([A], T2);
    const result = await applyDelta({ upserted: [B], deleted: ["a"], cursor: T1 });
    expect(result).toMatchObject({ applied: false, changed: false });
    expect(await loadMapCache()).toMatchObject({ cursor: T2, data: [A] });
  });

  it("returns null when there is nothing to apply to", async () => {
    expect(await applyDelta({ upserted: [A], deleted: [], cursor: T1 })).toBeNull();
    expect(await loadMapCache()).toBeNull();
  });

  it("does not lose rows when deltas are applied concurrently (atomic update)", async () => {
    await saveSnapshot([A], T0);
    const rows: CompressedLoo[] = Array.from({ length: 20 }, (_, i) => [`n${i}`, "gcpvj3", i]);
    await Promise.all(rows.map((row) => applyDelta({ upserted: [row], deleted: [], cursor: T1 })));
    const record = await loadMapCache();
    expect(record?.data).toHaveLength(21);
    expect(new Set(record?.data.map((r) => r[0]))).toEqual(
      new Set(["a", ...rows.map((r) => r[0])]),
    );
    expect(record?.rev).toBe(21);
  });
});

describe("applyLocalMutation", () => {
  it("patches one row without moving the cursor", async () => {
    await saveSnapshot([A, B], T0);
    await applyLocalMutation("b", ["b", "gcpvjz", 63]);
    expect(await loadMapCache()).toMatchObject({ cursor: T0, data: [A, ["b", "gcpvjz", 63]] });
  });

  it("adds a newly created loo", async () => {
    await saveSnapshot([A], T0);
    await applyLocalMutation("c", C);
    expect((await loadMapCache())?.data).toEqual([A, C]);
  });

  it("deletes a row when compressed is null (loo inactive)", async () => {
    await saveSnapshot([A, B], T0);
    await applyLocalMutation("a", null);
    expect(await loadMapCache()).toMatchObject({ cursor: T0, data: [B] });
  });

  it("is a no-op without a cache", async () => {
    expect(await applyLocalMutation("a", A)).toBeNull();
    expect(await loadMapCache()).toBeNull();
  });
});

describe("local save vs. an in-flight delta", () => {
  // The save commits at SAVED_AT. A delta whose cursor is older may have been read before
  // the commit (the server cursor trails its clock by 120s), so it can carry the old row.
  const SAVED_AT = "2026-11-17T10:05:00.000Z";
  const BEFORE_SAVE = "2026-11-17T10:04:00.000Z";
  const AFTER_SAVE = "2026-11-17T10:05:00.000Z";
  const A_SAVED: CompressedLoo = ["a", "gcpvjz", 9];

  it("an older delta can't undo the patch; other rows still apply", async () => {
    await saveSnapshot([A, B], T0);
    await applyLocalMutation("a", A_SAVED, SAVED_AT);
    expect((await loadMapCache())?.patched).toEqual({ a: SAVED_AT });

    // Read before the save: re-delivers A's old row (and would delete nothing else).
    const result = await applyDelta({ upserted: [A, C], deleted: [], cursor: BEFORE_SAVE });
    expect(result).toMatchObject({ applied: true, changed: true });
    expect(await loadMapCache()).toMatchObject({
      cursor: BEFORE_SAVE,
      data: [A_SAVED, B, C],
      patched: { a: SAVED_AT },
    });

    // An older delete for the patched id is skipped too.
    await applyDelta({ upserted: [], deleted: ["a"], cursor: BEFORE_SAVE });
    expect((await loadMapCache())?.data).toEqual([A_SAVED, B, C]);
  });

  it("a delta at least as new as the save applies and clears the marker", async () => {
    await saveSnapshot([A, B], T0);
    await applyLocalMutation("a", A_SAVED, SAVED_AT);
    const later: CompressedLoo = ["a", "gcpvjy", 4];
    await applyDelta({ upserted: [later], deleted: [], cursor: AFTER_SAVE });
    const record = await loadMapCache();
    expect(record).toMatchObject({ cursor: AFTER_SAVE, data: [later, B] });
    expect(record).not.toHaveProperty("patched");
  });

  it("without updatedAt the patch is unprotected (no marker)", async () => {
    await saveSnapshot([A], T0);
    await applyLocalMutation("a", A_SAVED);
    expect(await loadMapCache()).not.toHaveProperty("patched");
  });

  it("a new snapshot drops the markers", async () => {
    await saveSnapshot([A], T0);
    await applyLocalMutation("a", A_SAVED, SAVED_AT);
    await saveSnapshot([A_SAVED], AFTER_SAVE);
    expect(await loadMapCache()).not.toHaveProperty("patched");
  });
});

describe("change notifications", () => {
  it("notifies subscribers in this tab", async () => {
    await saveSnapshot([A], T0);
    await flush();
    const event = nextEvent(subscribe);
    await applyLocalMutation("a", null);
    expect(await event).toEqual({ type: "mutation", rev: 2, cursor: T0 });
  });

  it("broadcasts to other tabs over BroadcastChannel", async () => {
    await saveSnapshot([A], T0);
    const otherTab = new BroadcastChannel(MAP_CACHE_CHANNEL);
    try {
      const received = nextEvent((cb) => {
        otherTab.onmessage = (e: MessageEvent) => cb(e.data as MapCacheEvent);
        return () => {
          otherTab.onmessage = null;
        };
      });
      await applyLocalMutation("b", B);
      expect(await received).toEqual({ type: "mutation", rev: 2, cursor: T0 });
    } finally {
      otherTab.close();
    }
  });

  it("relays messages from other tabs to local subscribers", async () => {
    // Let local notifications queued by earlier tests (setTimeout 0) fire first.
    await flush();
    const event = nextEvent(subscribe);
    const otherTab = new BroadcastChannel(MAP_CACHE_CHANNEL);
    try {
      otherTab.postMessage({ type: "delta", rev: 9, cursor: T2 });
      expect(await event).toEqual({ type: "delta", rev: 9, cursor: T2 });
    } finally {
      otherTab.close();
    }
  });

  it("does not notify when a delta changes nothing", async () => {
    await saveSnapshot([A], T0);
    await flush();
    const listener = vi.fn();
    subscribe(listener);
    await applyDelta({ upserted: [A], deleted: [], cursor: T1 });
    await new Promise((r) => setTimeout(r, 20));
    expect(listener).not.toHaveBeenCalled();
  });
});
