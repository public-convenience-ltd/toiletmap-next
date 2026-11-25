import type { Context } from "hono";
import type { Prisma } from "../prisma";
import type { AppVariables, Env, RequestUser } from "../types";
import { logger } from "../utils/logger";
import { DailyCapCountError, type DailyCapResult } from "./loo/loo.service";

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
 * and sessions. The count and the write run in one transaction under a
 * per-account advisory lock (LooService.runUnderDailyCap), so parallel
 * requests from one account cannot all slip past the last slot.
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
 * Runs `write` (a removal or move by `user`) only if the account is under its
 * daily cap; see LooService.runUnderDailyCap for the locking. `{ overCap:
 * true }` means nothing was written and the caller must queue the change.
 * When the count cannot be read, the change is queued too (logged): in
 * doubt, a moderator decides. An error from `write` itself is rethrown.
 */
export const runUnderDailyCap = async <T>(
  c: AppContext,
  user: RequestUser,
  write: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<DailyCapResult<T>> => {
  const cap = parseAccountDailyCap(c.env.ACCOUNT_DAILY_CAP);
  try {
    return await c.get("looService").runUnderDailyCap(user.sub, DAILY_CAP_WINDOW_HOURS, cap, write);
  } catch (error) {
    if (!(error instanceof DailyCapCountError)) throw error;
    logger.error("Could not count the account's recent removals and moves; queueing", {
      userId: user.sub,
      errorMessage: error.message,
    });
    return { overCap: true };
  }
};
