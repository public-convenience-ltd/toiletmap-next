import type { Context } from "hono";
import type { AppVariables, Env, RequestUser } from "../types";
import { logger } from "../utils/logger";

type AppContext = Context<{ Variables: AppVariables; Bindings: Env }>;

/**
 * Per-account daily caps (audit H4 / B11): one account may remove toilets
 * from the map and move toilets (change the location of a toilet that has
 * one, by any distance) at most {@link DEFAULT_ACCOUNT_DAILY_CAP} times in
 * any {@link DAILY_CAP_WINDOW_HOURS} hours, counted together. Past that, its
 * next removal or move is queued for moderation (202, `reason:
 * "daily_cap"`) instead of applied. Confirmed admins are exempt; the routes
 * check that before calling {@link isOverDailyCap}.
 *
 * Counted in the database from the audit trail by Auth0 sub (see
 * LooService.countRecentRemovalsAndMoves), so the cap holds across isolates
 * and sessions. Two requests racing past the last slot can both apply (at
 * most a request or two over; the per-user write limiter bounds it).
 */
export const DEFAULT_ACCOUNT_DAILY_CAP = 10;

export const DAILY_CAP_WINDOW_HOURS = 24;

/** `ACCOUNT_DAILY_CAP` as a non-negative integer; unset or invalid gives the default. */
export const parseAccountDailyCap = (value: string | undefined): number => {
  const trimmed = value?.trim() ?? "";
  if (!/^\d+$/.test(trimmed)) {
    if (trimmed !== "") {
      logger.warn("Invalid ACCOUNT_DAILY_CAP; using the default", {
        default: DEFAULT_ACCOUNT_DAILY_CAP,
      });
    }
    return DEFAULT_ACCOUNT_DAILY_CAP;
  }
  return Number.parseInt(trimmed, 10);
};

/**
 * Whether `user` has already made their allowance of removals and moves in
 * the last {@link DAILY_CAP_WINDOW_HOURS} hours, so this one must be queued.
 * When the count cannot be read, the write is queued too (logged): in doubt,
 * a moderator decides.
 */
export const isOverDailyCap = async (c: AppContext, user: RequestUser): Promise<boolean> => {
  const cap = parseAccountDailyCap(c.env.ACCOUNT_DAILY_CAP);
  try {
    const count = await c
      .get("looService")
      .countRecentRemovalsAndMoves(user.sub, DAILY_CAP_WINDOW_HOURS);
    return count >= cap;
  } catch (error) {
    logger.error("Could not count the account's recent removals and moves; queueing", {
      userId: user.sub,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
};
