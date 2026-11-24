/**
 * `POST /api/feedback`: validation, storage, legacy body shapes (Flutter app
 * form posts, legacy website JSON), rate limiting, optional Slack and
 * Turnstile, and that the email address and IP never reach the logs.
 *
 * The admin inbox is covered in feedback.admin.spec.ts (kept apart because
 * every request opens its own database pool).
 */
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __feedbackAlertTestUtils } from "../../src/services/feedback/notify";
import { TURNSTILE_SITEVERIFY_URL } from "../../src/services/feedback/turnstile";
import type { Env } from "../../src/types";
import { getPrismaClient } from "./setup";
import { cleanupManager } from "./utils/cleanup";
import {
  callApi,
  createCapturingExecutionContext,
  jsonRequest,
  readJson,
} from "./utils/test-client";

const WEBHOOK = "https://hooks.slack.test/services/T000/B000/FEEDBACK";
const IP = "203.0.113.77";
const EMAIL = "reply-to-me@example.org";

const marker = () => `fb-${randomBytes(6).toString("hex")}`;

/** Rows whose text contains `tag`, tracked for cleanup. */
const storedWith = async (tag: string) => {
  const rows = await getPrismaClient().feedback.findMany({
    where: { feedback_text: { contains: tag } },
  });
  for (const row of rows) cleanupManager.trackFeedback(row.id);
  return rows;
};

const postJson = (
  body: unknown,
  options: { headers?: Record<string, string>; env?: Partial<Env>; ctx?: ExecutionContext } = {},
) =>
  callApi(
    "/api/feedback",
    jsonRequest("POST", body, { "cf-connecting-ip": IP, ...options.headers }),
    {
      env: options.env,
      ctx: options.ctx,
    },
  );

/** Exactly what Dart's `http.post(uri, body: Map)` sends: a URL-encoded form, no Origin. */
const postLegacyForm = (fields: Record<string, string>, env?: Partial<Env>) =>
  callApi(
    "/api/feedback",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=utf-8",
        "user-agent": "Dart/3.5 (dart:io)",
        "cf-connecting-ip": IP,
      },
      body: new URLSearchParams(fields).toString(),
    },
    { env },
  );

const realFetch = globalThis.fetch;

type Intercepted = { url: string; body: string };

/** Replaces fetch for the given URLs only; everything else passes through. */
const interceptFetch = (responses: Record<string, () => Response | Promise<Response>>) => {
  const calls: Intercepted[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const respond = responses[url];
    if (respond) {
      calls.push({ url, body: String(init?.body ?? "") });
      return Promise.resolve(respond());
    }
    return realFetch(input, init);
  }) as typeof fetch;
  return calls;
};

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  __feedbackAlertTestUtils.reset();
});

describe("POST /api/feedback: storage", () => {
  it("stores JSON feedback and answers 200", async () => {
    const tag = marker();
    const response = await postJson({
      text: `  The map is great ${tag}  `,
      email: ` ${EMAIL} `,
      route: "/loos/abc",
    });

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ ok: true, message: "Thank you for your feedback." });
    const rows = await storedWith(tag);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feedback_text: `The map is great ${tag}`,
      email: EMAIL,
      route: "/loos/abc",
    });
    expect(rows[0]?.created_at).toBeInstanceOf(Date);
  });

  it("stores no email when it is empty, null or missing, and defaults the route", async () => {
    for (const extra of [{ email: "" }, { email: null }, {}]) {
      const tag = marker();
      const response = await postJson({ text: `No email ${tag}`, ...extra });
      expect(response.status).toBe(200);
      const [row] = await storedWith(tag);
      expect(row?.email).toBeNull();
      expect(row?.route).toBe("");
    }
  });

  it("truncates a long route instead of rejecting it", async () => {
    const tag = marker();
    const response = await postJson({ text: tag, route: `/${"r".repeat(400)}` });
    expect(response.status).toBe(200);
    const [row] = await storedWith(tag);
    expect(row?.route).toHaveLength(255);
  });

  it("refuses unknown fields, in JSON and in the Flutter form encoding", async () => {
    const tag = marker();
    expect((await postJson({ text: tag, extra: { a: 1 } })).status).toBe(400);
    expect((await postLegacyForm({ text: tag, email: "", route: "app", extra: "1" })).status).toBe(
      400,
    );
    expect(await storedWith(tag)).toHaveLength(0);
  });

  it("accepts text of exactly 5000 characters", async () => {
    const tag = marker();
    const response = await postJson({ text: `${tag}${"x".repeat(5000 - tag.length)}` });
    expect(response.status).toBe(200);
    expect(await storedWith(tag)).toHaveLength(1);
  });
});

