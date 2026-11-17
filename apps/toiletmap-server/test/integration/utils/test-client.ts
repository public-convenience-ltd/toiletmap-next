import worker from "../../../src/index";
import { buildTestEnv, createTestExecutionContext } from "./env";

const baseUrl = "https://integration.test";

/** Invokes the Worker's fetch handler directly, without a network hop. */
export const callApi = (path: string, init?: RequestInit): Promise<Response> => {
  const request = new Request(`${baseUrl}${path}`, init);
  return worker.fetch(request, buildTestEnv(), createTestExecutionContext());
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
