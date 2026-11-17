/**
 * Browser helpers for the "report a problem", "restore" and "it's still here"
 * actions (`POST /api/loos/:id/report|restore|verify`), plus the localStorage
 * record of changes this browser suggested that are awaiting moderation.
 *
 * Requests go to the same-origin `/api/*` proxy (which attaches the session's
 * access token server-side), so `apiUrl` is normally "".
 *
 * On a 200 from report/restore the change is already live: the map cache is
 * patched (read-your-writes) and the in-memory detail is evicted so the next
 * open of the toilet fetches the new version.
 */
import { describeIssues } from "../components/LooForm/issues";
import { getApiUrl } from "./config";
import { evictLooDetail, type LooDetail } from "./loos";
import { applyLocalMutation, type CompressedLoo, isCompressedLoo } from "./mapCache";

export type ReportReason =
  | "permanently_closed"
  | "does_not_exist"
  | "not_public"
  | "duplicate"
  | "other";

export const REPORT_REASONS: readonly ReportReason[] = [
  "permanently_closed",
  "does_not_exist",
  "not_public",
  "duplicate",
  "other",
];

/** Short labels for a removal category, as shown on a removed toilet. */
export const REMOVAL_CATEGORY_LABELS: Record<ReportReason, string> = {
  permanently_closed: "Permanently closed or demolished",
  does_not_exist: "Doesn't exist or is in the wrong place",
  not_public: "Not open to the public",
  duplicate: "Duplicate of another toilet",
  other: "Other",
};

/** Label for a stored `removalCategory`, or null for an unknown/missing one. */
export function removalCategoryLabel(category: unknown): string | null {
  if (typeof category !== "string") return null;
  return (REMOVAL_CATEGORY_LABELS as Record<string, string>)[category] ?? null;
}

/** Maximum length of the free-text details the server accepts. */
export const MAX_DETAILS_LENGTH = 2000;

export interface ReportInput {
  reason: ReportReason;
  details?: string;
  /** Required for `duplicate`: the id of the toilet this one duplicates. */
  duplicateOf?: string;
  /** The `updatedAt` the user saw, so the server can refuse a stale report (409). */
  baseUpdatedAt?: string | null;
}

export interface RestoreInput {
  details?: string;
  baseUpdatedAt?: string | null;
}

/** Outcome of a report or restore request. */
export type ChangeOutcome =
  /** 200: the change is live. `loo` is the updated toilet. */
  | { kind: "applied"; loo: LooDetail }
  /** 202: queued for a moderator. */
  | { kind: "queued"; pendingId: string | null }
  /** 409 `already_removed` (report) — the toilet is already off the map. */
  | { kind: "alreadyRemoved" }
  /** 409 `not_removed` (restore) — the toilet is already on the map. */
  | { kind: "notRemoved" }
  /** 409 `conflict`: someone changed the toilet since it was loaded. */
  | { kind: "conflict"; current: LooDetail | null }
  | { kind: "notFound" }
  /** 401: the session expired. */
  | { kind: "auth" }
  | { kind: "rateLimited" }
  | { kind: "error"; message: string; details?: string[] };

