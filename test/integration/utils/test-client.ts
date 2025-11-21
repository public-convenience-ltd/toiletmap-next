import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../../../src/index';

const baseUrl = 'https://integration.test';

export const callApi = async (path: string, init?: RequestInit) => {
  const request = new Request(`${baseUrl}${path}`, init);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
};

export const jsonRequest = (
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): RequestInit => ({
  method,
  headers: {
    'content-type': 'application/json',
    ...headers,
  },
  body: JSON.stringify(body),
});
