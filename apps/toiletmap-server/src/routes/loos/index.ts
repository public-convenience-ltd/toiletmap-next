import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { optionalAuth } from "../../auth/middleware";
import { LOO_ID_LENGTH } from "../../common/constants";
import { validate } from "../../common/validator";
import { cacheResponse } from "../../middleware/cache";
import { rateLimiters } from "../../middleware/cloudflare-rate-limit";
import { hasAdminRole } from "../../middleware/require-admin-role";
import { generateLooId } from "../../services/loo";
import { diffMutation, isEmptyMutation, isStaleBase } from "../../services/loo/diff";
import type { LooMutationBase } from "../../services/loo/loo.service";
import type { LooResponse } from "../../services/loo/types";
import type { AppVariables, Env } from "../../types";
import { extractContributor } from "../../utils/auth-utils";
import { invalidateDumpCache } from "../../utils/cache";
import { badRequest, handleRoute, notFound } from "../shared/route-helpers";
import type { MetricsQuery, SearchQuery } from "./schemas";
import {
  createMutationSchema,
  dumpQuerySchema,
  geohashParamSchema,
  geohashQuerySchema,
  idsQuerySchema,
  looIdParamSchema,
  metricsQuerySchema,
  proximitySchema,
  reportsQuerySchema,
  searchQuerySchema,
  updateMutationSchema,
  updatesQuerySchema,
} from "./schemas";

const loosRouter = new Hono<{ Variables: AppVariables; Bindings: Env }>();

const anonRateLimitExceeded = async (
  c: Context<{ Variables: AppVariables; Bindings: Env }>,
): Promise<Response | null> => {
  const { success } = await (c.env.RATE_LIMIT_ANON_WRITE?.limit({
    key: `anon-write:${c.req.header("cf-connecting-ip") ?? "unknown"}`,
  }) ?? Promise.resolve({ success: true }));
  if (!success) {
    return c.json(
      {
        message: "Too many submissions, please try again in a minute",
        error: "rate_limit_exceeded",
      },
      429,
    );
  }
  return null;
};

type AppContext = Context<{ Variables: AppVariables; Bindings: Env }>;

/**
 * Applies the per-user write rate limiter to authenticated mutations.
 * Anonymous mutations are limited separately (see anonRateLimitExceeded).
 * Like every Cloudflare limiter here, a missing binding fails open.
 */
const authenticatedWriteRateLimit: MiddlewareHandler<{
  Variables: AppVariables;
  Bindings: Env;
}> = async (c, next) => {
  if (!c.get("user")) {
    await next();
    return;
  }
  return rateLimiters.write(c, next);
};

const CONFLICT_MESSAGE = "This toilet was changed by someone else while you were editing.";

const stripMutationBase = ({ areaId: _areaId, ...loo }: LooMutationBase): LooResponse => loo;

const conflictResponse = (c: AppContext, current: LooResponse) =>
  c.json({ message: CONFLICT_MESSAGE, error: "conflict", current }, 409);

/** Bounded retries when a concurrent write lands between our read and our update. */
const MAX_UPDATE_ATTEMPTS = 3;

/** GET /loos/updates — intentionally not cached so mutations are visible immediately */
loosRouter.get("/updates", validate("query", updatesQuerySchema, "Invalid updates query"), (c) =>
  handleRoute(c, "loos.updates", async () => {
    const { since } = c.req.valid("query");
    const looService = c.get("looService");
    const updates = await looService.getUpdates(new Date(since));
    return c.json(updates);
  }),
);

/** GET /loos/geohash/:geohash */

loosRouter.get(
  "/geohash/:geohash",
  validate("param", geohashParamSchema, "Invalid geohash path parameter"),
  validate("query", geohashQuerySchema, "Invalid geohash query parameter"),
  cacheResponse((c) => {
    const geohash = c.req.param("geohash");
    const resultCount = c.get("resultCount");

    if (!geohash) return 0;

    // If we have a result count, use it to decide caching
    if (typeof resultCount === "number") {
      return resultCount > 100 ? (geohash.length <= 3 ? 3600 : 300) : 0;
    }

    // Fallback for cases where resultCount might not be set (shouldn't happen in this route)
    return geohash.length <= 3 ? 3600 : 300;
  }),
  (c) =>
    handleRoute(c, "loos.geohash", async () => {
      const { geohash } = c.req.valid("param");
      const { active, compressed, summary } = c.req.valid("query");
      const looService = c.get("looService");

      if (compressed) {
        const loos = await looService.getWithinGeohashCompressed(geohash, active);
        c.set("resultCount", loos.length);
        return c.json({ data: loos, count: loos.length });
      }

      if (summary) {
        const loos = await looService.getWithinGeohashSummary(geohash, active);
        c.set("resultCount", loos.length);
        return c.json({ data: loos, count: loos.length });
      }

      const loos = await looService.getWithinGeohash(geohash, active);
      c.set("resultCount", loos.length);
      return c.json({ data: loos, count: loos.length });
    }),
);

/** GET /loos/dump */
loosRouter.get(
  "/dump",
  validate("query", dumpQuerySchema, "Invalid dump query"),
  cacheResponse(3600),
  (c) =>
    handleRoute(c, "loos.dump", async () => {
      const { rich } = c.req.valid("query");
      const looService = c.get("looService");
      if (rich) {
        const loos = await looService.getAll();
        return c.json({ data: loos, count: loos.length });
      }
      const loos = await looService.getAllCompressed();
      return c.json({ data: loos, count: loos.length });
    }),
);

