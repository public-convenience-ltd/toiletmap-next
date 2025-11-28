import { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { AppVariables, Env } from '../../types';

import { logger } from '../../utils/logger';

type AppContext = Context<{ Variables: AppVariables; Bindings: Env }>;

/**
 * Uniform error handling wrapper so individual handlers stay lean.
 */
export const handleRoute = async (
  c: AppContext,
  _label: string,
  handler: () => Promise<Response>,
) => {
  return handler();
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