describe("POST /api/feedback: legacy clients", () => {
  it("accepts the Flutter app's form post (no Origin, empty email) with a 200", async () => {
    const tag = marker();
    const route = "Toilet Map uk.org.toiletmap.mobile_app Version: 2.0.1 Build# 42 Android";
    const response = await postLegacyForm({ text: `From the app ${tag}`, email: "", route });

    // The app shows "Your feedback has been submitted." only for exactly 200.
    expect(response.status).toBe(200);
    const [row] = await storedWith(tag);
    expect(row).toMatchObject({ feedback_text: `From the app ${tag}`, email: null, route });
  });

  it("accepts the Flutter app's form post with an email address", async () => {
    const tag = marker();
    const response = await postLegacyForm({ text: tag, email: EMAIL, route: "app" });
    expect(response.status).toBe(200);
    expect((await storedWith(tag))[0]?.email).toBe(EMAIL);
  });

  it("accepts the legacy website's JSON body ({ text, email, route })", async () => {
    const tag = marker();
    const response = await callApi(
      "/api/feedback",
      jsonRequest("POST", { text: `Legacy web ${tag}`, email: "", route: "/" }),
    );
    expect(response.status).toBe(200);
    expect(await storedWith(tag)).toHaveLength(1);
  });

  it("accepts a multipart form", async () => {
    const tag = marker();
    const form = new FormData();
    form.set("text", tag);
    form.set("route", "/feedback");
    const response = await callApi("/api/feedback", { method: "POST", body: form });
    expect(response.status).toBe(200);
    expect(await storedWith(tag)).toHaveLength(1);
  });
});

describe("POST /api/feedback: validation", () => {
  it.each([
    ["missing text", { email: EMAIL }, "text"],
    ["empty text", { text: "" }, "text"],
    ["whitespace-only text", { text: "   \n\t " }, "text"],
    ["non-string text", { text: 42 }, "text"],
    ["text over 5000 characters", { text: "y".repeat(5001) }, "text"],
    ["an invalid email", { text: "hello", email: "not-an-email" }, "email"],
    [
      "an email over 255 characters",
      { text: "hello", email: `${"a".repeat(250)}@example.org` },
      "email",
    ],
  ])("rejects %s with 400", async (_label, body, field) => {
    const before = await getPrismaClient().feedback.count();
    const response = await postJson(body);
    expect(response.status).toBe(400);
    const error = await readJson<{ message: string; issues: Record<string, unknown> }>(response);
    expect(error.message).toBe("Invalid feedback");
    expect(error.issues).toHaveProperty(field);
    expect(await getPrismaClient().feedback.count()).toBe(before);
  });

  it("rejects an empty Flutter form post with 400", async () => {
    const response = await postLegacyForm({ text: "", email: "", route: "app" });
    expect(response.status).toBe(400);
  });

  it("rejects a JSON array, malformed JSON and unsupported content types", async () => {
    expect((await postJson(["text"])).status).toBe(400);

    const malformed = await callApi("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(malformed.status).toBe(400);

    const plain = await callApi("/api/feedback", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "text=hello",
    });
    expect(plain.status).toBe(415);
  });

  it("rejects an oversized body with 413", async () => {
    const response = await callApi("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "z".repeat(200 * 1024) }),
    });
    expect(response.status).toBe(413);
  });

  it("only answers POST", async () => {
    expect((await callApi("/api/feedback")).status).toBe(404);
  });
});

describe("POST /api/feedback: rate limiting", () => {
  it("uses the write limiter under a per-IP feedback key and stores nothing when limited", async () => {
    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    const tag = marker();
    const response = await postJson(
      { text: tag, email: EMAIL },
      { env: { RATE_LIMIT_WRITE: limiter } },
    );

    expect(response.status).toBe(429);
    expect(limiter.limit).toHaveBeenCalledWith({ key: `feedback:${IP}` });
    expect(await storedWith(tag)).toHaveLength(0);
  });

  it("passes when the limiter allows the request", async () => {
    const limiter = { limit: vi.fn(async () => ({ success: true })) };
    const tag = marker();
    const response = await postJson({ text: tag }, { env: { RATE_LIMIT_WRITE: limiter } });
    expect(response.status).toBe(200);
    expect(limiter.limit).toHaveBeenCalledTimes(1);
    expect(await storedWith(tag)).toHaveLength(1);
  });
});

