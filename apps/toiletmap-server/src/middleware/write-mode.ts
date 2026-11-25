import type { Context, MiddlewareHandler } from "hono";
import { getWriteMode, READ_ONLY_RETRY_AFTER_SECONDS, readOnlyBody } from "../services/write-mode";
import type { AppVariables, Env } from "../types";

type AppContext = Context<{ Variables: AppVariables; Bindings: Env }>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The JSON refusal for a write in read-only mode: 503 with `Retry-After`. */
export const readOnlyResponse = (c: AppContext) =>
  c.json(readOnlyBody, 503, { "Retry-After": String(READ_ONLY_RETRY_AFTER_SECONDS) });

/**
 * Applies the write kill switch (see services/write-mode.ts) to a router.
 * Reads the mode only for state-changing methods (reads never touch KV),
 * refuses them in read-only mode with {@link readOnlyResponse} (or
 * `onReadOnly`), and otherwise stores the mode in `c.var.writeMode` for the
 * route (queue mode is applied by the loo write routes).
 */
export const writeModeGate =
  (
    onReadOnly: (c: AppContext) => Response | Promise<Response> = readOnlyResponse,
  ): MiddlewareHandler<{ Variables: AppVariables; Bindings: Env }> =>
  async (c, next) => {
    if (SAFE_METHODS.has(c.req.method.toUpperCase())) return next();
    const mode = await getWriteMode(c.env);
    if (mode === "read-only") return onReadOnly(c);
    c.set("writeMode", mode);
    return next();
  };
