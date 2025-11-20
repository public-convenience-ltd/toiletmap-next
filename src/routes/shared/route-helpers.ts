import { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { AppVariables } from '../../types';

export type AppContext = Context<{ Variables: AppVariables }>;

/**
 * Uniform error handling wrapper so individual handlers stay lean.
 */
export const handleRoute = async (
  c: AppContext,
  label: string,
  handler: () => Promise<Response>,
) => {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    console.error(`${label} route error`, error);
    return c.json({ message: 'Internal Server Error' }, 500);
  }
};

export const badRequest = (
  c: AppContext,
  message: string,
  issues?: unknown,
) =>
  c.json(
    issues
      ? {
          message,
          issues,
        }
      : { message },
    400,
  );

export const notFound = (c: AppContext, message: string) =>
  c.json({ message }, 404);
