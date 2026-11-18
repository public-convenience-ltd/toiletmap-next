import type { Context } from "hono";
import type { AppVariables, Env } from "../../types";
import { logger } from "../../utils/logger";

type AppContext = Context<{ Variables: AppVariables; Bindings: Env }>;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Longest feedback excerpt posted to Slack; the full text stays in the database. */
export const FEEDBACK_SLACK_EXCERPT_LENGTH = 500;
const ROUTE_EXCERPT_LENGTH = 120;

/**
 * Slack treats `<`, `>` and `&` as control characters (`<!channel>`,
 * `<https://link|label>`), so escape them: a submitter must not be able to
 * ping the channel or plant a disguised link.
 */
const escapeSlack = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const truncate = (value: string, max: number): string => {
  const chars = Array.from(value);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : value;
};

/**
 * The whole Slack message: an excerpt of the feedback and the page or app it
 * came from. Never the email address or IP.
 */
export const feedbackSlackText = ({ text, route }: { text: string; route: string }): string => {
  const excerpt = escapeSlack(truncate(text.trim(), FEEDBACK_SLACK_EXCERPT_LENGTH));
  const from = route ? escapeSlack(truncate(route, ROUTE_EXCERPT_LENGTH)) : "unknown";
  return `New feedback:\n${excerpt}\n------\nFrom: ${from}`;
};

/**
 * After feedback is stored, posts an excerpt to the Slack incoming webhook in
 * the background (`waitUntil`), so the submitter's response is not delayed.
 * Does nothing unless `MODERATION_SLACK_WEBHOOK` is set. Failures are logged
 * (status or error message only) and swallowed.
 */
export const scheduleFeedbackNotification = (
  c: AppContext,
  feedback: { text: string; route: string },
  fetchImpl: FetchLike = fetch,
): void => {
  const webhookUrl = c.env.MODERATION_SLACK_WEBHOOK?.trim();
  if (!webhookUrl) return;

  const task = (async () => {
    try {
      const response = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: feedbackSlackText(feedback) }),
      });
      if (!response.ok) {
        logger.warn("Feedback Slack webhook failed", { status: response.status });
      }
    } catch (error) {
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
