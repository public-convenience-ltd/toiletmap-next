import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppVariables, Env } from "../types";
import { logger } from "../utils/logger";
import { type AuthOptions, type AuthResult, authenticateRequest } from "./auth-context";
import { JwksUnavailableError } from "./verify";

type HonoBindings = { Bindings: Env; Variables: AppVariables };

type UnauthorizedHandler = (c: Context<HonoBindings>) => Response | Promise<Response>;

interface AuthMiddlewareOptions extends AuthOptions {
  unauthorizedResponse?: UnauthorizedHandler;
}

const defaultUnauthorized = (c: Context<HonoBindings>) => c.json({ message: "Unauthorized" }, 401);

const handleUnauthorized = (c: Context<HonoBindings>, options?: AuthMiddlewareOptions) => {
  const handler = options?.unauthorizedResponse ?? defaultUnauthorized;
  return handler(c);
};

const createAuthMiddleware = (mode: "optional" | "required", options?: AuthMiddlewareOptions) =>
  createMiddleware<HonoBindings>(async (c, next) => {
    let result: AuthResult | null;

    try {
      result = await authenticateRequest(c, options);
    } catch (error) {
      // Auth0's signing keys could not be fetched, so the credential can be
      // neither accepted nor refused. Optional-auth routes carry on as
      // anonymous (writes are then queued, never applied directly).
      if (mode === "optional" && error instanceof JwksUnavailableError) {
        logger.error("Auth0 signing keys unavailable; treating the request as anonymous", {
          path: c.req.path,
          method: c.req.method,
          errorMessage: error.message,
        });
        return next();
      }
      if (error instanceof Error) {
        logger.logError(error, {
          path: c.req.path,
          method: c.req.method,
        });
      } else {
        logger.error("Authentication failed", {
          path: c.req.path,
          method: c.req.method,
          errorMessage: String(error),
        });
      }
      return handleUnauthorized(c, options);
    }

    if (!result) {
      if (mode === "required") {
        return handleUnauthorized(c, options);
      }
      return next();
    }

    c.set("user", result.user);
    c.set("authSource", result.source);
    return next();
  });

export const optionalAuth = createAuthMiddleware("optional");
export const requireAuth = createAuthMiddleware("required");
export const requireAdminAuth = createAuthMiddleware("required", {
  unauthorizedResponse: (c) => c.redirect("/admin/login"),
});
