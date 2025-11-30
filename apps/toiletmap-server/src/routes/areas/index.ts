import { Hono } from "hono";
import { createPrismaClient } from "../../prisma";
import { listAreas } from "../../services/area.service";
import type { AppVariables, Env } from "../../types";
import { handleRoute } from "../shared/route-helpers";

export const areasRouter = new Hono<{
  Variables: AppVariables;
  Bindings: Env;
}>();

areasRouter.get("/", (c) =>
  handleRoute(c, "areas.list", async () => {
    const connectionString =
      c.env.HYPERDRIVE?.connectionString ?? c.env.TEST_HYPERDRIVE?.connectionString;
    if (!connectionString) {
      throw new Error("No database connection string available");
    }
    const areas = await listAreas(createPrismaClient(connectionString));
    return c.json({
      data: areas,
      count: areas.length,
    });
  }),
);