/** GET /loos/proximity */
loosRouter.get(
  "/proximity",
  validate("query", proximitySchema, "Invalid proximity query"),
  cacheResponse(300),
  (c) =>
    handleRoute(c, "loos.proximity", async () => {
      const { lat, lng, radius } = c.req.valid("query");
      const looService = c.get("looService");
      const loos = await looService.getByProximity(lat, lng, radius);
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
  optionalAuth,
  authenticatedWriteRateLimit,
  validate("json", createMutationSchema, "Invalid create request body"),
  (c) =>
    handleRoute(c, "loos.create", async () => {
      const user = c.get("user");

      if (!user) {
        // Anonymous submission: rate-limit then queue for approval
        const limited = await anonRateLimitExceeded(c);
        if (limited) return limited;

        const validation = c.req.valid("json");
        const pendingChangeService = c.get("pendingChangeService");
        const { id: _id, ...payload } = validation;
        const { id } = await pendingChangeService.queue(
          "create",
          payload,
          null,
          c.req.header("cf-connecting-ip") ?? null,
        );
        return c.json({ queued: true, id }, 202);
      }

      // Authenticated: direct write
      const validation = c.req.valid("json");
      const contributor = extractContributor(user, c.env.AUTH0_PROFILE_KEY);
      const { id: requestedId, ...rest } = validation;
      const id = requestedId ?? generateLooId();

      if (id.length !== LOO_ID_LENGTH)
        return badRequest(c, `id must be exactly ${LOO_ID_LENGTH} characters`);

      const looService = c.get("looService");
      const existing = await looService.getById(id);
      if (existing) return c.json({ message: `Loo with id ${id} already exists` }, 409);

      const created = await looService.create(id, rest, contributor);
      if (!created) throw new Error(`Failed to reload loo ${id} after creation`);
      await invalidateDumpCache(c.req.url);
      return c.json(created, 201);
    }),
);

/**
 * PUT /loos/:id
 *
 * Semantics: omitted fields are left unchanged, `null` clears a field, and
 * fields equal to the stored value are dropped. If nothing would change, the
 * existing record is returned without writing. An optional `baseUpdatedAt`
 * (the `updatedAt` the client loaded) turns on optimistic concurrency: a
 * mismatch returns 409 with the current record.
 */
loosRouter.put(
  "/:id",
  optionalAuth,
  authenticatedWriteRateLimit,
  validate("param", looIdParamSchema, "Invalid id path parameter"),
  validate("json", updateMutationSchema, "Invalid upsert request body"),
  (c) =>
    handleRoute(c, "loos.upsert", async () => {
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const { baseUpdatedAt, ...mutation } = c.req.valid("json");
      const looService = c.get("looService");

      if (!user) {
        // Anonymous submission: rate-limit then queue the diff for approval
        const limited = await anonRateLimitExceeded(c);
        if (limited) return limited;

        const existing = await looService.getMutationBase(id);
        // Anonymous users can only suggest edits to toilets that exist.
        if (!existing) return notFound(c, "Loo not found");
        if (isStaleBase(baseUpdatedAt, existing.updatedAt)) {
          return conflictResponse(c, stripMutationBase(existing));
        }

        const changes = diffMutation(mutation, existing);
        if (isEmptyMutation(changes)) {
          return c.json({ queued: false, unchanged: true }, 200);
        }

        const pendingChangeService = c.get("pendingChangeService");
        const baseVersion = baseUpdatedAt ?? existing.updatedAt;
        const { id: queued } = await pendingChangeService.queue(
          "update",
          changes,
          id,
          c.req.header("cf-connecting-ip") ?? null,
          baseVersion ? new Date(baseVersion) : null,
        );
        return c.json({ queued: true, id: queued }, 202);
      }

      // Authenticated: direct write
      const contributor = extractContributor(user, c.env.AUTH0_PROFILE_KEY);

      for (let attempt = 1; attempt <= MAX_UPDATE_ATTEMPTS; attempt++) {
        const existing = await looService.getMutationBase(id);

        if (!existing) {
          // PUT keeps upsert semantics for authenticated callers: unknown ids are created.
          const saved = await looService.upsert(id, mutation, contributor);
          if (!saved) throw new Error(`Failed to reload loo ${id} after upsert`);
          await invalidateDumpCache(c.req.url);
          return c.json(saved, 201);
        }

        if (isStaleBase(baseUpdatedAt, existing.updatedAt)) {
          return conflictResponse(c, stripMutationBase(existing));
        }

        const changes = diffMutation(mutation, existing);
        if (isEmptyMutation(changes)) {
          return c.json(stripMutationBase(existing), 200);
        }

        // Guard the write with the version we diffed against so a concurrent
        // edit between read and write is never silently overwritten.
        const result = await looService.updateExisting(id, changes, contributor, {
          expectedUpdatedAt: existing.updatedAt,
        });

        if (result.status === "updated") {
          if (!result.loo) throw new Error(`Failed to reload loo ${id} after update`);
          await invalidateDumpCache(c.req.url);
          return c.json(result.loo, 200);
        }

        // The record changed (or vanished) under us. A client that sent a base
        // version gets an explicit conflict; otherwise re-read and re-diff.
        if (baseUpdatedAt !== undefined) {
          const current = await looService.getMutationBase(id);
          if (current) return conflictResponse(c, stripMutationBase(current));
        }
      }

      return c.json(
        { message: CONFLICT_MESSAGE, error: "conflict", current: await looService.getById(id) },
        409,
      );
    }),
);

export { loosRouter };
