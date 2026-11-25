import { Hono } from "hono";
import { getDatabaseReadiness } from "../services/health/readiness";
import type { AppVariables, Env } from "../types";
import { sanitizeHealthCheckError } from "../utils/error-sanitizer";

/**
 * Health check routes
 *
 * Provides separate liveness and readiness endpoints for proper health monitoring:
 * - /health/live: Simple liveness check (is the service running?)
 * - /health/ready: Readiness check (can the service handle requests?)
 */
export const healthRouter = new Hono<{
  Variables: AppVariables;
  Bindings: Env;
}>();

/**
 * Liveness probe
 *
 * Indicates whether the application is running.
 * This should always return 200 unless the process is completely dead.
 * Used by orchestrators to determine if the container should be restarted.
 */
healthRouter.get("/live", (c) => {
  return c.json({
    status: "ok",
    service: "toiletmap-server",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Readiness probe
 *
 * Indicates whether the application is ready to accept traffic.
 * Checks critical dependencies like database connectivity.
 * Used by load balancers to determine if the instance should receive traffic.
 * The database result is reused for up to READINESS_CACHE_MS (10 s; a failure 2 s) per
 * isolate, so polling this endpoint does not put a query on every request.
 */
healthRouter.get("/ready", async (c) => {
  const checks: {
    name: string;
    status: "ok" | "error";
    message?: string;
    responseTime?: number;
  }[] = [];

  const database = await getDatabaseReadiness(c.env);
  if (database.ok) {
    checks.push({ name: "database", status: "ok", responseTime: database.responseTime });
  } else {
    // Sanitize error for client response
    const sanitized = sanitizeHealthCheckError(
      c.env,
      "database",
      database.error,
      database.responseTime,
    );
    checks.push({
      name: "database",
      status: "error",
      message: sanitized.message,
      responseTime: sanitized.responseTime,
    });
  }

  // Determine overall status
  const allHealthy = checks.every((check) => check.status === "ok");
  const statusCode = allHealthy ? 200 : 503;

  return c.json(
    {
      status: allHealthy ? "ok" : "degraded",
      service: "toiletmap-server",
      timestamp: new Date().toISOString(),
      checks,
    },
    statusCode,
    { "Cache-Control": "no-store" },
  );
});

/**
 * Legacy health check endpoint
 *
 * Maintains backward compatibility with the root health check.
 * Redirects to /health/ready for consistent behavior.
 */
healthRouter.get("/", (c) => {
  return c.redirect("/health/ready");
});
