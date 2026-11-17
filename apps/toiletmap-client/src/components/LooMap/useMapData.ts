import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { getApiUrl } from "../../api/config";
import {
  applyDelta,
  type CompressedLoo,
  isCompressedLoo,
  loadMapCache,
  type MapCacheRecord,
  type MapDelta,
  mergeRows,
  saveSnapshot,
  subscribe,
} from "../../api/mapCache";

export type { CompressedLoo } from "../../api/mapCache";

/**
 * - `ok`: the last sync with the server succeeded (or none has been attempted yet).
 * - `stale`: the server answered with an error / bad payload; showing cached data.
 * - `offline`: the network request failed; showing cached data.
 */
export type MapDataStatus = "ok" | "stale" | "offline";

/** Ids a server delta (`/api/loos/updates`) reported, whether or not their rows changed. */
export interface MapDataChange {
  upserted: string[];
  deleted: string[];
}

export interface MapDataState {
  data: CompressedLoo[];
  /** True until the first render-able data (cache or network) or the first failure. */
  loading: boolean;
  status: MapDataStatus;
  /** Epoch ms of the last successful sync with the server (null: never). */
  lastSyncedAt: number | null;
  /** Increments every time `data` changes; cheap dependency for effects. */
  version: number;
  /**
   * Ids touched by the last server delta, as a new object per delta that named any id
   * (even when the rows were identical, e.g. a name-only edit or a row re-delivered by
   * the cursor overlap). Null when `data` last changed for another reason (dump, another
   * tab, a local save), i.e. "unknown".
   */
  lastChange: MapDataChange | null;
  /** Triggers a sync now (e.g. from a "Retry" button on a stale banner). */
  refresh: () => void;
}

export interface UseMapDataOptions {
  /** Poll interval while healthy. Default 60s. */
  pollIntervalMs?: number;
  /** Upper bound for the exponential back-off after repeated failures. Default 5 min. */
  maxBackoffMs?: number;
}

const noop = () => {
  // intentionally empty
};

export const POLL_INTERVAL_MS = 60_000;
export const MAX_BACKOFF_MS = 5 * 60_000;

/** Delay before the next sync after `failures` consecutive failures. */
export const nextPollDelay = (failures: number, base = POLL_INTERVAL_MS, max = MAX_BACKOFF_MS) =>
  Math.min(base * 2 ** Math.max(0, failures), max);

class SyncError extends Error {
  constructor(
    message: string,
    readonly kind: "stale" | "offline",
    readonly status?: number,
  ) {
    super(message);
  }
}

const isDumpBody = (value: unknown): value is { data: CompressedLoo[]; cursor?: unknown } =>
  !!value &&
  typeof value === "object" &&
  Array.isArray((value as { data?: unknown }).data) &&
  (value as { data: unknown[] }).data.every(isCompressedLoo);

const isDeltaBody = (value: unknown): value is MapDelta => {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<MapDelta>;
  return (
    Array.isArray(v.upserted) &&
    v.upserted.every(isCompressedLoo) &&
    Array.isArray(v.deleted) &&
    v.deleted.every((id) => typeof id === "string") &&
    typeof v.cursor === "string"
  );
};

async function fetchJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new SyncError(`Network error: ${String(error)}`, "offline");
  }
  if (!response.ok) {
    throw new SyncError(`HTTP ${response.status}`, "stale", response.status);
  }
  try {
    return await response.json();
  } catch {
    throw new SyncError("Invalid JSON", "stale", response.status);
  }
}

/**
 * Loads the compressed map dataset, cache first:
 *
 * 1. Renders whatever is in IndexedDB immediately.
 * 2. No cache → `GET /api/loos/dump` (stores data + the server's cursor), then
 *    at once `GET /api/loos/updates?since=<dump cursor>`: the dump may come from
 *    an HTTP/edge cache, and `/updates` (never cached) corrects it straight away.
 *    Cache → `GET /api/loos/updates?since=<stored server cursor>`.
 * 3. Repeats every 60s, whenever the tab becomes visible and when the browser
 *    comes back online; failures keep the cached data on screen, set `status`,
 *    and back off exponentially (≤ 5 min).
 * 4. Follows changes written by other tabs / the edit form via mapCache.subscribe.
 */
