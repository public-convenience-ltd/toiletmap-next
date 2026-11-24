/**
 * `POST /api/feedback`: public, unauthenticated feedback from the website and
 * the Flutter app.
 *
 * Legacy compatibility (kept on purpose):
 * - The Flutter app (`apps/toiletmap-app/lib/model/user_agent_client.dart`)
 *   posts `application/x-www-form-urlencoded` `text`, `email` (often "") and
 *   `route` (an app/version string), sends no Origin header, and treats only
 *   HTTP 200 as success.
 * - The legacy website (`toiletmap/src/pages/api/feedback`) posted the same
 *   three fields as JSON.
 * Both shapes are accepted and success is 200. Unknown fields are refused
 * (400); none of those callers sends any.
 *
 * Privacy: the email address and the client IP are never logged, and Slack
 * only ever gets a count of recent messages. The IP is only used as the
 * rate-limit key.
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { rateLimiters } from "../../middleware/cloudflare-rate-limit";
import {
  FEEDBACK_EMAIL_MAX_LENGTH,
  FEEDBACK_ROUTE_MAX_LENGTH,
  FEEDBACK_TEXT_MAX_LENGTH,
} from "../../services/feedback/feedback.service";
import { scheduleFeedbackNotification } from "../../services/feedback/notify";
import { TURNSTILE_TOKEN_MAX_LENGTH, verifyTurnstile } from "../../services/feedback/turnstile";
import type { AppVariables, Env } from "../../types";
import { logger } from "../../utils/logger";

/** Generous for 5000 four-byte characters, percent-encoded. */
const FEEDBACK_BODY_MAX_BYTES = 128 * 1024;

const TEXT_REQUIRED = "Feedback text is required";

const emailFormat = z.email();

/**
 * Strict: exactly the fields the Flutter app, the legacy website and this
 * site's form send (text, email, route) plus the Turnstile token. Anything
 * else is a 400.
 */
const feedbackBodySchema = z
  .object({
    text: z
      .string({ error: TEXT_REQUIRED })
      .trim()
      .min(1, TEXT_REQUIRED)
      .max(
        FEEDBACK_TEXT_MAX_LENGTH,
        `Feedback must be ${FEEDBACK_TEXT_MAX_LENGTH} characters or fewer`,
      ),
    /** Optional; "" (what the Flutter app sends when the field is empty) means none. */
    email: z
      .string()
      .trim()
      .max(FEEDBACK_EMAIL_MAX_LENGTH, "Email address is too long")
      .nullish()
      .transform((value) => (value ? value : null))
      .refine((value) => value === null || emailFormat.safeParse(value).success, {
        message: "Enter a valid email address, or leave it blank",
      }),
    /** Page path or app/version string. Metadata, so it is trimmed to fit rather than rejected. */
    route: z
      .string()
      .nullish()
      .transform((value) =>
        Array.from((value ?? "").trim())
          .slice(0, FEEDBACK_ROUTE_MAX_LENGTH)
          .join(""),
      ),
    turnstileToken: z.string().max(TURNSTILE_TOKEN_MAX_LENGTH).optional(),
    /** The field name Turnstile's widget adds to a plain HTML form. */
    "cf-turnstile-response": z.string().max(TURNSTILE_TOKEN_MAX_LENGTH).optional(),
  })
  .strict();

type BodyResult = { ok: true; value: unknown } | { ok: false; status: 400 | 415; message: string };

const readBody = async (request: Request, parseForm: () => Promise<unknown>) => {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    try {
      return { ok: true, value: await request.json() } satisfies BodyResult;
    } catch {
      return { ok: false, status: 400, message: "Invalid JSON body" } satisfies BodyResult;
    }
  }
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    try {
      return { ok: true, value: await parseForm() } satisfies BodyResult;
    } catch {
      return { ok: false, status: 400, message: "Invalid form body" } satisfies BodyResult;
    }
  }
  return {
    ok: false,
    status: 415,
    message: "Send feedback as JSON or as a URL-encoded form",
  } satisfies BodyResult;
};

export const feedbackRouter = new Hono<{ Variables: AppVariables; Bindings: Env }>();

feedbackRouter.post(
  "/",
  rateLimiters.feedback,
  bodyLimit({
    maxSize: FEEDBACK_BODY_MAX_BYTES,
    onError: (c) => c.json({ message: "Feedback is too large" }, 413),
  }),
  async (c) => {
    const body: BodyResult = await readBody(c.req.raw, () => c.req.parseBody());
    if (!body.ok) return c.json({ message: body.message }, body.status);

    const parsed = feedbackBodySchema.safeParse(body.value);
    if (!parsed.success) {
      return c.json({ message: "Invalid feedback", issues: parsed.error.format() }, 400);
    }
    const { text, email, route } = parsed.data;

    const secret = c.env.TURNSTILE_SECRET_KEY?.trim();
    if (secret) {
      const token = parsed.data.turnstileToken ?? parsed.data["cf-turnstile-response"];
      if (!token) {
        return c.json(
          { message: "Please complete the verification", error: "turnstile_required" },
          403,
        );
      }
      const verdict = await verifyTurnstile({ secret, token });
      if (verdict === "unavailable") {
        return c.json(
          {
            message: "Could not verify the submission. Please try again.",
            error: "turnstile_unavailable",
          },
          503,
        );
      }
      if (verdict === "failed") {
        return c.json(
          { message: "Verification failed. Please try again.", error: "turnstile_failed" },
          403,
        );
      }
    }

    try {
      await c.get("feedbackService").create({ text, email, route });
    } catch (error) {
      // Name and code only: Prisma messages can echo the submitted values.
      logger.error("Storing feedback failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorCode:
          typeof error === "object" && error !== null && "code" in error
            ? String((error as { code: unknown }).code)
            : undefined,
      });
      return c.json({ message: "Could not save your feedback. Please try again." }, 500);
    }

    // Counts only (never the text), throttled: see services/feedback/notify.ts.
    scheduleFeedbackNotification(c);

    // 200, not 201: the Flutter app treats only 200 as success.
    return c.json({ ok: true, message: "Thank you for your feedback." }, 200);
  },
);
