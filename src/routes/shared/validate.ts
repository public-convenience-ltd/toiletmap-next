import type { AppContext } from './route-helpers';
import { badRequest } from './route-helpers';
import { ZodSchema } from 'zod';

export const validateBody =
  <T>(schema: ZodSchema<T>) =>
  async (c: AppContext) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return badRequest(c, 'Invalid request body');
    }
    const res = schema.safeParse(body);
    if (!res.success)
      return badRequest(c, 'Invalid request body', res.error.format());
    return res.data;
  };

export const validateQuery =
  <T>(schema: ZodSchema<T>) =>
  (c: AppContext) => {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(c.req.queries())) {
      // if repeated, keep last; adjust if you prefer array semantics
      obj[k] = Array.isArray(v) && v.length === 1 ? v[0] : v;
    }
    const res = schema.safeParse(obj);
    if (!res.success)
      return badRequest(c, 'Invalid query parameters', res.error.format());
    return res.data;
  };
