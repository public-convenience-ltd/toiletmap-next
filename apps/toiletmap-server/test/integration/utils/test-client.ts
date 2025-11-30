import worker from "../../../src/index";

const baseUrl = "https://integration.test";

export const callApi = async (path: string, init?: RequestInit) => {
  const request = new Request(`${baseUrl}${path}`, init);
  // Create a mock ExecutionContext for Node.js environment
  const ctx = {
    waitUntil: () => {
      // No-op mock
    },
    passThroughOnException: () => {
      // No-op mock
    },
  };
  // Use process.env instead of cloudflare:test env
  const env = {
    ...process.env,
    TEST_HYPERDRIVE: {
      connectionString:
        process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TEST_HYPERDRIVE ||
        "postgresql://postgres:postgres@localhost:54322/postgres",
    },
    HYPERDRIVE: {
      connectionString:
        process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_TEST_HYPERDRIVE ||
        "postgresql://postgres:postgres@localhost:54322/postgres",
    },
  } as any;
  const response = await worker.fetch(request, env, ctx as any);
  return response;
};

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
