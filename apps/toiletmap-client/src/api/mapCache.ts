/**
 * Persistent cache of the compressed map dataset (`/api/loos/dump`), kept in
 * IndexedDB so the map can render instantly on the next visit and then catch
 * up with `/api/loos/updates?since=<cursor>`.
 *
 * Design:
 * - ONE versioned record under {@link MAP_CACHE_KEY}: `{schemaVersion, cursor,
 *   data, rev, syncedAt}`. Every write goes through idb-keyval `update()`,
 *   which reads and writes inside a single readwrite transaction, so two tabs
 *   (or two in-flight polls) applying deltas at the same time cannot lose
 *   each other's rows.
 * - `cursor` is always the SERVER's cursor (database clock, already rewound by
 *   the server). The client never invents a cursor from its own clock.
 * - `rev` increments whenever `data` changes. Writes are announced to other
 *   tabs over `BroadcastChannel('toiletmap-loos')` and to listeners in this
 *   tab directly; listeners compare `rev` to skip changes they already have.
 */
import { del, get, update } from "idb-keyval";
import { LEGACY_CACHE_KEYS, MAP_CACHE_KEY } from "./constants";

/** `[id, geohash, filterMask]` — the tuple shape served by `/api/loos/dump`. */
export type CompressedLoo = [string, string, number];

export const MAP_CACHE_SCHEMA_VERSION = 2;
export const MAP_CACHE_CHANNEL = "toiletmap-loos";

export interface MapCacheRecord {
  schemaVersion: typeof MAP_CACHE_SCHEMA_VERSION;
  /** Server cursor to send as `since` on the next `/updates` call (null: dump needed). */
  cursor: string | null;
  data: CompressedLoo[];
  /** Incremented on every change to `data`. */
  rev: number;
  /** Epoch ms of the last successful sync with the server (not local mutations). */
  syncedAt: number | null;
  /**
   * Ids patched by a local save, mapped to the save's server `updatedAt`. A delta whose
   * cursor is older than that may have been read before the save committed, so its rows
   * for the id are skipped (they could undo the patch). Optional: older records lack it.
   */
  patched?: Record<string, string>;
}

export interface MapDelta {
  upserted: CompressedLoo[];
  deleted: string[];
  cursor: string;
}

export type MapCacheEvent =
  | { type: "snapshot" | "delta" | "mutation"; rev: number; cursor: string | null }
  | { type: "clear"; rev: null; cursor: null };

export type MapCacheListener = (event: MapCacheEvent) => void;

// ---------------------------------------------------------------------------
// Pure helpers (also used by useMapData when IndexedDB is unavailable)
// ---------------------------------------------------------------------------

const cursorTime = (cursor: string | null | undefined): number => {
  if (!cursor) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(cursor);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};

/** True when `candidate` is strictly older than `current` (null counts as oldest). */
export const isCursorOlder = (candidate: string | null, current: string | null): boolean =>
  cursorTime(candidate) < cursorTime(current);

export const isCompressedLoo = (value: unknown): value is CompressedLoo =>
  Array.isArray(value) &&
  value.length === 3 &&
  typeof value[0] === "string" &&
  typeof value[1] === "string" &&
  typeof value[2] === "number";

