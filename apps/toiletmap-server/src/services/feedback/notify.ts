import type { Context } from "hono";
import type { AppVariables, Env } from "../../types";
import { logger } from "../../utils/logger";
import { shouldSendModerationAlert } from "../moderation-alert";

type AppContext = Context<{ Variables: AppVariables; Bindings: Env }>;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The window the Slack count covers. */
export const FEEDBACK_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The whole Slack message: a count, like the moderation alert. Never the
 * feedback text, the page it came from, the email address or the IP, so a
 * spammer cannot use the channel as a megaphone; moderators read the
 * messages in the admin inbox (`/admin/feedback`).
 */
export const feedbackSlackText = (count: number): string =>
  `${count} feedback ${count === 1 ? "message" : "messages"} in the last 24 hours (see /admin/feedback)`;

/*
 * Throttle state, per isolate, as for the moderation alert (see
 * services/moderation-alert.ts for the trade-offs): a post when the 24-hour
 * count reaches 1, 5, 10, 25, 50, 100, ..., otherwise at most one per
 * isolate every MODERATION_ALERT_INTERVAL_MS (10 minutes). A flood of
 * submissions therefore becomes a handful of count messages, not one post
 * each.
 */
let lastFeedbackAlertAt: number | null = null;

/**
 * After feedback is stored, counts the last 24 hours of feedback and posts
 * the count to the Slack incoming webhook in the background (`waitUntil`),
 * throttled by {@link shouldSendModerationAlert}. Does nothing unless
 * `MODERATION_SLACK_WEBHOOK` is set. Failures are logged (status or error
 * name only) and swallowed.
 */
export const scheduleFeedbackNotification = (
  c: AppContext,
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
): void => {
  const webhookUrl = c.env.MODERATION_SLACK_WEBHOOK?.trim();
  if (!webhookUrl) return;

  const task = (async () => {
    const at = now();
    let previous: number | null = null;
    let claimed = false;
    /** A failed post must not use up the window. */
    const release = () => {
      if (claimed && lastFeedbackAlertAt === at) lastFeedbackAlertAt = previous;
    };
    try {
      const count = await c
        .get("feedbackService")
        .countSince(new Date(at - FEEDBACK_ALERT_WINDOW_MS));
      if (!shouldSendModerationAlert(count, lastFeedbackAlertAt, at)) return;
      // Claim the window before the request so concurrent tasks do not all post.
      previous = lastFeedbackAlertAt;
      lastFeedbackAlertAt = at;
      claimed = true;
      const response = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: feedbackSlackText(count) }),
      });
      if (!response.ok) {
        release();
        logger.warn("Feedback Slack webhook failed", { status: response.status });
      }
    } catch (error) {
      release();
      logger.warn("Feedback Slack webhook failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  })();

  try {
    c.executionCtx.waitUntil(task);
  } catch {
    // No ExecutionContext (e.g. some unit-test harnesses): let it run unattended.
  }
};

export const __feedbackAlertTestUtils = {
  reset: () => {
    lastFeedbackAlertAt = null;
  },
};
