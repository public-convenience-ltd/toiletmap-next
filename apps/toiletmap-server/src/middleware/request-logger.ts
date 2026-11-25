import type { MiddlewareHandler } from "hono";
import type { AppVariables, Env } from "../types";
import { createLogger } from "../utils/logger";

/**
 * Request logging middleware
 *
 * Logs all HTTP requests with structured logging including:
 * - Request method and path
 * - Response status and timing
 * - User information (if authenticated)
 * - Error details (if any)
 *
 * The client IP and user agent are left out for paths matching
 * `omitClientDetails` (the legacy GraphQL endpoint promises not to log them).
 */
export const requestLogger = (
  env?: "production" | "preview" | "development",
  { omitClientDetails = () => false }: { omitClientDetails?: (path: string) => boolean } = {},
): MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> => {
  const logger = createLogger(env);

  return async (c, next) => {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    const method = c.req.method;
    const path = c.req.path;

    // Log incoming request. Feedback promises never to log the submitter's
    // IP, so its line carries neither IP nor user agent (nor does any path
    // matching `omitClientDetails`).
    const isFeedback = path === "/api/feedback" || path.startsWith("/api/feedback/");
    logger.info("Incoming request", {
      requestId,
      method,
      path,
      ...(isFeedback || omitClientDetails(path)
        ? {}
        : {
            userAgent: c.req.header("user-agent"),
            // Never X-Forwarded-For, which the caller controls.
            ip: c.req.header("cf-connecting-ip"),
          }),
    });

    try {
      await next();

      // Log successful response
      const duration = Date.now() - startTime;
      const status = c.res.status;

      logger.info("Request completed", {
        requestId,
        method,
        path,
        status,
        duration,
        userId: c.get("user")?.sub,
      });
    } catch (error) {
      // Log error
      const duration = Date.now() - startTime;

      logger.error("Request failed", {
        requestId,
        method,
        path,
        duration,
        userId: c.get("user")?.sub,
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : {
                name: "UnknownError",
                message: String(error),
              },
      });

      // Re-throw to let error handler deal with it
      throw error;
    }
  };
};
