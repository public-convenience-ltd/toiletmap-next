import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { admin } from "./admin";
import { optionalAuth } from "./auth/middleware";
import { openApiDocument } from "./docs/openapi";
import { rateLimiters } from "./middleware/cloudflare-rate-limit";
import { requestLogger } from "./middleware/request-logger";
import { hasAdminRole } from "./middleware/require-admin-role";
import { securityHeaders } from "./middleware/security-headers";
import { services } from "./middleware/services";
import { areasRouter } from "./routes/areas";
import { feedbackRouter } from "./routes/feedback";
import { geocodeRouter } from "./routes/geocode";
import { healthRouter } from "./routes/health";
import {
  isLegacyGraphqlPath,
  LEGACY_GRAPHQL_PATH,
  legacyGraphqlCors,
  legacyGraphqlRouter,
} from "./routes/legacy-graphql";
import { loosRouter } from "./routes/loos";
import type { AppVariables, Env } from "./types";
import { isPublicEnvironment } from "./utils/environment";
import { createLogger } from "./utils/logger";

export const createApp = (env: Env) => {
  const app = new Hono<{ Variables: AppVariables; Bindings: Env }>();

  // Determine if we're in a public-facing environment (production or preview)
  const isPublic = isPublicEnvironment(env);
  const environment = env.ENVIRONMENT || "development";

  // Create logger for error handling
  const logger = createLogger(environment);

  // Configure allowed CORS origins
  const allowedOrigins = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : isPublic
      ? [] // No origins allowed by default in public environments (must be configured)
      : ["*"]; // Allow all in development

  // Apply request logging globally (except for health checks)
  // The legacy GraphQL endpoint logs no IP or user agent (see its README section).
  const requestLoggingMiddleware = requestLogger(environment, {
    omitClientDetails: isLegacyGraphqlPath,
  });
  app.use("*", (c, next) => {
    if (c.req.path.startsWith("/health")) {
      return next();
    }
    return requestLoggingMiddleware(c, next);
  });

  // Inject services
  app.use("*", services);

  // The legacy GraphQL endpoint has its own CORS policy (no credentials; see
  // routes/legacy-graphql). It runs first so it also answers preflights.
  app.use(LEGACY_GRAPHQL_PATH, legacyGraphqlCors);

  // Apply security headers globally (without the site CORS policy on the
  // legacy GraphQL path)
  const siteSecurityHeaders = securityHeaders({
    corsOrigins: allowedOrigins,
    corsCredentials: true,
    enableHSTS: isPublic,
  });
  const legacyGraphqlSecurityHeaders = securityHeaders({
    corsOrigins: [],
    corsCredentials: false,
    enableHSTS: isPublic,
  });
  app.use("*", (c, next) =>
    isLegacyGraphqlPath(c.req.path)
      ? legacyGraphqlSecurityHeaders(c, next)
      : siteSecurityHeaders(c, next),
  );

  // Apply rate limiting to admin routes
  app.use("/admin/*", rateLimiters.admin);

  // Health check routes (no rate limiting on health checks)
  app.route("/health", healthRouter);

  // Root endpoint with user info (for backward compatibility)
  app.get("/", optionalAuth, async (c) => {
    const user = c.get("user");
    const isAdmin = hasAdminRole(user);

    // Check database health to determine overall status
    let dbHealthy = true;
    try {
      const looService = c.get("looService");
      // Quick health check - just verify the service can access the database
      await looService.healthCheck();
    } catch (error) {
      dbHealthy = false;
      logger.warn("Database health check failed on root endpoint", {
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
    }

    return c.json({
      status: dbHealthy ? "ok" : "degraded",
      service: "toiletmap-server",
      timestamp: new Date().toISOString(),
      user: user
        ? {
            sub: user.sub,
            name: user.name,
            nickname: user.nickname,
            email: user.email,
            isAdmin,
          }
        : null,
      message: user
        ? `Logged in as ${user.name || user.nickname || user.email || user.sub}${isAdmin ? " (Admin)" : ""}`
        : "Not logged in. Visit /admin/login to authenticate.",
    });
  });

  app.route("/admin", admin);

  // Documentation - Public
  app.get("/api/docs/openapi.json", (c) => c.json(openApiDocument));
  app.get("/api/docs", swaggerUI({ url: "/api/docs/openapi.json" }));

  // Apply rate limiting to API routes
  app.use("/api/*", rateLimiters.read);

  // Legacy GraphQL (read-only, frozen). Mounted before optionalAuth: it never
  // looks at the caller, so its responses can be cached publicly.
  app.route(LEGACY_GRAPHQL_PATH, legacyGraphqlRouter);

  // Provide optional auth context for API routes (writes still enforce auth per-route)
  app.use("/api/*", optionalAuth);

  app.route("/api/loos", loosRouter);
  app.route("/api/areas", areasRouter);
  // Public, unauthenticated feedback (also the legacy Flutter app endpoint).
  app.route("/api/feedback", feedbackRouter);
  // Public GB place/postcode search for the website (postcodes.io, then Nominatim).
  app.route("/api/geocode", geocodeRouter);

  app.notFound((c) =>
    c.json(
      {
        message: "Route not found",
      },
      404,
    ),
  );

  app.onError((err, c) => {
    // Log full error details using structured logging
    logger.error("Unhandled error", {
      method: c.req.method,
      path: c.req.path,
      error: {
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
      userId: c.get("user")?.sub,
    });

    // Return sanitized error response (no stack traces or sensitive info in public environments)
    if (isPublic) {
      return c.json(
        {
          message: "Internal Server Error",
          error: "An unexpected error occurred. Please try again later.",
        },
        500,
      );
    }

    // In development, include error details for debugging
    return c.json(
      {
        message: "Internal Server Error",
        error: String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      500,
    );
  });

  return app;
};
