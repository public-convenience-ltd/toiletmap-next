/**
 * Pure helpers behind LooMap's selection, history and freshness behaviour.
 * Kept free of Preact/Leaflet so they can be unit tested directly.
 */
import type { LooDetail, LooDetailResult } from "../../api/loos";

/** Minimal shape of a compressed map row: [id, geohash, filterMask]. */
type CompressedRow = readonly [string, string, number];

// ── URL ↔ selection ─────────────────────────────────────────────────────────

/** The map URL for a selection: `/loos/<id>` or `/` when nothing is selected. */
export function looPath(id: string | null): string {
  return id ? `/loos/${encodeURIComponent(id)}` : "/";
}

/** Reserved `/loos/<segment>` paths that are separate pages, not toilet ids. */
const RESERVED_SEGMENTS = new Set(["add"]);

/** The toilet id a map pathname selects, or null for `/` (or anything else). */
export function idFromPath(pathname: string): string | null {
  const match = /^\/loos\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return id && !RESERVED_SEGMENTS.has(id) ? id : null;
}

export type HistoryOp = { kind: "push" | "replace"; url: string } | null;

/**
 * How the address bar should follow a selection change.
 * - Already showing the right path (initial load, or a change caused by Back/Forward): nothing.
 * - Nothing selected → a toilet: push, so Back closes the panel. Except when the address
 *   bar already names a toilet whose panel isn't open (a marker tapped while the initial
 *   `/loos/<id>` was still loading): replace, so Back/close don't reopen that toilet.
 * - Toilet → another toilet, or closing the panel: replace, so taps don't pile up history.
 */
export function historyOpFor(
  prevId: string | null,
  nextId: string | null,
  currentPath: string,
): HistoryOp {
  const url = looPath(nextId);
  if (currentPath === url) return null;
  if (prevId === null && nextId !== null && idFromPath(currentPath) === null) {
    return { kind: "push", url };
  }
  return { kind: "replace", url };
}

export type InitialLoadOutcome =
  /** Select the toilet the page was opened for. */
  | { kind: "select"; toilet: LooDetail }
  /** Couldn't load it: point the address bar at the plain map instead. */
  | { kind: "reset"; url: string }
  /** The user picked something (or navigated) meanwhile: leave the selection and URL alone. */
  | { kind: "ignore" };

/**
 * What to do with the result of the initial `/loos/<id>` fetch. It only applies when the
 * user hasn't selected anything since the page loaded and the address bar still names
 * that toilet; otherwise a slow response would override a marker tapped meanwhile.
 */
export function initialLoadOutcome(
  initialId: string,
  detail: LooDetail | null,
  selectionMade: boolean,
  currentPath: string,
): InitialLoadOutcome {
  if (selectionMade || idFromPath(currentPath) !== initialId) return { kind: "ignore" };
  if (detail) return { kind: "select", toilet: detail };
  return { kind: "reset", url: looPath(null) };
}

// ── `?saved=1` banner ───────────────────────────────────────────────────────

/**
 * Reads and strips the `saved=1` flag LooForm appends after a successful save.
 * Returns the URL to `replaceState` to (path + remaining query + hash), or null if unchanged.
 */
export function consumeSavedParam(href: string): { saved: boolean; cleanUrl: string | null } {
  const url = new URL(href, "http://localhost");
  if (!url.searchParams.has("saved")) return { saved: false, cleanUrl: null };
  const saved = url.searchParams.get("saved") === "1";
  url.searchParams.delete("saved");
  const search = url.searchParams.toString();
  return { saved, cleanUrl: `${url.pathname}${search ? `?${search}` : ""}${url.hash}` };
}

// ── Refreshing the open panel when map data changes ─────────────────────────

/**
 * What changed in the last map data update, if useMapData reports it. `upserted` may hold
 * ids or compressed rows. Absent/null means "unknown" (e.g. a full snapshot replace).
 */
export interface MapDataChange {
  upserted?: readonly (string | CompressedRow)[];
  deleted?: readonly string[];
}

const rowFor = (data: readonly CompressedRow[], id: string) => data.find((row) => row[0] === id);

/**
 * Whether the open panel's toilet may be out of date after the map data changed from
 * `prevData` to `nextData`, or a server delta reported `change`.
 * - With a change set: refetch when the selected id was upserted or deleted, even if the
 *   rows are identical (a name/notes edit doesn't alter the compressed row).
 * - Without one: revalidate on any data change (an ETag revalidation is a cheap 304),
 *   because diffing rows would miss a name/notes edit.
 */
export function selectionNeedsRefresh(
  selectedId: string | null,
  prevData: readonly CompressedRow[],
  nextData: readonly CompressedRow[],
  change?: MapDataChange | null,
): boolean {
  if (!selectedId) return false;
  if (change) {
    if (change.deleted?.includes(selectedId)) return true;
    return !!change.upserted?.some((u) => (typeof u === "string" ? u : u[0]) === selectedId);
  }
  if (prevData === nextData) return false;
  // A first load (empty → data) is not a change to the already-fetched selection.
  return prevData.length > 0;
}

/** Whether the latest map data says the toilet is gone (deleted, or no longer on the map). */
export function isGoneFromMap(
  id: string,
  nextData: readonly CompressedRow[],
  change?: MapDataChange | null,
): boolean {
  if (change?.deleted?.includes(id)) return true;
  return nextData.length > 0 && !rowFor(nextData, id);
}

export type RefetchOutcome =
  | { kind: "update"; toilet: LooDetail }
  | { kind: "removed" }
  /** Couldn't tell (e.g. a network error): leave the panel as it is. */
  | { kind: "keep" };

/**
 * Interpret a refetch of the selected toilet (getLooDetail's result).
 * - Fresh (the server answered): an active record updates the panel; an inactive one or a
 *   404 (`loo: null`) shows the removed state.
 * - Not fresh (the request failed; `loo` may be a stale cached copy): the result says
 *   nothing, so trust the map data — removed if the toilet left it, otherwise keep.
 */
export function interpretRefetch(result: LooDetailResult, goneFromMap: boolean): RefetchOutcome {
  const { loo, fresh } = result;
  if (!fresh) return goneFromMap ? { kind: "removed" } : { kind: "keep" };
  if (!loo || loo.active === false) return { kind: "removed" };
  return { kind: "update", toilet: loo };
}

// ── Stale / offline notice ──────────────────────────────────────────────────

const formatClock = (when: number | string | Date): string | null => {
  const date = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(date);
};

/**
 * The small map notice for useMapData's status, or null when the data is fresh/loading.
 * `lastSyncedAt` is when the shown data was last confirmed with the server.
 */
export function freshnessNotice(
  status: string | undefined,
  lastSyncedAt?: number | string | Date | null,
): string | null {
  if (status === "offline") return "Offline — showing saved data";
  if (status === "stale") {
    const time = lastSyncedAt != null ? formatClock(lastSyncedAt) : null;
    return time
      ? `Couldn't refresh — showing data from ${time}`
      : "Couldn't refresh — showing saved data";
  }
  return null;
}