export function useMapData(apiUrl: string, options: UseMapDataOptions = {}): MapDataState {
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const maxBackoffMs = options.maxBackoffMs ?? MAX_BACKOFF_MS;

  const [data, setData] = useState<CompressedLoo[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<MapDataStatus>("ok");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const [lastChange, setLastChange] = useState<MapDataChange | null>(null);
  const refreshRef = useRef<() => void>(noop);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let inFlight: Promise<void> | null = null;

    // What this hook currently shows. `rev` mirrors the cache record's rev so
    // change notifications we already reflect are skipped.
    let current: CompressedLoo[] = [];
    let cursor: string | null = null;
    let rev = -1;
    let cacheReady: Promise<void> = Promise.resolve();

    /** Shows `next`; `change` is what a server delta named (null: unknown / not a delta). */
    const show = (next: CompressedLoo[], change: MapDataChange | null = null) => {
      if (cancelled) return;
      if (next === current) {
        // Rows unchanged, but the delta may still concern the open panel (name edit).
        if (change) setLastChange(change);
        return;
      }
      current = next;
      setData(next);
      setLastChange(change);
      setVersion((v) => v + 1);
    };

    const adoptRecord = (record: MapCacheRecord, change: MapDataChange | null = null) => {
      // Same rev means same data: skip the re-render (and marker diff).
      if (record.rev !== rev) show(record.data, change);
      else if (change) show(current, change);
      rev = record.rev;
      cursor = record.cursor;
    };

    const changeOf = (delta: MapDelta): MapDataChange | null =>
      delta.upserted.length > 0 || delta.deleted.length > 0
        ? { upserted: delta.upserted.map((row) => row[0]), deleted: [...delta.deleted] }
        : null;

    const markSynced = (at: number) => {
      if (cancelled) return;
      failures = 0;
      setStatus("ok");
      setLastSyncedAt(at);
      setLoading(false);
    };

    /**
     * Fetches and stores a dump, then catches up with `/updates` from its cursor.
     * `replace`: store it even over a record with a newer cursor (that cursor was rejected).
     */
    const fetchDump = async (replace = false) => {
      const body = await fetchJson(getApiUrl(apiUrl, "/api/loos/dump"));
      if (!isDumpBody(body)) throw new SyncError("Invalid dump payload", "stale");
      const serverCursor = typeof body.cursor === "string" ? body.cursor : null;
      try {
        adoptRecord(await saveSnapshot(body.data, serverCursor, { replace }));
      } catch (error) {
        // IndexedDB unavailable (private mode, quota): keep it in memory only.
        console.error("Failed to persist map dump:", error);
        cursor = serverCursor;
        show(body.data);
      }
      markSynced(Date.now());
      if (cursor === null || cancelled) return;
      // The dump may be a cached copy: correct it now rather than on the next poll.
      // Best effort (the dump is on screen); this never falls back to another dump.
      try {
        await fetchUpdates(cursor, false);
      } catch (error) {
        console.error("Map catch-up after dump failed:", error);
      }
    };

    /** `dumpOnFailure`: fetch a dump when the cursor is rejected or the cache vanished. */
    const fetchUpdates = async (since: string, dumpOnFailure = true) => {
      let body: unknown;
      try {
        body = await fetchJson(
          getApiUrl(apiUrl, `/api/loos/updates?since=${encodeURIComponent(since)}`),
        );
      } catch (error) {
        // The server rejected the cursor: start over from a dump, replacing the record
        // that holds the rejected cursor even if the dump's cursor is older.
        if (dumpOnFailure && error instanceof SyncError && error.status === 400) {
          cursor = null;
          return fetchDump(true);
        }
        throw error;
      }
      if (!isDeltaBody(body)) throw new SyncError("Invalid updates payload", "stale");

      let result: Awaited<ReturnType<typeof applyDelta>>;
      try {
        result = await applyDelta(body);
      } catch (error) {
        console.error("Failed to persist map delta:", error);
        cursor = body.cursor;
        show(mergeRows(current, body.upserted, body.deleted).data, changeOf(body));
        markSynced(Date.now());
        return;
      }
      if (!result) {
        // Cache vanished (cleared by another tab / DevTools): fetch a dump.
        cursor = null;
        if (dumpOnFailure) return fetchDump();
        return;
      }
      adoptRecord(result.record, changeOf(body));
      markSynced(result.record.syncedAt ?? Date.now());
    };

    const schedule = (delay: number) => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (typeof document !== "undefined" && document.visibilityState === "hidden") {
          // Don't poll a background tab; visibilitychange triggers a sync.
          schedule(pollIntervalMs);
          return;
        }
        sync();
      }, delay);
    };

    const sync = (): Promise<void> => {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        try {
          await cacheReady;
          if (cancelled) return;
          if (cursor === null) await fetchDump();
          else await fetchUpdates(cursor);
        } catch (error) {
          if (cancelled) return;
          failures += 1;
          const kind = error instanceof SyncError ? error.kind : "stale";
          const offline = typeof navigator !== "undefined" && navigator.onLine === false;
          console.error("Map data sync failed:", error);
          setStatus(offline ? "offline" : kind);
          setLoading(false);
        } finally {
          inFlight = null;
          schedule(nextPollDelay(failures, pollIntervalMs, maxBackoffMs));
        }
      })();
      return inFlight;
    };

    refreshRef.current = () => {
      sync();
    };

    // 1. Render cached data first.
    cacheReady = loadMapCache()
      .then((record) => {
        if (cancelled || !record) return;
        adoptRecord(record);
        setLastSyncedAt(record.syncedAt);
        if (record.data.length > 0) setLoading(false);
      })
      .catch((error) => {
        console.error("Failed to read map cache:", error);
      });

    // 2. Then sync with the server.
    sync();

    // 4. Follow changes made by other tabs or the edit form.
    const unsubscribe = subscribe((event) => {
      if (cancelled) return;
      if (event.type === "clear") {
        // Keep showing what we have; the next sync fetches a fresh dump.
        cursor = null;
        rev = -1;
        return;
      }
      if (event.rev <= rev) return;
      loadMapCache()
        .then((record) => {
          if (cancelled || !record || record.rev <= rev) return;
          adoptRecord(record);
          // Another tab synced with the server: the shown data is as fresh as its sync.
          // (Our own syncs are adopted directly, so their events are skipped above.)
          if (event.type === "snapshot" || event.type === "delta") {
            setStatus("ok");
            setLoading(false);
            if (record.syncedAt !== null) setLastSyncedAt(record.syncedAt);
          }
        })
        .catch((error) => console.error("Failed to reload map cache:", error));
    });

    const onVisibility = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Back online: drop the back-off and sync now instead of waiting up to 5 minutes.
    const onOnline = () => {
      failures = 0;
      sync();
    };
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      refreshRef.current = noop;
    };
  }, [apiUrl, pollIntervalMs, maxBackoffMs]);

  const refresh = useCallback(() => refreshRef.current(), []);

  return { data, loading, status, lastSyncedAt, version, lastChange, refresh };
}
