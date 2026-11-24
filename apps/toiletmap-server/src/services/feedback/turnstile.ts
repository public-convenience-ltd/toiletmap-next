import { logger } from "../../utils/logger";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Longest token Turnstile issues is 2048 characters. */
export const TURNSTILE_TOKEN_MAX_LENGTH = 2048;

export type TurnstileResult = "passed" | "failed" | "unavailable";

/**
 * Verifies a Cloudflare Turnstile token with the siteverify API. Only called
 * when `TURNSTILE_SECRET_KEY` is set. The client IP is deliberately not sent
 * (it is optional). Never throws: a network or parse error is "unavailable".
 */
export const verifyTurnstile = async ({
  secret,
  token,
  fetchImpl = fetch,
}: {
  secret: string;
  token: string;
  fetchImpl?: FetchLike;
}): Promise<TurnstileResult> => {
  try {
    const response = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
    });
    if (!response.ok) {
      logger.warn("Turnstile siteverify failed", { status: response.status });
      return "unavailable";
    }
    const body = (await response.json()) as { success?: unknown; "error-codes"?: unknown };
    if (body.success === true) return "passed";
    const codes = Array.isArray(body["error-codes"])
      ? body["error-codes"].filter((code): code is string => typeof code === "string")
      : [];
    // A misconfigured secret is our problem, not the submitter's.
    if (codes.some((code) => code === "missing-input-secret" || code === "invalid-input-secret")) {
      logger.error("Turnstile secret rejected by siteverify", { errorCodes: codes });
      return "unavailable";
    }
    return "failed";
  } catch (error) {
    logger.warn("Turnstile siteverify failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return "unavailable";
  }
};
