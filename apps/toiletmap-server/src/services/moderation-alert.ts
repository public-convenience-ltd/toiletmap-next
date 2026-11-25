import type { Context } from "hono";
import type { AppVariables, Env } from "../types";
import { logger } from "../utils/logger";

type AppContext = Context<{ Variables: AppVariables; Bindings: Env }>;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The whole alert body: a count, never submission text, IPs or ids. */
export const moderationAlertText = (count: number): string =>
  `${count} ${count === 1 ? "change" : "changes"} awaiting review`;

/**
 * Posts `text` to a Slack incoming webhook. Failures are logged and
 * swallowed: an alert must never affect the request that triggered it.
 */
export const sendSlackText = async ({
  webhookUrl,
  text,
  fetchImpl = fetch,
}: {
  webhookUrl: string;
  text: string;
  fetchImpl?: FetchLike;
}): Promise<boolean> => {
  try {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      logger.warn("Moderation alert webhook failed", { status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    logger.warn("Moderation alert webhook failed", {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

/** Posts the counts-only queue alert (see {@link moderationAlertText}). */
export const sendModerationAlert = ({
  webhookUrl,
  count,
  fetchImpl,
}: {
  webhookUrl: string;
  count: number;
  fetchImpl?: FetchLike;
}): Promise<boolean> => sendSlackText({ webhookUrl, text: moderationAlertText(count), fetchImpl });

/** Queue sizes that always alert when reached: 1, 5, 10, 25, 50, 100, 250, 500, 1000, ... */
export const isModerationAlertThreshold = (count: number): boolean => {
  if (!Number.isInteger(count) || count < 1) return false;
  if (count === 1) return true;
  let scale = 1;
  while (scale * 5 <= count) {
    for (const step of [5, 10, 25]) {
      if (count === step * scale) return true;
    }
    scale *= 10;
  }
  return false;
};

/** Between thresholds, at most one alert per isolate in this window. */
export const MODERATION_ALERT_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Whether to post for a queue of `count`: always when it reaches a
 * threshold, otherwise only if this isolate has not posted within
 * {@link MODERATION_ALERT_INTERVAL_MS}. Pure; the caller keeps `lastSentAt`.
 */
export const shouldSendModerationAlert = (
  count: number,
  lastSentAt: number | null,
  now: number,
): boolean => {
  if (count < 1) return false;
  if (isModerationAlertThreshold(count)) return true;
  return lastSentAt === null || now - lastSentAt >= MODERATION_ALERT_INTERVAL_MS;
};

/*
 * Throttle state lives in the isolate's memory. Trade-off: Workers run many
 * isolates, so the time window is per isolate, not global, and a cold isolate
 * may post once early. That still bounds a flood to the thresholds (which
 * grow geometrically) plus one message per isolate per window, without a KV
 * namespace or Cache API round-trip on every queued change. Concurrent
 * submissions can step over a threshold (both count 6, say); the next
 * window catches up.
 */
let lastAlertSentAt: number | null = null;

/**
 * After a change is queued, counts the pending queue and posts the alert in
 * the background (`waitUntil`), so the submitter's response is not delayed.
 * Throttled by {@link shouldSendModerationAlert}. Does nothing unless
 * `MODERATION_SLACK_WEBHOOK` is set.
 */
export const scheduleModerationAlert = (
  c: AppContext,
  fetchImpl?: FetchLike,
  now: () => number = Date.now,
): void => {
  const webhookUrl = c.env.MODERATION_SLACK_WEBHOOK?.trim();
  if (!webhookUrl) return;

  const task = (async () => {
    try {
      const count = await c.get("pendingChangeService").countPending();
      const at = now();
      if (!shouldSendModerationAlert(count, lastAlertSentAt, at)) return;
      // Claim the window before the request so concurrent tasks do not all post.
      const previous = lastAlertSentAt;
      lastAlertSentAt = at;
      const sent = await sendModerationAlert({ webhookUrl, count, fetchImpl });
      if (!sent && lastAlertSentAt === at) lastAlertSentAt = previous;
    } catch (error) {
      logger.warn("Moderation alert skipped", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  try {
    c.executionCtx.waitUntil(task);
  } catch {
    // No ExecutionContext (e.g. some unit-test harnesses): let it run unattended.
  }
};

/** The admin page of a toilet, on the server's own origin (where /admin lives). */
const adminLooLink = (c: AppContext, looId: string): string =>
  `${new URL(c.req.url).origin}/admin/loos/${encodeURIComponent(looId)}`;

/** The window the removal alert counts over. */
export const REMOVAL_ALERT_WINDOW_HOURS = 24;

/**
 * The removal alert: a count and the toilet's admin link, never the reason,
 * the details, or who removed it.
 */
export const removalAlertText = (count: number, link: string): string =>
  `${count} ${count === 1 ? "toilet" : "toilets"} removed from the map in the last ` +
  `${REMOVAL_ALERT_WINDOW_HOURS} hours. Latest direct removal: ${link}`;

/**
 * The daily-cap alert: the cap and the toilet's admin link, never the
 * account's name, email or sub (moderators see the submitter in
 * /admin/pending).
 */
export const dailyCapAlertText = (cap: number, link: string): string =>
  `An account reached its daily limit of ${cap} removals and moves; its change to ${link} ` +
  "was queued for review (see /admin/pending).";

/** Removal alerts have their own throttle window (same rule as the queue alert). */
let lastRemovalAlertAt: number | null = null;

/** Per account (by sub, never posted): when this isolate last posted a cap alert. */
const lastCapAlertAt = new Map<string, number>();
const MAX_CAP_ALERT_ENTRIES = 1000;

/** Runs `task` after the response (`waitUntil`) and logs, never throws. */
const runInBackground = (c: AppContext, label: string, task: () => Promise<void>): void => {
  const promise = task().catch((error: unknown) => {
    logger.warn(label, {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  });
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    // No ExecutionContext (e.g. some unit-test harnesses): let it run unattended.
  }
};

/**
 * After a direct removal (a trusted report), counts the removals in the last
 * {@link REMOVAL_ALERT_WINDOW_HOURS} hours and posts {@link removalAlertText}
 * in the background. Throttled like the queue alert: always at 1, 5, 10, 25,
 * ... removals, otherwise at most once per isolate every
 * {@link MODERATION_ALERT_INTERVAL_MS}. Does nothing unless
 * `MODERATION_SLACK_WEBHOOK` is set.
 */
export const scheduleRemovalAlert = (
  c: AppContext,
  looId: string,
  fetchImpl?: FetchLike,
  now: () => number = Date.now,
): void => {
  const webhookUrl = c.env.MODERATION_SLACK_WEBHOOK?.trim();
  if (!webhookUrl) return;
  const link = adminLooLink(c, looId);

  runInBackground(c, "Removal alert skipped", async () => {
    const count = await c.get("looService").countRecentRemovals(REMOVAL_ALERT_WINDOW_HOURS);
    const at = now();
    if (!shouldSendModerationAlert(count, lastRemovalAlertAt, at)) return;
    const previous = lastRemovalAlertAt;
    lastRemovalAlertAt = at;
    const sent = await sendSlackText({
      webhookUrl,
      text: removalAlertText(count, link),
      fetchImpl,
    });
    if (!sent && lastRemovalAlertAt === at) lastRemovalAlertAt = previous;
  });
};

/**
 * When an account's removal or move is queued because it reached its daily
 * cap, posts {@link dailyCapAlertText} in the background: at most once per
 * account per isolate every {@link MODERATION_ALERT_INTERVAL_MS}. Does
 * nothing unless `MODERATION_SLACK_WEBHOOK` is set.
 */
export const scheduleDailyCapAlert = (
  c: AppContext,
  { sub, looId, cap }: { sub: string; looId: string; cap: number },
  fetchImpl?: FetchLike,
  now: () => number = Date.now,
): void => {
  const webhookUrl = c.env.MODERATION_SLACK_WEBHOOK?.trim();
  if (!webhookUrl) return;
  const at = now();
  const last = lastCapAlertAt.get(sub);
  if (last !== undefined && at - last < MODERATION_ALERT_INTERVAL_MS) return;
  if (lastCapAlertAt.size >= MAX_CAP_ALERT_ENTRIES) lastCapAlertAt.clear();
  lastCapAlertAt.set(sub, at);
  const link = adminLooLink(c, looId);

  runInBackground(c, "Daily cap alert skipped", async () => {
    const sent = await sendSlackText({ webhookUrl, text: dailyCapAlertText(cap, link), fetchImpl });
    if (!sent && lastCapAlertAt.get(sub) === at) lastCapAlertAt.delete(sub);
  });
};

export const __moderationAlertTestUtils = {
  reset: () => {
    lastAlertSentAt = null;
    lastRemovalAlertAt = null;
    lastCapAlertAt.clear();
  },
};