describe("POST /api/feedback: Slack", () => {
  it("posts nothing when no webhook is configured", async () => {
    const calls = interceptFetch({ [WEBHOOK]: () => new Response("ok") });
    const { ctx, settle } = createCapturingExecutionContext();
    const tag = marker();

    const response = await postJson({ text: tag, email: EMAIL }, { ctx });
    expect(response.status).toBe(200);
    await settle();
    expect(calls).toHaveLength(0);
    await storedWith(tag);
  });

  it("posts only a count of recent feedback: never the text, route, email or IP", async () => {
    const calls = interceptFetch({ [WEBHOOK]: () => new Response("ok") });
    const { ctx, settle } = createCapturingExecutionContext();
    const tag = marker();
    const text = `<!channel> <https://evil.example|click> ${tag}`;

    const response = await postJson(
      { text, email: EMAIL, route: "/loos/spam-route" },
      { env: { MODERATION_SLACK_WEBHOOK: WEBHOOK }, ctx },
    );
    expect(response.status).toBe(200);
    await settle();

    expect(calls).toHaveLength(1);
    const message = (JSON.parse(calls[0]?.body ?? "{}") as { text: string }).text;
    expect(message).toMatch(
      /^\d+ feedback messages? in the last 24 hours \(see \/admin\/feedback\)$/,
    );
    for (const secret of [tag, "<!channel>", "evil.example", "spam-route", EMAIL, IP]) {
      expect(calls[0]?.body).not.toContain(secret);
    }

    // The database keeps the full text.
    const [row] = await storedWith(tag);
    expect(row?.feedback_text).toBe(text.trim());
  });

  it("batches a burst into one post instead of one per message", async () => {
    const calls = interceptFetch({ [WEBHOOK]: () => new Response("ok") });
    const { ctx, settle } = createCapturingExecutionContext();
    const tags = [marker(), marker(), marker()];
    for (const tag of tags) {
      const response = await postJson(
        { text: tag },
        { env: { MODERATION_SLACK_WEBHOOK: WEBHOOK }, ctx },
      );
      expect(response.status).toBe(200);
      await settle();
      await storedWith(tag);
    }
    // The first post claims the 10-minute window; the next two only post if
    // the 24-hour count happens to land on a threshold (1, 5, 10, 25, ...).
    const counts = calls.map((call) =>
      Number((JSON.parse(call.body) as { text: string }).text.split(" ")[0]),
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.length).toBeLessThan(tags.length);
    for (const count of counts.slice(1)) {
      expect([5, 10, 25, 50, 100, 250, 500, 1000]).toContain(count);
    }
  });

  it("still answers 200 when the webhook fails", async () => {
    const calls = interceptFetch({ [WEBHOOK]: () => new Response("nope", { status: 500 }) });
    const { ctx, settle } = createCapturingExecutionContext();
    const tag = marker();
    const response = await postJson(
      { text: tag },
      { env: { MODERATION_SLACK_WEBHOOK: WEBHOOK }, ctx },
    );
    expect(response.status).toBe(200);
    await settle();
    expect(calls).toHaveLength(1);
    expect(await storedWith(tag)).toHaveLength(1);
  });
});