const sameTuple = (a: CompressedLoo, b: CompressedLoo) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * Applies upserts/deletes to `data`, returning the new array and whether
 * anything actually changed. Idempotent: re-applying the same delta (which the
 * server's cursor overlap can cause) is a no-op. Order is preserved; new rows
 * are appended.
 */
export function mergeRows(
  data: readonly CompressedLoo[],
  upserted: readonly CompressedLoo[],
  deleted: readonly string[],
): { data: CompressedLoo[]; changed: boolean } {
  if (upserted.length === 0 && deleted.length === 0) {
    return { data: data as CompressedLoo[], changed: false };
  }
  const byId = new Map<string, CompressedLoo>();
  for (const row of data) byId.set(row[0], row);

  let changed = false;
  for (const id of deleted) {
    if (byId.delete(id)) changed = true;
  }
  for (const row of upserted) {
    const existing = byId.get(row[0]);
    if (!existing || !sameTuple(existing, row)) {
      // Map.set on an existing key keeps its insertion position.
      byId.set(row[0], row);
      changed = true;
    }
  }
  return changed
    ? { data: Array.from(byId.values()), changed }
    : { data: data as CompressedLoo[], changed };
}

/**
 * Drops a delta's rows for ids patched by a local save that the delta may predate
 * (its cursor is older than the save's `updatedAt`), and clears the markers the delta
 * covers (cursor at least as new as the save: its window includes the saved row).
 */
function filterPatched(
  patched: Record<string, string> | undefined,
  delta: MapDelta,
): { upserted: CompressedLoo[]; deleted: string[]; patched: Record<string, string> | undefined } {
  if (!patched || Object.keys(patched).length === 0) {
    return { upserted: delta.upserted, deleted: delta.deleted, patched: undefined };
  }
  const deltaTime = cursorTime(delta.cursor);
  const remaining: Record<string, string> = {};
  for (const [id, updatedAt] of Object.entries(patched)) {
    if (deltaTime < cursorTime(updatedAt)) remaining[id] = updatedAt;
  }
  const skip = new Set(Object.keys(remaining));
  return {
    upserted: delta.upserted.filter((row) => !skip.has(row[0])),
    deleted: delta.deleted.filter((id) => !skip.has(id)),
    patched: Object.keys(remaining).length > 0 ? remaining : undefined,
  };
}

const isValidRecord = (value: unknown): value is MapCacheRecord => {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<MapCacheRecord>;
  return (
    record.schemaVersion === MAP_CACHE_SCHEMA_VERSION &&
    Array.isArray(record.data) &&
    (record.cursor === null || typeof record.cursor === "string")
  );
};

// ---------------------------------------------------------------------------
// Change notifications
// ---------------------------------------------------------------------------

const listeners = new Set<MapCacheListener>();
let channel: BroadcastChannel | null = null;

const getChannel = (): BroadcastChannel | null => {
  if (channel) return channel;
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    channel = new BroadcastChannel(MAP_CACHE_CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as MapCacheEvent | undefined;
      if (data && typeof data === "object" && "type" in data) notifyLocal(data);
    };
  } catch {
    channel = null;
  }
  return channel;
};

function notifyLocal(event: MapCacheEvent) {
  for (const listener of Array.from(listeners)) {
    try {
      listener(event);
    } catch (error) {
      console.error("mapCache listener failed:", error);
    }
  }
}

/**
 * Tells listeners in this tab and every other tab that the cache changed.
 * Local listeners are called on the next macrotask, so the writer (which gets
 * the new record back directly) has adopted it before its own event arrives.
 */
function broadcast(event: MapCacheEvent) {
  setTimeout(() => notifyLocal(event), 0);
  try {
    getChannel()?.postMessage(event);
  } catch (error) {
    console.error("mapCache broadcast failed:", error);
  }
}

/**
 * Subscribes to cache changes made by this tab or any other tab (including the
 * edit form patching a saved loo). Returns an unsubscribe function.
 */
