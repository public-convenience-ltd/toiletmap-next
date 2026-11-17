import { renderHook, waitFor } from "@testing-library/preact";
import { clear } from "idb-keyval";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  applyLocalMutation,
  type CompressedLoo,
  loadMapCache,
  MAP_CACHE_CHANNEL,
  resetMapCacheForTests,
  saveSnapshot,
} from "../../api/mapCache";
import { MAX_BACKOFF_MS, nextPollDelay, POLL_INTERVAL_MS, useMapData } from "./useMapData";

const A: CompressedLoo = ["a", "gcpvj0", 1];
const B: CompressedLoo = ["b", "gcpvj1", 2];
const C: CompressedLoo = ["c", "gcpvj2", 3];

// Server cursors deliberately far from the (real) client clock, so a test
// would notice if the hook ever sent its own time instead.
const SERVER_T0 = "2020-01-01T00:00:00.000Z";
const SERVER_T1 = "2020-01-01T00:01:00.000Z";
const SERVER_T2 = "2020-01-01T00:02:00.000Z";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let fetchMock: Mock;
const calls = () => fetchMock.mock.calls.map((c) => new URL(String(c[0]), "http://x"));

beforeEach(async () => {
  resetMapCacheForTests();
  await clear();
  fetchMock = vi.fn();
  global.fetch = fetchMock;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  resetMapCacheForTests();
  vi.restoreAllMocks();
});

describe("nextPollDelay", () => {
  it("backs off exponentially from 60s and caps at 5 minutes", () => {
    expect(nextPollDelay(0)).toBe(POLL_INTERVAL_MS);
    expect(nextPollDelay(1)).toBe(120_000);
    expect(nextPollDelay(2)).toBe(240_000);
    expect(nextPollDelay(3)).toBe(MAX_BACKOFF_MS);
    expect(nextPollDelay(10)).toBe(MAX_BACKOFF_MS);
  });
});

