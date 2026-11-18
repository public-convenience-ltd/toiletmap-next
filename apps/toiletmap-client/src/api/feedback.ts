/**
 * The feedback form's rules and its call to `POST /api/feedback` (toiletmap-server
 * src/routes/feedback/index.ts). Pure and browser-safe: the /feedback page uses the same
 * validation and response handling on the server (the form also works without JavaScript),
 * and the FeedbackForm island uses them in the browser.
 */
import { getApiUrl } from "./config";

/** The server's limits (the `feedback` table's column sizes). */
export const FEEDBACK_TEXT_MAX_LENGTH = 5000;
export const FEEDBACK_EMAIL_MAX_LENGTH = 255;

/** The feedback page, and its query parameter for "this is about toilet X". */
export const FEEDBACK_PATH = "/feedback";
export const FEEDBACK_LOO_PARAM = "loo";

/** `/feedback?loo=<id>`: the feedback page, about one toilet. */
export const feedbackHref = (looId?: string | null): string =>
  looId ? `${FEEDBACK_PATH}?${FEEDBACK_LOO_PARAM}=${encodeURIComponent(looId)}` : FEEDBACK_PATH;

/** What the form sends. `route` says where it came from: the toilet's page, or /feedback. */
export interface FeedbackInput {
  text: string;
  email: string;
  route: string;
}

export interface FeedbackErrors {
  text?: string;
  email?: string;
}

/** The fields in page order (the error summary lists them in this order). */
export const FEEDBACK_FIELDS = ["text", "email"] as const;
export type FeedbackField = (typeof FEEDBACK_FIELDS)[number];

export const ERROR_MESSAGES = {
  textRequired: "Enter your message.",
  textTooLong: "Keep your message to 5,000 characters or fewer.",
  emailInvalid:
    "Enter an email address in the right format, like name@example.com, or leave it blank.",
  emailTooLong: `Enter an email address of ${FEEDBACK_EMAIL_MAX_LENGTH} characters or fewer, or leave it blank.`,
} as const;

/**
 * Close to the server's check (zod `z.email()`): one @, no spaces, a dot in the domain.
 * The server has the last word; its 400 is mapped back onto the field.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** Characters, not UTF-16 units, as the server counts them. */
const length = (value: string) => Array.from(value).length;

/** The form's own checks, the same as the server's. Empty when it can be sent. */
export function validateFeedback({ text, email }: Pick<FeedbackInput, "text" | "email">) {
  const errors: FeedbackErrors = {};
  const message = text.trim();
  if (!message) errors.text = ERROR_MESSAGES.textRequired;
  else if (length(message) > FEEDBACK_TEXT_MAX_LENGTH) errors.text = ERROR_MESSAGES.textTooLong;
  const address = email.trim();
  if (address) {
    if (address.length > FEEDBACK_EMAIL_MAX_LENGTH) errors.email = ERROR_MESSAGES.emailTooLong;
    else if (!EMAIL_PATTERN.test(address)) errors.email = ERROR_MESSAGES.emailInvalid;
  }
  return errors;
}

export const hasErrors = (errors: FeedbackErrors): boolean =>
  FEEDBACK_FIELDS.some((field) => errors[field]);

/** The JSON body for `POST /api/feedback`: trimmed, with no email as "". */
export const feedbackBody = ({ text, email, route }: FeedbackInput) => ({
  text: text.trim(),
  email: email.trim(),
  route,
});

export type FeedbackOutcome =
  | { kind: "sent" }
  /** 400: the server refused a field (mapped onto the form). */
  | { kind: "invalid"; errors: FeedbackErrors }
  /** 429: too many messages from this connection in a short time. */
  | { kind: "rateLimited" }
  | { kind: "error"; message: string };

export const RATE_LIMITED_MESSAGE =
  "You've sent several messages in a short time. Please wait a few minutes, then try again. Your message is still here.";
export const NETWORK_MESSAGE =
  "We couldn't send your message. Check your connection and try again. Your message is still here.";
export const SERVER_MESSAGE =
  "Something went wrong on our side and your message wasn't sent. Please try again in a moment. Your message is still here.";
/**
 * 403/503 with `error: "turnstile_*"`: the server wants a Turnstile check this form can't
 * do yet (TURNSTILE_SECRET_KEY was set before the form had a widget), or couldn't run it.
 */
export const VERIFICATION_MESSAGE =
  "We couldn't check that this message came from a person, so it wasn't sent. Please try again later. Your message is still here.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** zod's `error.format()` shape: `{ text: { _errors: ["…"] } }`. */
const hasIssue = (issues: unknown, field: string): boolean => {
  if (!isRecord(issues)) return false;
  const entry = issues[field];
  return isRecord(entry) && Array.isArray(entry._errors) && entry._errors.length > 0;
};

/**
 * What a `POST /api/feedback` response means for the form. Our own wording, never the
 * server's: its messages are for developers.
 */
export async function feedbackOutcome(response: Response): Promise<FeedbackOutcome> {
  if (response.ok) return { kind: "sent" };
  if (response.status === 429) return { kind: "rateLimited" };
  if (response.status === 400 || response.status === 403 || response.status === 503) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const code = isRecord(body) && typeof body.error === "string" ? body.error : "";
    if (code.startsWith("turnstile_")) return { kind: "error", message: VERIFICATION_MESSAGE };
    if (response.status !== 400) return { kind: "error", message: SERVER_MESSAGE };
    const issues = isRecord(body) ? body.issues : null;
    const errors: FeedbackErrors = {};
    if (hasIssue(issues, "text")) errors.text = ERROR_MESSAGES.textRequired;
    if (hasIssue(issues, "email")) errors.email = ERROR_MESSAGES.emailInvalid;
    if (hasErrors(errors)) return { kind: "invalid", errors };
  }
  return { kind: "error", message: SERVER_MESSAGE };
}

/** Sends feedback from the browser, through the same-origin /api proxy. */
export async function sendFeedback(apiUrl: string, input: FeedbackInput): Promise<FeedbackOutcome> {
  let response: Response;
  try {
    response = await fetch(getApiUrl(apiUrl, "/api/feedback"), {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(feedbackBody(input)),
    });
  } catch (error) {
    console.error("Sending feedback failed:", error instanceof Error ? error.name : error);
    return { kind: "error", message: NETWORK_MESSAGE };
  }
  return feedbackOutcome(response);
}

/** The `route` stored with a message: the toilet's page when it's about one. */
export const feedbackRoute = (looId?: string | null): string =>
  looId ? `/loos/${encodeURIComponent(looId)}` : FEEDBACK_PATH;
