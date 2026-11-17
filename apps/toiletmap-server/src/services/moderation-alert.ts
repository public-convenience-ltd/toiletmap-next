import type { Context } from "hono";
import type { AppVariables, Env } from "../types";
import { logger } from "../utils/logger";

type AppContext = Context<{ Variables: AppVariables; Bindings: Env }>;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The whole alert body: a count, never submission text, IPs or ids. */
export const moderationAlertText = (count: number): string =>
  `${count} ${count === 1 ? "change" : "changes"} awaiting review`;

/**
 * Posts the counts-only alert to a Slack incoming webhook. Failures are logged
 * and swallowed: an alert must never affect the submission that triggered it.
 */
export const sendModerationAlert = async ({
  webhookUrl,
  count,
  fetchImpl = fetch,
}: {
  webhookUrl: string;
  count: number;
  fetchImpl?: FetchLike;
}): Promise<boolean> => {
  try {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: moderationAlertText(count) }),
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

export const __moderationAlertTestUtils = {
  reset: () => {
    lastAlertSentAt = null;
  },
};
