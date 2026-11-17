import worker from "../../../src/index";
import type { Env } from "../../../src/types";
import { buildTestEnv, createTestExecutionContext } from "./env";

const baseUrl = "https://integration.test";

/** Invokes the Worker's fetch handler directly, without a network hop. */
export const callApi = (
  path: string,
  init?: RequestInit,
  options: { env?: Partial<Env>; ctx?: ExecutionContext } = {},
): Promise<Response> => {
  const request = new Request(`${baseUrl}${path}`, init);
  return worker.fetch(
    request,
    buildTestEnv(options.env),
    options.ctx ?? createTestExecutionContext(),
  );
};

/**
 * An ExecutionContext that keeps everything passed to `waitUntil`, so a test
 * can await background work (e.g. moderation alerts).
 */
export const createCapturingExecutionContext = () => {
  const tasks: Promise<unknown>[] = [];
  const ctx: ExecutionContext = {
    waitUntil: (promise: Promise<unknown>) => {
      tasks.push(promise);
    },
    passThroughOnException: () => undefined,
    props: undefined,
    get exports(): Cloudflare.Exports {
      throw new Error("ctx.exports is not available in tests.");
    },
  };
  return { ctx, settle: () => Promise.allSettled(tasks) };
};

/**
 * Parses a JSON response body as `T`.
 *
 * This is a test-only assertion of the response shape: the body is not
 * validated, so pair it with `expect(...)` checks on the fields that matter.
 */
export const readJson = async <T>(response: Response): Promise<T> => (await response.json()) as T;

export const jsonRequest = (
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): RequestInit => ({
  method,
  headers: {
    "content-type": "application/json",
    ...headers,
  },
  body: JSON.stringify(body),
});
