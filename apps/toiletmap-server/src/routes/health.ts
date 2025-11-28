import { Hono } from "hono";
import { Env, AppVariables } from "../types";
import { createPrismaClient } from "../prisma";

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
    service: "toiletmap-hono-api",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Readiness probe
 *
 * Indicates whether the application is ready to accept traffic.
 * Checks critical dependencies like database connectivity.
 * Used by load balancers to determine if the instance should receive traffic.
 */
healthRouter.get("/ready", async (c) => {
  const checks: {
    name: string;
    status: "ok" | "error";
    message?: string;
    responseTime?: number;
  }[] = [];

  // Check database connectivity
  const dbCheckStart = Date.now();
  try {
    const connectionString = c.env.HYPERDRIVE?.connectionString ?? c.env.TEST_DB?.connectionString;
    if (!connectionString) {
      throw new Error('No database connection string available');
    }
    const db = createPrismaClient(connectionString);

    // Simple query to verify database connectivity
    await db.$queryRaw`SELECT 1 as health_check`;

    checks.push({
      name: "database",
      status: "ok",
      responseTime: Date.now() - dbCheckStart,
    });
  } catch (error) {
    checks.push({
      name: "database",
      status: "error",
      message:
        error instanceof Error ? error.message : "Database connection failed",
      responseTime: Date.now() - dbCheckStart,
    });
  }

  // Determine overall status
  const allHealthy = checks.every((check) => check.status === "ok");
  const statusCode = allHealthy ? 200 : 503;

  return c.json(
    {
      status: allHealthy ? "ok" : "degraded",
      service: "toiletmap-hono-api",
      timestamp: new Date().toISOString(),
      checks,
    },
    statusCode
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
