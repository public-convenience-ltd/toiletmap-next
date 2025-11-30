import { createMiddleware } from "hono/factory";
import { Env, AppVariables } from "../types";
import { LooService } from "../services/loo";
import { createPrismaClient } from "../prisma";

export const services = createMiddleware<{
  Bindings: Env;
  Variables: AppVariables;
}>(async (c, next) => {
  // Debug logging for Hyperdrive binding
  if (!c.env.HYPERDRIVE && !c.env.TEST_HYPERDRIVE) {
    console.warn(
      "⚠️ HYPERDRIVE / TEST_HYPERDRIVE binding is missing from environment!"
    );
    console.log("Available bindings:", Object.keys(c.env));
  }

  // Fallback to TEST_HYPERDRIVE if HYPERDRIVE is missing (e.g. in local dev if binding fails)
  const connectionString =
    c.env.HYPERDRIVE?.connectionString ??
    c.env.TEST_HYPERDRIVE?.connectionString;

  if (!connectionString) {
    throw new Error(
      "No database connection string available. Check HYPERDRIVE or TEST_HYPERDRIVE binding."
    );
  }

  const prisma = createPrismaClient(connectionString);
  c.set("looService", new LooService(prisma));
  await next();
});
