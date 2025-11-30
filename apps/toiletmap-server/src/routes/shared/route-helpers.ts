import type { Context } from "hono";
import type { AppVariables, Env } from "../../types";

type AppContext = Context<{ Variables: AppVariables; Bindings: Env }>;

/**
 * Uniform error handling wrapper so individual handlers stay lean.
 */
export const handleRoute = (_c: AppContext, _label: string, handler: () => Promise<Response>) => {
  return handler();
};

export const badRequest = (c: AppContext, message: string, issues?: unknown) =>
  c.json(
    issues
      ? {
          message,
          issues,
        }
      : { message },
    400,
  );

export const notFound = (c: AppContext, message: string) => c.json({ message }, 404);