export type VerifyOutcome =
  | { kind: "verified"; verifiedAt: string | null }
  /** 409 `removed`: the toilet is no longer on the map. */
  | { kind: "removed" }
  | { kind: "notFound" }
  | { kind: "rateLimited" }
  | { kind: "error"; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const messageFrom = (body: unknown, fallback: string): string =>
  isRecord(body) && typeof body.message === "string" && body.message.trim()
    ? body.message
    : fallback;

const NETWORK_MESSAGE = "We couldn't reach the server. Check your connection and try again.";

const looPath = (id: string, action: string) => `/api/loos/${encodeURIComponent(id)}/${action}`;

async function post(
  apiUrl: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown } | null> {
  try {
    const response = await fetch(getApiUrl(apiUrl, path), {
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed };
  } catch (error) {
    console.error(`Request to ${path} failed:`, error);
    return null;
  }
}

/**
 * Read-your-writes after a live report/restore: patch the cached map row (a report
 * removes it, a restore adds it back) and drop the stale in-memory detail. Best effort.
 */
async function applyLocally(id: string, body: Record<string, unknown>, removal: boolean) {
  evictLooDetail(id);
  let compressed: CompressedLoo | null | undefined;
  if (isCompressedLoo(body.compressed) && body.compressed[0] === id) {
    compressed = body.compressed;
  } else if (removal) {
    // A removal always takes the toilet off the map, whatever `compressed` says.
    compressed = null;
  } else {
    // A restore without a usable row: leave the map to the next delta.
    compressed = undefined;
  }
  if (compressed === undefined) return;
  const updatedAt = typeof body.updatedAt === "string" ? body.updatedAt : null;
  try {
    await applyLocalMutation(id, compressed, updatedAt);
  } catch (error) {
    console.error("Couldn't update the cached map data:", error);
  }
}

function interpretChange(
  id: string,
  status: number,
  body: unknown,
  fallback: string,
):
  | Exclude<ChangeOutcome, { kind: "applied" }>
  | { kind: "applied-raw"; body: Record<string, unknown> } {
  if (status === 202) {
    const pendingId = isRecord(body) && typeof body.id === "string" ? body.id : null;
    return { kind: "queued", pendingId };
  }
  if (status >= 200 && status < 300) {
    if (isRecord(body) && typeof body.id === "string" && body.id === id) {
      return { kind: "applied-raw", body };
    }
    return {
      kind: "error",
      message:
        "The server sent an unexpected response. Please check the toilet's page before trying again.",
    };
  }
  if (status === 409 && isRecord(body)) {
    if (body.error === "already_removed") return { kind: "alreadyRemoved" };
    if (body.error === "not_removed") return { kind: "notRemoved" };
    if (body.error === "conflict") {
      const current =
        isRecord(body.current) && typeof body.current.id === "string"
          ? (body.current as LooDetail)
          : null;
      return { kind: "conflict", current };
    }
  }
  if (status === 404) return { kind: "notFound" };
  if (status === 401) return { kind: "auth" };
  if (status === 429) return { kind: "rateLimited" };
  if (status === 400) {
    const details = isRecord(body) ? describeIssues(body.issues) : [];
    return {
      kind: "error",
      message: messageFrom(body, "Some of the details aren't valid."),
      ...(details.length > 0 ? { details } : {}),
    };
  }
  if (status >= 500) {
    return {
      kind: "error",
      message: messageFrom(body, `Something went wrong on our side (error ${status}). ${fallback}`),
    };
  }
  return { kind: "error", message: messageFrom(body, `Error ${status}. ${fallback}`) };
}

const trimmedOrUndefined = (text: string | undefined) => {
  const value = text?.trim();
  return value ? value : undefined;
};

async function sendChange(
  apiUrl: string,
  id: string,
  action: "report" | "restore",
  payload: Record<string, unknown>,
): Promise<ChangeOutcome> {
  const result = await post(apiUrl, looPath(id, action), payload);
  if (!result) return { kind: "error", message: NETWORK_MESSAGE };
  const outcome = interpretChange(id, result.status, result.body, "Please try again.");
  if (outcome.kind !== "applied-raw") return outcome;
  await applyLocally(id, outcome.body, action === "report");
  return { kind: "applied", loo: outcome.body as LooDetail };
}

/** `POST /api/loos/:id/report` — remove a toilet from the map (or queue the report). */
export function reportLoo(apiUrl: string, id: string, input: ReportInput): Promise<ChangeOutcome> {
  const details = trimmedOrUndefined(input.details);
  const payload: Record<string, unknown> = { reason: input.reason };
  if (details) payload.details = details;
  if (input.reason === "duplicate" && input.duplicateOf) payload.duplicateOf = input.duplicateOf;
  if (input.baseUpdatedAt) payload.baseUpdatedAt = input.baseUpdatedAt;
  return sendChange(apiUrl, id, "report", payload);
}

/** `POST /api/loos/:id/restore` — put a removed toilet back on the map (or queue the request). */
export function restoreLoo(
  apiUrl: string,
  id: string,
  input: RestoreInput = {},
): Promise<ChangeOutcome> {
  const details = trimmedOrUndefined(input.details);
  const payload: Record<string, unknown> = {};
  if (details) payload.details = details;
  if (input.baseUpdatedAt) payload.baseUpdatedAt = input.baseUpdatedAt;
  return sendChange(apiUrl, id, "restore", payload);
}

/**
 * `POST /api/loos/:id/verify` — "Yes, it's still here". Only bumps `verified_at`, which
 * doesn't change the toilet's map row, so the map cache is left alone; the cached detail
 * is evicted so the next open shows the new date.
 */
export async function verifyLoo(apiUrl: string, id: string): Promise<VerifyOutcome> {
  const result = await post(apiUrl, looPath(id, "verify"));
  if (!result) return { kind: "error", message: NETWORK_MESSAGE };
  const { status, body } = result;
  if (status >= 200 && status < 300) {
    evictLooDetail(id);
    const verifiedAt =
      isRecord(body) && typeof body.verifiedAt === "string" ? body.verifiedAt : null;
    return { kind: "verified", verifiedAt };
  }
  if (status === 409) return { kind: "removed" };
  if (status === 404) return { kind: "notFound" };
  if (status === 429) return { kind: "rateLimited" };
  return {
    kind: "error",
    message: messageFrom(body, "We couldn't record that just now. Please try again."),
  };
}

// ---------------------------------------------------------------------------
// "You suggested a change" (localStorage)
// ---------------------------------------------------------------------------

export type PendingKind = "edit" | "remove" | "restore" | "create";

export interface PendingChange {
  kind: PendingKind;
  pendingId: string | null;
  /** ISO time the suggestion was sent. */
  at: string;
}

export const PENDING_KEY_PREFIX = "toiletmap-pending:";
/** Pending notices are forgotten after 30 days. */
export const PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const PENDING_KINDS = new Set<PendingKind>(["edit", "remove", "restore", "create"]);

const storage = (): Storage | null => {
  try {
    const store = typeof localStorage === "undefined" ? null : localStorage;
    return store && typeof store.getItem === "function" ? store : null;
  } catch {
    return null;
  }
};

/** Records that this browser suggested a change to `looId` (after a 202). Best effort. */
export function rememberPendingChange(
  looId: string,
  kind: PendingKind,
  pendingId: string | null,
  now: Date = new Date(),
): void {
  // pendingId is always a string in storage (LooForm's reader requires one).
  const entry = { kind, pendingId: pendingId ?? "", at: now.toISOString() };
  try {
    storage()?.setItem(`${PENDING_KEY_PREFIX}${looId}`, JSON.stringify(entry));
  } catch {
    // Storage full or blocked: the notice is a nicety.
  }
}

/** The pending suggestion for `looId`, or null (none, malformed or older than 30 days). */
export function readPendingChange(looId: string, now: Date = new Date()): PendingChange | null {
  const store = storage();
  if (!store) return null;
  const key = `${PENDING_KEY_PREFIX}${looId}`;
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = null;
  }
  const record = isRecord(value) ? value : null;
  const at = record && typeof record.at === "string" ? Date.parse(record.at) : Number.NaN;
  if (
    !record ||
    !PENDING_KINDS.has(record.kind as PendingKind) ||
    !Number.isFinite(at) ||
    now.getTime() - at >= PENDING_TTL_MS
  ) {
    try {
      store.removeItem(key);
    } catch {
      // ignore
    }
    return null;
  }
  return {
    kind: record.kind as PendingKind,
    pendingId: typeof record.pendingId === "string" && record.pendingId ? record.pendingId : null,
    at: record.at as string,
  };
}

export function clearPendingChange(looId: string): void {
  try {
    storage()?.removeItem(`${PENDING_KEY_PREFIX}${looId}`);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Nearby toilets (duplicate picker)
// ---------------------------------------------------------------------------

export interface NearbyLoo {
  id: string;
  name: string | null;
  distance: number;
  active: boolean;
  /** Where it is, when the server sent a usable location (for "12 m north"). */
  location: { lat: number; lng: number } | null;
}

const readLatLng = (value: unknown): { lat: number; lng: number } | null => {
  if (!isRecord(value)) return null;
  const { lat, lng } = value;
  return typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
    ? { lat, lng }
    : null;
};

/**
 * Active toilets within `radius` metres of a point, nearest first, excluding `excludeId`.
 * Filters inactive/self client-side too, in case the server ignores the query options.
 * Throws on a network or server error.
 */
export async function fetchNearbyLoos(
  apiUrl: string,
  location: { lat: number; lng: number },
  { radius = 100, excludeId }: { radius?: number; excludeId?: string } = {},
): Promise<NearbyLoo[]> {
  const params = new URLSearchParams({
    lat: String(location.lat),
    lng: String(location.lng),
    radius: String(radius),
  });
  if (excludeId) params.set("exclude", excludeId);
  const response = await fetch(getApiUrl(apiUrl, `/api/loos/proximity?${params.toString()}`), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Nearby toilets request failed: ${response.status}`);
  const body = (await response.json()) as { data?: unknown };
  const rows = Array.isArray(body?.data) ? body.data : [];
  return rows
    .filter(isRecord)
    .filter((row) => typeof row.id === "string" && row.id !== excludeId && row.active !== false)
    .map((row) => ({
      id: row.id as string,
      name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : null,
      distance: typeof row.distance === "number" ? row.distance : Number.NaN,
      active: true,
      location: readLatLng(row.location),
    }))
    .sort((a, b) => (a.distance || 0) - (b.distance || 0));
}

/** "8 m away", "1.2 km away". */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return "";
  if (metres < 1000) return `${Math.max(0, Math.round(metres))} m away`;
  return `${(metres / 1000).toFixed(1)} km away`;
}