describe("useMapData", () => {
  it("cold load fetches the dump and stores the server cursor", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ data: [A, B], cursor: SERVER_T0 }))
      .mockResolvedValueOnce(json({ upserted: [], deleted: [], cursor: SERVER_T0 }));
    const { result } = renderHook(() => useMapData(""));

    await waitFor(() => expect(result.current.data).toEqual([A, B]));
    expect(result.current).toMatchObject({ loading: false, status: "ok" });
    expect(result.current.lastSyncedAt).toEqual(expect.any(Number));
    expect(result.current.version).toBeGreaterThan(0);
    expect(calls()[0].pathname).toBe("/api/loos/dump");

    await waitFor(async () => {
      expect(await loadMapCache()).toMatchObject({ cursor: SERVER_T0, data: [A, B] });
    });
  });

  it("cold load catches up with /updates straight after the dump (a cached dump is corrected)", async () => {
    // The dump came from an HTTP/edge cache: it still has A, deleted since, and lacks C.
    fetchMock
      .mockResolvedValueOnce(json({ data: [A, B], cursor: SERVER_T0 }))
      .mockResolvedValueOnce(json({ upserted: [C], deleted: ["a"], cursor: SERVER_T1 }));
    // Default 60s poll interval: only the immediate catch-up can deliver the delta in time.
    const { result } = renderHook(() => useMapData(""));

    await waitFor(() => expect(result.current.data).toEqual([B, C]));
    expect(calls().map((u) => u.pathname)).toEqual(["/api/loos/dump", "/api/loos/updates"]);
    expect(calls()[1].searchParams.get("since")).toBe(SERVER_T0);
    expect(result.current.status).toBe("ok");
    await waitFor(async () => {
      expect(await loadMapCache()).toMatchObject({ cursor: SERVER_T1, data: [B, C] });
    });
  });

  it("a failing catch-up after the dump keeps the dump on screen with status ok", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ data: [A, B], cursor: SERVER_T0 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useMapData(""));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.data).toEqual([A, B]));
    expect(result.current.status).toBe("ok");
  });

  it("warm load renders cached data first, then sends since=<stored server cursor>", async () => {
    await saveSnapshot([A, B], SERVER_T0);
    let resolveUpdates: (r: Response) => void = () => undefined;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((r) => {
        resolveUpdates = r;
      }),
    );
    const { result } = renderHook(() => useMapData(""));

    // Cached data is on screen before the network answers.
    await waitFor(() => expect(result.current.data).toEqual([A, B]));
    expect(result.current.loading).toBe(false);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const url = calls()[0];
    expect(url.pathname).toBe("/api/loos/updates");
    expect(url.searchParams.get("since")).toBe(SERVER_T0);

    resolveUpdates(json({ upserted: [C], deleted: ["a"], cursor: SERVER_T1 }));
    await waitFor(() => expect(result.current.data).toEqual([B, C]));
    expect(result.current.status).toBe("ok");
    await waitFor(async () => {
      expect(await loadMapCache()).toMatchObject({ cursor: SERVER_T1, data: [B, C] });
    });
  });

  it("polls with the cursor returned by the previous response", async () => {
    await saveSnapshot([A], SERVER_T0);
    fetchMock
      .mockResolvedValueOnce(json({ upserted: [], deleted: [], cursor: SERVER_T1 }))
      .mockResolvedValueOnce(json({ upserted: [B], deleted: [], cursor: SERVER_T2 }))
      .mockImplementation(async () => json({ upserted: [], deleted: [], cursor: SERVER_T2 }));
    const { result } = renderHook(() => useMapData("", { pollIntervalMs: 20 }));

    await waitFor(() => expect(result.current.data).toEqual([A, B]));
    const sinces = calls().map((u) => u.searchParams.get("since"));
    expect(sinces.slice(0, 2)).toEqual([SERVER_T0, SERVER_T1]);
  });

  it("does not re-render when a poll changes nothing", async () => {
    await saveSnapshot([A], SERVER_T0);
    fetchMock.mockImplementation(async () =>
      json({ upserted: [A], deleted: [], cursor: SERVER_T1 }),
    );
    const { result } = renderHook(() => useMapData("", { pollIntervalMs: 20 }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(result.current.version).toBe(1);
  });

  it("reports the ids a delta named, even when their rows are unchanged (name-only edit)", async () => {
    await saveSnapshot([A, B], SERVER_T0);
    fetchMock
      .mockResolvedValueOnce(json({ upserted: [A], deleted: [], cursor: SERVER_T1 }))
      .mockImplementation(async () => json({ upserted: [], deleted: [], cursor: SERVER_T2 }));
    const { result } = renderHook(() => useMapData(""));

    await waitFor(() =>
      expect(result.current.lastChange).toEqual({ upserted: ["a"], deleted: [] }),
    );
    expect(result.current.data).toEqual([A, B]);
    expect(result.current.version).toBe(1);
  });

  it("sets lastChange with a changing delta and clears it for changes from elsewhere", async () => {
    await saveSnapshot([A, B], SERVER_T0);
    fetchMock
      .mockResolvedValueOnce(json({ upserted: [C], deleted: ["a"], cursor: SERVER_T1 }))
      .mockImplementation(async () => json({ upserted: [], deleted: [], cursor: SERVER_T2 }));
    const { result } = renderHook(() => useMapData(""));

    await waitFor(() => expect(result.current.data).toEqual([B, C]));
    expect(result.current.lastChange).toEqual({ upserted: ["c"], deleted: ["a"] });

    // A local save (or another tab) changes the data with no server change set: unknown.
    await applyLocalMutation("b", null);
    await waitFor(() => expect(result.current.data).toEqual([C]));
    expect(result.current.lastChange).toBeNull();
  });

  it("an empty delta leaves lastChange alone", async () => {
    await saveSnapshot([A], SERVER_T0);
    fetchMock.mockImplementation(async () =>
      json({ upserted: [], deleted: [], cursor: SERVER_T1 }),
    );
    const { result } = renderHook(() => useMapData("", { pollIntervalMs: 20 }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(result.current.lastChange).toBeNull();
  });

  it("keeps cached data and reports stale on a non-OK response", async () => {
    await saveSnapshot([A, B], SERVER_T0);
    fetchMock.mockImplementation(async () => json({ message: "boom" }, 503));
    const { result } = renderHook(() => useMapData(""));

    await waitFor(() => expect(result.current.status).toBe("stale"));
    expect(result.current.data).toEqual([A, B]);
    expect(result.current.loading).toBe(false);
    expect(await loadMapCache()).toMatchObject({ cursor: SERVER_T0, data: [A, B] });
  });

  it("reports offline on a network error and recovers on the next successful poll", async () => {
    await saveSnapshot([A], SERVER_T0);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockImplementation(async () => {
        await gate;
        return json({ upserted: [B], deleted: [], cursor: SERVER_T1 });
      });
    const { result } = renderHook(() => useMapData("", { pollIntervalMs: 10, maxBackoffMs: 20 }));

    await waitFor(() => expect(result.current.status).toBe("offline"));
    expect(result.current.data).toEqual([A]);
    // The retry is scheduled (backed off) without user action.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    release();
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data).toEqual([A, B]);
  });

  it("without cache, a failing dump leaves an empty map with status stale (no throw)", async () => {
    fetchMock.mockImplementation(async () => new Response("nope", { status: 500 }));
    const { result } = renderHook(() => useMapData(""));
    await waitFor(() => expect(result.current.status).toBe("stale"));
    expect(result.current).toMatchObject({ data: [], loading: false, lastSyncedAt: null });
  });

  it("falls back to a dump when the server rejects the cursor (400)", async () => {
    await saveSnapshot([A], SERVER_T0);
    fetchMock
      .mockResolvedValueOnce(json({ message: "Invalid updates query" }, 400))
      .mockResolvedValueOnce(json({ data: [B, C], cursor: SERVER_T1 }));
    const { result } = renderHook(() => useMapData(""));
    await waitFor(() => expect(result.current.data).toEqual([B, C]));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(calls().map((u) => u.pathname)).toEqual([
      "/api/loos/updates",
      "/api/loos/dump",
      "/api/loos/updates",
    ]);
    expect(calls()[2].searchParams.get("since")).toBe(SERVER_T1);
  });

  it("after a 400 an older (cached) dump replaces the rejected cursor: no dump on every poll", async () => {
    // The stored cursor is newer than the cursor of the (edge-cached) dump the server sends.
    await saveSnapshot([A], SERVER_T2);
    const respond = (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://x");
      if (url.pathname === "/api/loos/dump") return json({ data: [B, C], cursor: SERVER_T0 });
      if (url.searchParams.get("since") === SERVER_T2) {
        return json({ message: "Invalid updates query" }, 400);
      }
      return json({ upserted: [], deleted: [], cursor: SERVER_T1 });
    };
    fetchMock.mockImplementation((input: RequestInfo | URL) => Promise.resolve(respond(input)));
    const { result } = renderHook(() => useMapData("", { pollIntervalMs: 10 }));

    await waitFor(() => expect(result.current.data).toEqual([B, C]));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(8));
    const paths = calls().map((u) => u.pathname);
    expect(paths.filter((p) => p === "/api/loos/dump")).toHaveLength(1);
    // The rejected cursor is never sent again.
    const sinces = calls().map((u) => u.searchParams.get("since"));
    expect(sinces.filter((since) => since === SERVER_T2)).toHaveLength(1);
    expect(result.current.status).toBe("ok");
  });

  it("syncs when the tab becomes visible again", async () => {
    await saveSnapshot([A], SERVER_T0);
    fetchMock.mockImplementation(async () =>
      json({ upserted: [], deleted: [], cursor: SERVER_T1 }),
    );
    renderHook(() => useMapData(""));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(calls()[1].searchParams.get("since")).toBe(SERVER_T1);
  });

  it("syncs at once when the browser comes back online, dropping the back-off", async () => {
    await saveSnapshot([A], SERVER_T0);
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockImplementation(async () => json({ upserted: [B], deleted: [], cursor: SERVER_T1 }));
    // Default intervals: the backed-off retry would be 2 minutes away.
    const { result } = renderHook(() => useMapData(""));
    await waitFor(() => expect(result.current.status).toBe("offline"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual([A, B]);
  });

  it("an in-flight delta read before a local save can't undo the saved row", async () => {
    await saveSnapshot([A, B], SERVER_T0);
    let resolveUpdates: (r: Response) => void = () => undefined;
    fetchMock
      .mockReturnValueOnce(
        new Promise<Response>((r) => {
          resolveUpdates = r;
        }),
      )
      .mockImplementation(async () => json({ upserted: [], deleted: [], cursor: SERVER_T1 }));
    const { result } = renderHook(() => useMapData(""));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // The edit form saves A (moved) while the poll is in flight.
    const saved: CompressedLoo = ["a", "gcpvjz", 9];
    await applyLocalMutation("a", saved, SERVER_T2);
    await waitFor(() => expect(result.current.data).toEqual([saved, B]));

    // The poll was read before the save: it re-delivers A's old row.
    resolveUpdates(json({ upserted: [A], deleted: [], cursor: SERVER_T1 }));
    await waitFor(async () => expect((await loadMapCache())?.cursor).toBe(SERVER_T1));
    expect(result.current.data).toEqual([saved, B]);
    expect((await loadMapCache())?.data).toEqual([saved, B]);
  });

  it("follows a local mutation written by the edit form (same tab)", async () => {
    await saveSnapshot([A, B], SERVER_T0);
    fetchMock.mockImplementation(async () =>
      json({ upserted: [], deleted: [], cursor: SERVER_T1 }),
    );
    const { result } = renderHook(() => useMapData(""));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const before = result.current.version;

    await applyLocalMutation("a", null);
    await waitFor(() => expect(result.current.data).toEqual([B]));
    expect(result.current.version).toBe(before + 1);
  });

  it("follows changes announced by another tab", async () => {
    await saveSnapshot([A], SERVER_T0);
    fetchMock.mockImplementation(async () =>
      json({ upserted: [], deleted: [], cursor: SERVER_T1 }),
    );
    const { result } = renderHook(() => useMapData(""));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.data).toEqual([A]));

    // Simulate another tab: write IndexedDB behind the module's back, then announce it.
    const { update } = await import("idb-keyval");
    await update<{ rev: number; data: CompressedLoo[] }>("loos-cache-v2", (r) => {
      if (!r) throw new Error("expected a cached record");
      return { ...r, rev: r.rev + 5, data: [...r.data, C] };
    });
    const otherTab = new BroadcastChannel(MAP_CACHE_CHANNEL);
    try {
      otherTab.postMessage({ type: "delta", rev: 99, cursor: SERVER_T1 });
      await waitFor(() => expect(result.current.data).toEqual([A, C]));
    } finally {
      otherTab.close();
    }
  });

  it("adopting another tab's sync clears a stale status and takes its sync time", async () => {
    await saveSnapshot([A], SERVER_T0);
    fetchMock.mockImplementation(async () => json({ message: "boom" }, 503));
    const { result } = renderHook(() => useMapData(""));
    await waitFor(() => expect(result.current.status).toBe("stale"));

    const otherSyncedAt = 1_700_000_000_000;
    const { update } = await import("idb-keyval");
    await update<{ rev: number; data: CompressedLoo[]; syncedAt: number }>("loos-cache-v2", (r) => {
      if (!r) throw new Error("expected a cached record");
      return { ...r, rev: r.rev + 1, data: [...r.data, B], syncedAt: otherSyncedAt };
    });
    const otherTab = new BroadcastChannel(MAP_CACHE_CHANNEL);
    try {
      otherTab.postMessage({ type: "delta", rev: 99, cursor: SERVER_T1 });
      await waitFor(() => expect(result.current.data).toEqual([A, B]));
      expect(result.current.status).toBe("ok");
      expect(result.current.lastSyncedAt).toBe(otherSyncedAt);
    } finally {
      otherTab.close();
    }
  });

  it("a local save in another tab does not count as a sync", async () => {
    await saveSnapshot([A], SERVER_T0);
    fetchMock.mockImplementation(async () => json({ message: "boom" }, 503));
    const { result } = renderHook(() => useMapData(""));
    await waitFor(() => expect(result.current.status).toBe("stale"));

    await applyLocalMutation("b", B);
    await waitFor(() => expect(result.current.data).toEqual([A, B]));
    expect(result.current.status).toBe("stale");
  });
});
