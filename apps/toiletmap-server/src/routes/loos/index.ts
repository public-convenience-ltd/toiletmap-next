import { Hono } from "hono";
import { optionalAuth, requireAuth } from "../../auth/middleware";
import { LOO_ID_LENGTH } from "../../common/constants";
import { validate } from "../../common/validator";
import { rateLimiters } from "../../middleware/cloudflare-rate-limit";
import { hasAdminRole } from "../../middleware/require-admin-role";
import { generateLooId } from "../../services/loo";
import type { AppVariables, Env } from "../../types";
import { extractContributor } from "../../utils/auth-utils";
import { badRequest, handleRoute, notFound } from "../shared/route-helpers";
import type { MetricsQuery, SearchQuery } from "./schemas";
import {
  baseMutationSchema,
  createMutationSchema,
  geohashParamSchema,
  geohashQuerySchema,
  idsQuerySchema,
  looIdParamSchema,
  metricsQuerySchema,
  proximitySchema,
  reportsQuerySchema,
  searchQuerySchema,
} from "./schemas";

const loosRouter = new Hono<{ Variables: AppVariables; Bindings: Env }>();

/** GET /loos/geohash/:geohash */
loosRouter.get(
  "/geohash/:geohash",
  validate("param", geohashParamSchema, "Invalid geohash path parameter"),
  validate("query", geohashQuerySchema, "Invalid geohash query parameter"),
  (c) =>
    handleRoute(c, "loos.geohash", async () => {
      const { geohash } = c.req.valid("param");
      const { active, compressed } = c.req.valid("query");
      const looService = c.get("looService");

      if (compressed) {
        const loos = await looService.getWithinGeohashCompressed(geohash, active);
        c.header("Cache-Control", "public, max-age=300"); // 5 minutes
        return c.json({ data: loos, count: loos.length });
      }

      const loos = await looService.getWithinGeohash(geohash, active);

      c.header("Cache-Control", "public, max-age=300"); // 5 minutes
      return c.json({ data: loos, count: loos.length });
    }),
);

/** GET /loos/dump */
loosRouter.get("/dump", (c) =>
  handleRoute(c, "loos.dump", async () => {
    const looService = c.get("looService");
    const loos = await looService.getAllCompressed();
    c.header("Cache-Control", "public, max-age=3600"); // 1 hour
    return c.json({ data: loos, count: loos.length });
  }),
);

/** GET /loos/proximity */
loosRouter.get("/proximity", validate("query", proximitySchema, "Invalid proximity query"), (c) =>
  handleRoute(c, "loos.proximity", async () => {
    const { lat, lng, radius } = c.req.valid("query");
    const looService = c.get("looService");
    const loos = await looService.getByProximity(lat, lng, radius);

    c.header("Cache-Control", "public, max-age=300"); // 5 minutes
    return c.json({ data: loos, count: loos.length });
  }),
);

/** GET /loos/search */
loosRouter.get("/search", validate("query", searchQuerySchema, "Invalid search query"), (c) =>
  handleRoute(c, "loos.search", async () => {
    const params = c.req.valid("query");
    const looService = c.get("looService");
    const { data, total } = await looService.search(params);

    const offset = (params.page - 1) * params.limit;
    const hasMore = offset + data.length < total;

    return c.json({
      data,
      count: data.length,
      total,
      page: params.page,
      pageSize: params.limit,
      hasMore,
    });
  }),
);

/** GET /loos/metrics */
loosRouter.get("/metrics", validate("query", metricsQuerySchema, "Invalid metrics query"), (c) =>
  handleRoute(c, "loos.metrics", async () => {
    const looService = c.get("looService");
    const { recentWindowDays, ...params } = c.req.valid("query") as MetricsQuery;
    const metrics = await looService.getSearchMetrics(params as SearchQuery, { recentWindowDays });
    return c.json(metrics);
  }),
);

/** GET /loos/:id/reports */
loosRouter.get(
  "/:id/reports",
  optionalAuth,
  validate("param", looIdParamSchema, "Invalid id path parameter"),
  validate("query", reportsQuerySchema, "Invalid reports query parameter"),
  (c) =>
    handleRoute(c, "loos.reports", async () => {
      const { id } = c.req.valid("param");
      const { hydrate } = c.req.valid("query");
      const looService = c.get("looService");
      const reports = await looService.getReports(id, {
        hydrate,
        includeContributors: hasAdminRole(c.get("user")),
      });
      return c.json({ data: reports, count: reports.length });
    }),
);

/** GET /loos/:id */
loosRouter.get("/:id", validate("param", looIdParamSchema, "Invalid id path parameter"), (c) =>
  handleRoute(c, "loos.detail", async () => {
    const { id } = c.req.valid("param");

    const looService = c.get("looService");
    const dto = await looService.getById(id);
    if (!dto) return notFound(c, "Loo not found");

    c.header("Cache-Control", "public, max-age=60"); // 1 minute for individual loos
    return c.json(dto);
  }),
);

/** GET /loos?ids= */
loosRouter.get("/", validate("query", idsQuerySchema, "Invalid ids query parameter"), (c) =>
  handleRoute(c, "loos.byIds", async () => {
    const { ids } = c.req.valid("query");
    const looService = c.get("looService");
    const loos = await looService.getByIds(ids);
    return c.json({ data: loos, count: loos.length });
  }),
);

/** POST /loos */
loosRouter.post(
  "/",
  rateLimiters.write,
  requireAuth,
  validate("json", createMutationSchema, "Invalid create request body"),
  (c) =>
    handleRoute(c, "loos.create", async () => {
      const validation = c.req.valid("json");
      const contributor = extractContributor(c.get("user"), c.env.AUTH0_PROFILE_KEY);
      const { id: requestedId, ...rest } = validation;
      const id = requestedId ?? generateLooId();

      if (id.length !== LOO_ID_LENGTH)
        return badRequest(c, `id must be exactly ${LOO_ID_LENGTH} characters`);

      const looService = c.get("looService");
      const existing = await looService.getById(id);
      if (existing) return c.json({ message: `Loo with id ${id} already exists` }, 409);

      const created = await looService.create(id, rest, contributor);
      if (!created) throw new Error(`Failed to reload loo ${id} after creation`);
      return c.json(created, 201);
    }),
);

/** PUT /loos/:id */
loosRouter.put(
  "/:id",
  rateLimiters.write,
  requireAuth,
  validate("param", looIdParamSchema, "Invalid id path parameter"),
  validate("json", baseMutationSchema, "Invalid upsert request body"),
  (c) =>
    handleRoute(c, "loos.upsert", async () => {
      const { id } = c.req.valid("param");
      const validation = c.req.valid("json");
      const contributor = extractContributor(c.get("user"), c.env.AUTH0_PROFILE_KEY);
      const looService = c.get("looService");
      const existing = await looService.getById(id);
      const saved = await looService.upsert(id, validation, contributor);
      if (!saved) throw new Error(`Failed to reload loo ${id} after upsert`);

      return c.json(saved, existing ? 200 : 201);
    }),
);

export { loosRouter };
