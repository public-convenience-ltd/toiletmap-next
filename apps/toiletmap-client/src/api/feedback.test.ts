import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ERROR_MESSAGES,
  FEEDBACK_TEXT_MAX_LENGTH,
  feedbackBody,
  feedbackHref,
  feedbackOutcome,
  feedbackRoute,
  NETWORK_MESSAGE,
  SERVER_MESSAGE,
  sendFeedback,
  VERIFICATION_MESSAGE,
  validateFeedback,
} from "./feedback";

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("validateFeedback", () => {
  it("needs a message, ignoring surrounding spaces", () => {
    expect(validateFeedback({ text: "", email: "" })).toEqual({
      text: ERROR_MESSAGES.textRequired,
    });
    expect(validateFeedback({ text: " \n\t ", email: "" })).toEqual({
      text: ERROR_MESSAGES.textRequired,
    });
    expect(validateFeedback({ text: " Hi ", email: "" })).toEqual({});
  });

  it("allows exactly the server's 5000 characters, counting characters not UTF-16 units", () => {
    expect(validateFeedback({ text: "a".repeat(FEEDBACK_TEXT_MAX_LENGTH), email: "" })).toEqual({});
    expect(
      validateFeedback({ text: "a".repeat(FEEDBACK_TEXT_MAX_LENGTH + 1), email: "" }).text,
    ).toBe(ERROR_MESSAGES.textTooLong);
    // 5000 emoji are 10000 UTF-16 units but 5000 characters.
    expect(validateFeedback({ text: "🚻".repeat(FEEDBACK_TEXT_MAX_LENGTH), email: "" })).toEqual(
      {},
    );
  });

  it("treats the email as optional, and checks it only when given", () => {
    expect(validateFeedback({ text: "Hi", email: "   " })).toEqual({});
    expect(validateFeedback({ text: "Hi", email: " someone@example.com " })).toEqual({});
    for (const bad of [
      "someone",
      "someone@",
      "@example.com",
      "a@b",
      "a b@example.com",
      "a@@b.com",
    ]) {
      expect(validateFeedback({ text: "Hi", email: bad }).email, bad).toBe(
        ERROR_MESSAGES.emailInvalid,
      );
    }
    expect(validateFeedback({ text: "Hi", email: `${"a".repeat(250)}@example.com` }).email).toBe(
      ERROR_MESSAGES.emailTooLong,
    );
  });
});

describe("feedbackBody / feedbackRoute / feedbackHref", () => {
  it("trims the fields and sends no email as an empty string", () => {
    expect(feedbackBody({ text: " Hi ", email: " ", route: "/feedback" })).toEqual({
      text: "Hi",
      email: "",
      route: "/feedback",
    });
  });

  it("records the toilet's page as the route when the message is about one", () => {
    expect(feedbackRoute("abc123")).toBe("/loos/abc123");
    expect(feedbackRoute(null)).toBe("/feedback");
    expect(feedbackHref("abc123")).toBe("/feedback?loo=abc123");
    expect(feedbackHref()).toBe("/feedback");
  });
});

describe("feedbackOutcome", () => {
  it("maps the server's answers", async () => {
    expect(await feedbackOutcome(jsonResponse(200, { ok: true }))).toEqual({ kind: "sent" });
    expect(await feedbackOutcome(jsonResponse(429, {}))).toEqual({ kind: "rateLimited" });
    expect(await feedbackOutcome(jsonResponse(500, { message: "Prisma said" }))).toEqual({
      kind: "error",
      message: SERVER_MESSAGE,
    });
    expect(await feedbackOutcome(new Response("Forbidden", { status: 403 }))).toEqual({
      kind: "error",
      message: SERVER_MESSAGE,
    });
  });

  it("puts a 400's field issues on the fields, in our words", async () => {
    const outcome = await feedbackOutcome(
      jsonResponse(400, {
        message: "Invalid feedback",
        issues: { _errors: [], text: { _errors: ["x"] }, email: { _errors: ["y"] } },
      }),
    );
    expect(outcome).toEqual({
      kind: "invalid",
      errors: { text: ERROR_MESSAGES.textRequired, email: ERROR_MESSAGES.emailInvalid },
    });
  });

  it("says when the server's Turnstile check refused the message (not a generic server error)", async () => {
    // TURNSTILE_SECRET_KEY set on the server: the website form sends no token.
    for (const [status, error] of [
      [403, "turnstile_required"],
      [403, "turnstile_failed"],
      [503, "turnstile_unavailable"],
    ] as const) {
      expect(await feedbackOutcome(jsonResponse(status, { message: "x", error }))).toEqual({
        kind: "error",
        message: VERIFICATION_MESSAGE,
      });
    }
    // Any other 403 or 503 is still our side's problem.
    expect(await feedbackOutcome(jsonResponse(503, { message: "Down" }))).toEqual({
      kind: "error",
      message: SERVER_MESSAGE,
    });
  });

  it("treats a 400 with no field issues (e.g. bad JSON) as an error", async () => {
    expect(await feedbackOutcome(jsonResponse(400, { message: "Invalid JSON body" }))).toEqual({
      kind: "error",
      message: SERVER_MESSAGE,
    });
    expect(await feedbackOutcome(new Response("not json", { status: 400 }))).toEqual({
      kind: "error",
      message: SERVER_MESSAGE,
    });
  });
});

describe("sendFeedback", () => {
  it("posts JSON to /api/feedback, same-origin", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendFeedback("", { text: " Hi ", email: "", route: "/loos/x" })).toEqual({
      kind: "sent",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/feedback", {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ text: "Hi", email: "", route: "/loos/x" }),
    });
  });

  it("reports a network failure without logging what was typed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      await sendFeedback("", { text: "secret words", email: "me@example.com", route: "/feedback" }),
    ).toEqual({ kind: "error", message: NETWORK_MESSAGE });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("secret words");
    expect(logged).not.toContain("me@example.com");
  });
});
