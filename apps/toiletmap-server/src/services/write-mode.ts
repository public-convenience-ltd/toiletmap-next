import type { Env } from "../types";
import { logger } from "../utils/logger";

/**
 * The write kill switch (audit H4 / B12), read from the `SETTINGS` KV
 * namespace, key {@link WRITE_MODE_KEY}:
 *
 * - `open` (the default): writes follow the normal trust rules.
 * - `queue`: every write from a caller who is not a confirmed admin is queued
 *   for moderation (202, `reason: "queue_mode"`); admins still write directly.
 * - `read-only`: every loo write (POST/PUT under /api/loos, report, restore
 *   and verify included, admins included) and moderator approve/reject get
 *   503 `{ error: "read_only" }` with `Retry-After`.
 *
 * It lives in KV, not in a var, so it survives every deploy (`wrangler
 * deploy` resets dashboard vars). See docs/runbooks/kill-switch.md.
 */
export type WriteMode = "open" | "queue" | "read-only";

export const WRITE_MODE_KEY = "write_mode";

/** How long an isolate keeps the value it read (KV itself may add up to about a minute). */
export const WRITE_MODE_CACHE_MS = 10_000;

/** `Retry-After` (seconds) on a read-only refusal. */
export const READ_ONLY_RETRY_AFTER_SECONDS = 300;

/** The 503 body for a write refused in read-only mode. */
export const readOnlyBody = {
  error: "read_only",
  message: "Editing the Toilet Map is paused for a short while. Please try again later.",
} as const;

/** The part of a KV binding this module uses. */
export type SettingsStore = Pick<KVNamespace, "get">;

const ALIASES: Record<string, WriteMode> = {
  open: "open",
  queue: "queue",
  "read-only": "read-only",
  readonly: "read-only",
  read_only: "read-only",
};

/**
 * Parses a stored value. A missing or empty value is `open`. An unrecognised
 * value fails closed to `read-only` (an operator who typed something meant to
 * restrict writes), and is logged.
 */
export const parseWriteMode = (value: string | null | undefined): WriteMode => {
  const normalised = value?.trim().toLowerCase() ?? "";
  if (normalised === "") return "open";
  const mode = ALIASES[normalised];
  if (mode) return mode;
  logger.error("Unrecognised write_mode in SETTINGS; treating it as read-only", {
    value: normalised.slice(0, 40),
  });
  return "read-only";
};

type CacheEntry = { store: SettingsStore; mode: WriteMode; at: number };

/** One slot per isolate; a different binding object (a test's fake) misses it. */
let cache: CacheEntry | null = null;

/**
 * The current write mode. No `SETTINGS` binding means `open` (production and
 * preview have none until the owner creates the namespace). The value is
 * cached per isolate for {@link WRITE_MODE_CACHE_MS}. If KV cannot be read,
 * the last value read is kept; with none, `open` (logged), so a KV outage
 * never stops the map from being edited by itself.
 */
export const getWriteMode = async (
  env: Pick<Env, "SETTINGS">,
  now: () => number = Date.now,
): Promise<WriteMode> => {
  const store = env.SETTINGS;
  if (!store) return "open";
  const at = now();
  if (cache && cache.store === store && at - cache.at < WRITE_MODE_CACHE_MS) return cache.mode;

  try {
    const mode = parseWriteMode(await store.get(WRITE_MODE_KEY));
    cache = { store, mode, at };
    return mode;
  } catch (error) {
    logger.error("Could not read write_mode from SETTINGS", {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return cache && cache.store === store ? cache.mode : "open";
  }
};

export const __writeModeTestUtils = {
  reset: () => {
    cache = null;
  },
};