export function subscribe(listener: MapCacheListener): () => void {
  listeners.add(listener);
  getChannel();
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper: closes the BroadcastChannel and drops all listeners. */
export function resetMapCacheForTests() {
  listeners.clear();
  channel?.close();
  channel = null;
  legacyCleanup = null;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

let legacyCleanup: Promise<void> | null = null;

/** Deletes the pre-v2 keys (separate list + client-clock timestamp) once per page load. */
function removeLegacyKeys(): Promise<void> {
  legacyCleanup ??= Promise.all(LEGACY_CACHE_KEYS.map((key) => del(key)))
    .then(() => undefined)
    .catch((error) => {
      console.error("Failed to remove legacy map cache keys:", error);
    });
  return legacyCleanup;
}

/** Reads the cached dataset, or null when there is none (or it has an old schema). */
export async function loadMapCache(): Promise<MapCacheRecord | null> {
  await removeLegacyKeys();
  const value = await get<unknown>(MAP_CACHE_KEY);
  return isValidRecord(value) ? value : null;
}

export interface SaveSnapshotOptions {
  /**
   * Store this dump even when the cached record has a newer cursor. Used when the server
   * rejected the stored cursor (`/updates` 400): keeping that record would keep the
   * rejected cursor, and every poll would fall back to a dump again.
   */
  replace?: boolean;
}

/**
 * Stores a full dump. If another tab has meanwhile stored a NEWER snapshot
 * (later cursor) that one is kept, unless `replace` is set. Returns the record
 * now in the cache. A snapshot drops local-save markers: the dump is the
 * server's view, and the follow-up `/updates` (its cursor is older than any
 * save the dump missed) re-delivers those rows.
 */
export async function saveSnapshot(
  data: CompressedLoo[],
  cursor: string | null,
  { replace = false }: SaveSnapshotOptions = {},
): Promise<MapCacheRecord> {
  await removeLegacyKeys();
  let result: MapCacheRecord | undefined;
  let changed = false;
  await update<unknown>(MAP_CACHE_KEY, (current) => {
    const existing = isValidRecord(current) ? current : null;
    if (
      !replace &&
      existing &&
      existing.cursor !== null &&
      isCursorOlder(cursor, existing.cursor)
    ) {
      result = existing;
      return existing;
    }
    changed = true;
    result = {
      schemaVersion: MAP_CACHE_SCHEMA_VERSION,
      cursor,
      data,
      rev: (existing?.rev ?? 0) + 1,
      syncedAt: Date.now(),
    };
    return result;
  });
  const record = result as MapCacheRecord;
  if (changed) broadcast({ type: "snapshot", rev: record.rev, cursor: record.cursor });
  return record;
}

export interface ApplyDeltaResult {
  record: MapCacheRecord;
  /** True when `data` changed (rev incremented). */
  changed: boolean;
  /** False when the delta was ignored because its cursor is older than the stored one. */
  applied: boolean;
}

/**
 * Atomically merges a `/updates` response into the cache and advances the
 * cursor. A delta whose cursor is older than the stored cursor is ignored
 * (a slow response overtaken by a newer one). Rows for an id patched by a
 * local save are skipped while the delta's cursor is older than the save's
 * `updatedAt` (see {@link applyLocalMutation}). Returns null when there is no
 * cache to apply it to (caller should fetch a dump).
 */
export async function applyDelta(delta: MapDelta): Promise<ApplyDeltaResult | null> {
  let result: ApplyDeltaResult | null = null;
  await update<unknown>(MAP_CACHE_KEY, (current) => {
    if (!isValidRecord(current)) {
      result = null;
      return current;
    }
    if (isCursorOlder(delta.cursor, current.cursor)) {
      result = { record: current, changed: false, applied: false };
      return current;
    }
    const { upserted, deleted, patched } = filterPatched(current.patched, delta);
    const merged = mergeRows(current.data, upserted, deleted);
    const { patched: _previous, ...rest } = current;
    const record: MapCacheRecord = {
      ...rest,
      ...(patched ? { patched } : {}),
      cursor: delta.cursor,
      data: merged.data,
      rev: merged.changed ? current.rev + 1 : current.rev,
      syncedAt: Date.now(),
    };
    result = { record, changed: merged.changed, applied: true };
    return record;
  });
  const outcome = result as ApplyDeltaResult | null;
  if (outcome?.changed) {
    broadcast({ type: "delta", rev: outcome.record.rev, cursor: outcome.record.cursor });
  }
  return outcome;
}

/**
 * Patches one loo after a successful save in this browser, so the map shows
 * the edit immediately: `compressed` replaces (or adds) the row, `null`
 * removes it (the loo became inactive). Does not move the cursor — the next
 * `/updates` poll re-delivers the row (the server cursor overlaps), which is
 * applied idempotently. With `updatedAt` (the save response's server time)
 * the id is marked as patched, so a delta read before the save committed
 * (cursor older than `updatedAt`) can't undo the patch. Returns null when
 * there is no cache to patch.
 */
export async function applyLocalMutation(
  id: string,
  compressed: CompressedLoo | null,
  updatedAt?: string | null,
): Promise<MapCacheRecord | null> {
  await removeLegacyKeys();
  let result: MapCacheRecord | null = null;
  let changed = false;
  await update<unknown>(MAP_CACHE_KEY, (current) => {
    if (!isValidRecord(current)) {
      result = null;
      return current;
    }
    const merged = compressed
      ? mergeRows(current.data, [compressed], compressed[0] === id ? [] : [id])
      : mergeRows(current.data, [], [id]);
    const mark = updatedAt && Number.isFinite(Date.parse(updatedAt)) ? updatedAt : null;
    const patched = mark ? { ...current.patched, [id]: mark } : current.patched;
    if (!merged.changed && patched === current.patched) {
      result = current;
      return current;
    }
    changed = merged.changed;
    result = {
      ...current,
      ...(patched ? { patched } : {}),
      data: merged.data,
      rev: merged.changed ? current.rev + 1 : current.rev,
    };
    return result;
  });
  const record = result as MapCacheRecord | null;
  if (record && changed) broadcast({ type: "mutation", rev: record.rev, cursor: record.cursor });
  return record;
}

/** Removes the cached dataset (the next load fetches a fresh dump). */
export async function clearMapCache(): Promise<void> {
  await Promise.all([del(MAP_CACHE_KEY), ...LEGACY_CACHE_KEYS.map((key) => del(key))]);
  broadcast({ type: "clear", rev: null, cursor: null });
}
