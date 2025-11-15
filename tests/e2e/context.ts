import { createApp } from '../../src/app';
import { prisma } from '../../src/prisma';

const app = createApp();

const baseUrl = 'http://localhost';

/** Minimal HTTP client that talks to the in-memory Hono app. */
export const testClient = {
  fetch: (path: string, init?: RequestInit) =>
    app.fetch(new Request(`${baseUrl}${path}`, init)),
  json: async <T>(path: string, init?: RequestInit) => {
    const response = await app.fetch(new Request(`${baseUrl}${path}`, init));
    const data = await response.json();
    return { response, data: data as T };
  },
};

export { prisma };