describe("POST /api/feedback: Turnstile", () => {
  const SECRET = "test-turnstile-secret";
  const turnstileEnv = { TURNSTILE_SECRET_KEY: SECRET };
  const siteverify = (body: unknown, status = 200) => ({
    [TURNSTILE_SITEVERIFY_URL]: () => new Response(JSON.stringify(body), { status }),
  });

  it("is off by default: no token needed and siteverify is never called", async () => {
    const calls = interceptFetch(siteverify({ success: false }));
    const tag = marker();
    expect((await postJson({ text: tag })).status).toBe(200);
    expect(calls).toHaveLength(0);
    expect(await storedWith(tag)).toHaveLength(1);
  });

  it("when on, rejects a missing token without calling siteverify", async () => {
    const calls = interceptFetch(siteverify({ success: true }));
    const tag = marker();
    const response = await postJson({ text: tag }, { env: turnstileEnv });
    expect(response.status).toBe(403);
    expect((await readJson<{ error: string }>(response)).error).toBe("turnstile_required");
    expect(calls).toHaveLength(0);
    expect(await storedWith(tag)).toHaveLength(0);
  });

  it("when on, rejects a token siteverify refuses", async () => {
    interceptFetch(siteverify({ success: false, "error-codes": ["invalid-input-response"] }));
    const tag = marker();
    const response = await postJson({ text: tag, turnstileToken: "bad" }, { env: turnstileEnv });
    expect(response.status).toBe(403);
    expect((await readJson<{ error: string }>(response)).error).toBe("turnstile_failed");
    expect(await storedWith(tag)).toHaveLength(0);
  });

  it("when on, stores feedback with a valid token and never sends the IP", async () => {
    const calls = interceptFetch(siteverify({ success: true }));
    const tag = marker();
    const response = await postJson(
      { text: tag, turnstileToken: "good-token" },
      { env: turnstileEnv },
    );
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ secret: SECRET, response: "good-token" });
    expect(await storedWith(tag)).toHaveLength(1);
  });

  it("when on, accepts the widget's form field name", async () => {
    interceptFetch(siteverify({ success: true }));
    const tag = marker();
    const response = await postLegacyForm(
      { text: tag, "cf-turnstile-response": "good-token" },
      turnstileEnv,
    );
    expect(response.status).toBe(200);
    expect(await storedWith(tag)).toHaveLength(1);
  });

  it("when on, answers 503 and stores nothing if siteverify is unavailable", async () => {
    interceptFetch(siteverify({}, 502));
    const tag = marker();
    const response = await postJson({ text: tag, turnstileToken: "t" }, { env: turnstileEnv });
    expect(response.status).toBe(503);
    expect(await storedWith(tag)).toHaveLength(0);
  });
});

describe("POST /api/feedback: logging", () => {
  const captureConsole = () => {
    const lines: string[] = [];
    const record = (...args: unknown[]) => {
      lines.push(
        args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "),
      );
    };
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation(record);
    }
    return lines;
  };

  it("never logs the email address or IP: success, rate limits, Slack failure, Turnstile failure", async () => {
    const lines = captureConsole();
    interceptFetch({
      [WEBHOOK]: () => new Response("nope", { status: 500 }),
      [TURNSTILE_SITEVERIFY_URL]: () =>
        new Response(JSON.stringify({ success: false }), { status: 200 }),
    });
    const { ctx, settle } = createCapturingExecutionContext();
    const headers = { "x-forwarded-for": IP, "user-agent": "Dart/3.5 (dart:io)" };

    const ok = await postJson(
      { text: marker(), email: EMAIL },
      { headers, env: { MODERATION_SLACK_WEBHOOK: WEBHOOK }, ctx },
    );
    expect(ok.status).toBe(200);
    await settle();

    const limited = await postJson(
      { text: marker(), email: EMAIL },
      { headers, env: { RATE_LIMIT_WRITE: { limit: async () => ({ success: false }) } } },
    );
    expect(limited.status).toBe(429);

    // The global read limiter runs first for every /api/* request; when it trips on
    // feedback it must not log its `read:<ip>` key either.
    const readLimited = await postJson(
      { text: marker(), email: EMAIL },
      { headers, env: { RATE_LIMIT_READ: { limit: async () => ({ success: false }) } } },
    );
    expect(readLimited.status).toBe(429);
    expect(lines.some((line) => line.includes("Rate limit exceeded"))).toBe(true);

    const refused = await postJson(
      { text: marker(), email: EMAIL, turnstileToken: "bad" },
      { headers, env: { TURNSTILE_SECRET_KEY: "secret" } },
    );
    expect(refused.status).toBe(403);

    const invalid = await postJson({ text: "", email: EMAIL }, { headers });
    expect(invalid.status).toBe(400);

    // The request logger and the Slack failure did log something...
    expect(lines.some((line) => line.includes("/api/feedback"))).toBe(true);
    expect(lines.some((line) => line.includes("Feedback Slack webhook failed"))).toBe(true);
    // ...but never the email, the IP or the user agent.
    const output = lines.join("\n");
    expect(output).not.toContain(EMAIL);
    expect(output).not.toContain(IP);
    expect(output).not.toContain("Dart/3.5");

    vi.restoreAllMocks();
    await storedWith("fb-");
  });
});
