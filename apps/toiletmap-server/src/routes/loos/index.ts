import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { every } from "hono/combine";
import { optionalAuth } from "../../auth/middleware";
import {
  HEAVY_PROXIMITY_RADIUS,
  LOO_ID_LENGTH,
  MIN_GEOHASH_PREFIX_LENGTH,
} from "../../common/constants";
import { validate } from "../../common/validator";
import {
  type CacheKeyValue,
  cacheResponse,
  edgeCache,
  normalisedCacheKey,
} from "../../middleware/cache";
import { rateLimiters } from "../../middleware/cloudflare-rate-limit";
import { canWriteDirectly, hasAdminRole } from "../../middleware/require-admin-role";
import { generateLooId } from "../../services/loo";
import {
  clearRemovalOnReactivate,
  diffMutation,
  isEmptyMutation,
  isStaleBase,
} from "../../services/loo/diff";
import type { LooMutationBase, StateChangeResult } from "../../services/loo/loo.service";
import { toCompressedLoo } from "../../services/loo/mappers";
import type { LooResponse } from "../../services/loo/types";
import { scheduleModerationAlert } from "../../services/moderation-alert";
import type {
  PendingChangeType,
  PendingPayload,
} from "../../services/pending-change/pending-change.service";
import type { AppVariables, Env } from "../../types";
import { extractContributor } from "../../utils/auth-utils";
import {
  DUMP_CACHE_CONTROL,
  DUMP_EDGE_TTL_SECONDS,
  dumpEtag,
  etagMatches,
  LOO_DETAIL_CACHE_CONTROL,
  LOO_IDS_CACHE_CONTROL,
  looEtag,
  UPDATES_CACHE_CONTROL,
} from "../../utils/http-cache";
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
  reportSchema,
  reportsQuerySchema,
  restoreSchema,
  searchQuerySchema,
  updateMutationSchema,
  updatesQuerySchema,
} from "./schemas";

const loosRouter = new Hono<{ Variables: AppVariables; Bindings: Env }>();

/**
 * The 1/min submission limit for writes that are queued for moderation:
 * anonymous callers by IP, signed-in callers (blocked, or block status
 * unknown) by user, so a blocked account cannot fill the queue faster than
 * an anonymous caller can. Anonymous verifies share it too.
 */
const queuedWriteRateLimitExceeded = async (
  c: Context<{ Variables: AppVariables; Bindings: Env }>,
): Promise<Response | null> => {
  const user = c.get("user");
  const key = user
    ? `anon-write:user:${user.sub}`
    : `anon-write:${c.req.header("cf-connecting-ip") ?? "unknown"}`;
  const { success } = await (c.env.RATE_LIMIT_ANON_WRITE?.limit({ key }) ??
    Promise.resolve({ success: true }));
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

const signedInWriteLimiters = every(rateLimiters.write, rateLimiters.writeIp);

/**
 * Applies the write rate limiters to authenticated mutations: per user, and
 * per IP so one person cannot multiply the per-user budget by switching
 * accounts. Anonymous mutations are limited separately (see
 * queuedWriteRateLimitExceeded). Like every Cloudflare limiter here, a
 * missing binding fails open.
 */
const authenticatedWriteRateLimit: MiddlewareHandler<{
  Variables: AppVariables;
  Bindings: Env;
}> = async (c, next) => {
  if (!c.get("user")) {
    await next();
    return;
  }
  return signedInWriteLimiters(c, next);
};

/**
 * Largest JSON body a loo write route reads. A legitimate body is at most
 * about 26 KB (three 2000-character text fields of 4-byte characters plus the
 * rest), so this leaves room for escaping while stopping oversized bodies
 * before they are parsed.
 */
export const LOO_WRITE_BODY_MAX_BYTES = 64 * 1024;

const writeBodyLimit = bodyLimit({
  maxSize: LOO_WRITE_BODY_MAX_BYTES,
  onError: (c) => c.json({ message: "Request body is too large", error: "payload_too_large" }, 413),
});

/**
 * The stricter per-IP limit for heavy reads (see `rateLimiters.heavyRead`),
 * applied when `isHeavy` says this request is one. Registered after the
 * route's validators so `isHeavy` can read the validated parameters, and
 * before the edge cache. Admins are exempt.
 */
const heavyReadLimit =
  (
    isHeavy: (c: AppContext) => boolean,
  ): MiddlewareHandler<{ Variables: AppVariables; Bindings: Env }> =>
  async (c, next) => {
    if (!isHeavy(c) || hasAdminRole(c.get("user"))) {
      await next();
      return;
    }
    return rateLimiters.heavyRead(c, next);
  };

/** Validated query and path parameters of the current request (registered validators only). */
const validated = (c: Context, target: "query" | "param"): Record<string, CacheKeyValue> =>
  (c.req.valid as (target: "query" | "param") => Record<string, CacheKeyValue>)(target);

const CONFLICT_MESSAGE = "This toilet was changed by someone else while you were editing.";

const stripMutationBase = ({ areaId: _areaId, ...loo }: LooMutationBase): LooResponse => loo;

const conflictResponse = (c: AppContext, current: LooResponse) =>
  c.json({ message: CONFLICT_MESSAGE, error: "conflict", current }, 409);

/**
 * Body of a successful authenticated create/update: the loo plus its map tuple
 * (`null` when it is no longer on the map), so the client can patch its map
 * cache straight away instead of re-downloading the dump.
 */
const savedLooResponse = (c: AppContext, loo: LooResponse, status: 200 | 201) =>
  c.json({ ...loo, compressed: toCompressedLoo(loo) }, status);

/** Bounded retries when a concurrent write lands between our read and our update. */
const MAX_UPDATE_ATTEMPTS = 3;

/**
 * Queues a change for moderation and alerts moderators (when configured).
 * Signed-in submitters are recorded so approval credits them.
 */
const queueForModeration = async (
  c: AppContext,
  type: PendingChangeType,
  payload: PendingPayload,
  looId: string | null,
  baseUpdatedAt: string | Date | null | undefined,
) => {
  const user = c.get("user");
  const { id } = await c.get("pendingChangeService").queue(type, payload, {
    looId,
    ip: c.req.header("cf-connecting-ip") ?? null,
    baseUpdatedAt: baseUpdatedAt ? new Date(baseUpdatedAt) : null,
    submittedBy: user ? extractContributor(user, c.env.AUTH0_PROFILE_KEY) : null,
  });
  scheduleModerationAlert(c);
  return c.json({ queued: true, id }, 202);
};

/** Maps a refused or completed report/restore to its HTTP response. */
const stateChangeResponse = (c: AppContext, result: StateChangeResult) => {
  switch (result.status) {
    case "updated":
      return savedLooResponse(c, result.loo, 200);
    case "not_found":
      return notFound(c, "Loo not found");
    case "conflict":
      return conflictResponse(c, result.current);
    case "already_removed":
      return c.json(
        {
          message: "This toilet has already been removed from the map.",
          error: "already_removed",
          current: result.current,
        },
        409,
      );
    case "not_removed":
      return c.json(
        {
          message: "This toilet is already on the map.",
          error: "not_removed",
          current: result.current,
        },
        409,
      );
    case "invalid_duplicate":
      return badRequest(c, "Invalid report request body", {
        _errors: [],
        duplicateOf: { _errors: [result.message] },
      });
  }
};

/**
 * GET /loos/updates?since=<cursor>
 *
 * Map changes since a cursor previously returned by `/dump` or `/updates`.
 * Clients must send back the server's cursor, never their own clock. The
 * returned cursor trails the database clock by 120s (read before the query),
 * so rows near the boundary can be delivered twice; apply idempotently.
 * Never cached, so mutations are visible immediately.
 */
loosRouter.get("/updates", validate("query", updatesQuerySchema, "Invalid updates query"), (c) =>
  handleRoute(c, "loos.updates", async () => {
    const { since } = c.req.valid("query");
    const looService = c.get("looService");
    const cursor = await looService.getSyncCursor();
    const updates = await looService.getUpdates(new Date(since));
    return c.json({ ...updates, cursor }, 200, { "Cache-Control": UPDATES_CACHE_CONTROL });
  }),
);

/** GET /loos/geohash/:geohash */

loosRouter.get(
  "/geohash/:geohash",
  validate("param", geohashParamSchema, "Invalid geohash path parameter"),
  validate("query", geohashQuerySchema, "Invalid geohash query parameter"),
  // The shortest allowed prefixes cover the most ground.
  heavyReadLimit((c) => String(validated(c, "param").geohash).length <= MIN_GEOHASH_PREFIX_LENGTH),
  cacheResponse(
    (c) => {
      const geohash = String(validated(c, "param").geohash);
      const resultCount = c.get("resultCount");
      const broad = geohash.length <= MIN_GEOHASH_PREFIX_LENGTH;

      // If we have a result count, use it to decide caching
      if (typeof resultCount === "number") {
        return resultCount > 100 ? (broad ? 3600 : 300) : 0;
      }

      // Fallback for cases where resultCount might not be set (shouldn't happen in this route)
      return broad ? 3600 : 300;
    },
    (c) =>
      normalisedCacheKey(c, "loos/geohash", { ...validated(c, "param"), ...validated(c, "query") }),
  ),
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

/**
 * GET /loos/dump[?rich=true]
 *
 * Every active, located loo: compressed `[id, geohash, filterMask]` tuples by
 * default, full LooResponse objects with `rich=true` (heavy; for API
 * consumers). The body carries a sync `cursor` for `/updates`.
 *
 * Freshness: the ETag is a dataset version (see LooService.getDatasetVersion), so
 * `If-None-Match` revalidation is a single cheap query and a 304. The
 * colo-local edge cache is keyed by that version too, so a write never needs a
 * purge: readers simply move to a new key. A body served from the edge cache
 * carries the cursor from when it was built, which is older and therefore
 * still safe (it only widens the next `/updates` window).
 */
loosRouter.get(
  "/dump",
  validate("query", dumpQuerySchema, "Invalid dump query"),
  heavyReadLimit((c) => validated(c, "query").rich === true),
  (c) =>
    handleRoute(c, "loos.dump", async () => {
      const { rich } = c.req.valid("query");
      const looService = c.get("looService");

      // Read before the dump query: see LooService.getSyncCursor.
      const version = await looService.getDatasetVersion();
      const etag = dumpEtag(version, rich);
      const headers = { "Cache-Control": DUMP_CACHE_CONTROL, ETag: etag };

      if (etagMatches(c.req.header("If-None-Match"), etag)) {
        return c.body(null, 304, headers);
      }

      const { origin } = new URL(c.req.url);
      const key = `${origin}/api/loos/dump?rich=${rich}&v=${encodeURIComponent(etag)}`;
      const cached = await edgeCache.match(c, key, DUMP_CACHE_CONTROL);
      if (cached) return cached;

      const data = rich ? await looService.getAll() : await looService.getAllCompressed();
      const response = c.json({ data, count: data.length, cursor: version.cursor }, 200, headers);
      edgeCache.put(c, key, response, DUMP_EDGE_TTL_SECONDS);
      return response;
    }),
);

/** GET /loos/proximity */
loosRouter.get(
  "/proximity",
  validate("query", proximitySchema, "Invalid proximity query"),
  heavyReadLimit((c) => Number(validated(c, "query").radius) > HEAVY_PROXIMITY_RADIUS),
  // Short TTL: the add/edit duplicate prompt should see reports and restores soon.
  cacheResponse(60, (c) => normalisedCacheKey(c, "loos/proximity", validated(c, "query"))),
  (c) =>
    handleRoute(c, "loos.proximity", async () => {
      const { lat, lng, radius, includeInactive, exclude } = c.req.valid("query");
      const looService = c.get("looService");
      const loos = await looService.getByProximity(lat, lng, radius, {
        includeInactive,
        excludeId: exclude,
      });
      return c.json({ data: loos, count: loos.length });
    }),
);

/** GET /loos/search */
loosRouter.get(
  "/search",
  validate("query", searchQuerySchema, "Invalid search query"),
  heavyReadLimit(() => true),
  (c) =>
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
loosRouter.get(
  "/metrics",
  validate("query", metricsQuerySchema, "Invalid metrics query"),
  heavyReadLimit(() => true),
  (c) =>
    handleRoute(c, "loos.metrics", async () => {
      const looService = c.get("looService");
      const { recentWindowDays, ...params } = c.req.valid("query") as MetricsQuery;
      const metrics = await looService.getSearchMetrics(params as SearchQuery, {
        recentWindowDays,
      });
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

    // Always revalidate; an unchanged record costs a 304 with no body.
    const etag = looEtag(dto);
    const headers = { "Cache-Control": LOO_DETAIL_CACHE_CONTROL, ETag: etag };
    if (etagMatches(c.req.header("If-None-Match"), etag)) {
      return c.body(null, 304, headers);
    }
    return c.json(dto, 200, headers);
  }),
);

/** GET /loos?ids= */
loosRouter.get("/", validate("query", idsQuerySchema, "Invalid ids query parameter"), (c) =>
  handleRoute(c, "loos.byIds", async () => {
    const { ids } = c.req.valid("query");
    const looService = c.get("looService");
    const loos = await looService.getByIds(ids);
    return c.json({ data: loos, count: loos.length }, 200, {
      "Cache-Control": LOO_IDS_CACHE_CONTROL,
    });
  }),
);

/** POST /loos */
loosRouter.post(
  "/",
  optionalAuth,
  authenticatedWriteRateLimit,
  writeBodyLimit,
  validate("json", createMutationSchema, "Invalid create request body"),
  (c) =>
    handleRoute(c, "loos.create", async () => {
      const user = c.get("user");

      if (!(await canWriteDirectly(c, user))) {
        // Anonymous, blocked, or block status unknown: queue for approval.
        const limited = await queuedWriteRateLimitExceeded(c);
        if (limited) return limited;

        const { id: _id, ...payload } = c.req.valid("json");
        return queueForModeration(c, "create", payload, null, null);
      }

      // Signed in and not blocked: direct write
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
      return savedLooResponse(c, created, 201);
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
  writeBodyLimit,
  validate("param", looIdParamSchema, "Invalid id path parameter"),
  validate("json", updateMutationSchema, "Invalid upsert request body"),
  (c) =>
    handleRoute(c, "loos.upsert", async () => {
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const { baseUpdatedAt, ...mutation } = c.req.valid("json");
      const looService = c.get("looService");

      if (!(await canWriteDirectly(c, user))) {
        // Anonymous, blocked, or block status unknown: queue the diff for approval.
        const limited = await queuedWriteRateLimitExceeded(c);
        if (limited) return limited;

        const existing = await looService.getMutationBase(id);
        // Untrusted callers can only suggest edits to toilets that exist.
        if (!existing) return notFound(c, "Loo not found");
        if (isStaleBase(baseUpdatedAt, existing.updatedAt)) {
          return conflictResponse(c, stripMutationBase(existing));
        }

        const changes = diffMutation(mutation, existing);
        if (isEmptyMutation(changes)) {
          return c.json({ queued: false, unchanged: true }, 200);
        }

        return queueForModeration(c, "update", changes, id, baseUpdatedAt ?? existing.updatedAt);
      }

      // Signed in and not blocked: direct write
      const contributor = extractContributor(user, c.env.AUTH0_PROFILE_KEY);

      for (let attempt = 1; attempt <= MAX_UPDATE_ATTEMPTS; attempt++) {
        const existing = await looService.getMutationBase(id);

        if (!existing) {
          // PUT keeps upsert semantics for authenticated callers: unknown ids are created.
          const saved = await looService.upsert(id, mutation, contributor);
          if (!saved) throw new Error(`Failed to reload loo ${id} after upsert`);
          return savedLooResponse(c, saved, 201);
        }

        if (isStaleBase(baseUpdatedAt, existing.updatedAt)) {
          return conflictResponse(c, stripMutationBase(existing));
        }

        const changes = clearRemovalOnReactivate(diffMutation(mutation, existing), existing);
        if (isEmptyMutation(changes)) {
          return savedLooResponse(c, stripMutationBase(existing), 200);
        }

        // Guard the write with the version we diffed against so a concurrent
        // edit between read and write is never silently overwritten.
        const result = await looService.updateExisting(id, changes, contributor, {
          expectedUpdatedAt: existing.updatedAt,
        });

        if (result.status === "updated") {
          if (!result.loo) throw new Error(`Failed to reload loo ${id} after update`);
          return savedLooResponse(c, result.loo, 200);
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

/**
 * POST /loos/:id/report
 *
 * "Report a problem": the toilet is gone, never existed, is not public, or
 * duplicates another. Trusted callers (signed in, not blocked) remove it
 * from the map immediately (200, with `compressed: null`); everyone else gets
 * a 202 and a pending `remove` change. Refusals: 404 unknown, 409
 * `already_removed`, 409 `conflict` (stale `baseUpdatedAt`), 400 validation.
 */
loosRouter.post(
  "/:id/report",
  optionalAuth,
  authenticatedWriteRateLimit,
  writeBodyLimit,
  validate("param", looIdParamSchema, "Invalid id path parameter"),
  validate("json", reportSchema, "Invalid report request body"),
  (c) =>
    handleRoute(c, "loos.report", async () => {
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const { baseUpdatedAt, ...input } = c.req.valid("json");
      const looService = c.get("looService");

      if (await canWriteDirectly(c, user)) {
        const contributor = extractContributor(user, c.env.AUTH0_PROFILE_KEY);
        return stateChangeResponse(
          c,
          await looService.report(id, input, contributor, { baseUpdatedAt }),
        );
      }

      const limited = await queuedWriteRateLimitExceeded(c);
      if (limited) return limited;

      const checked = await looService.checkReport(id, input, { baseUpdatedAt });
      if (checked.status !== "ok") return stateChangeResponse(c, checked);

      const payload = {
        reason: input.reason,
        ...(input.details ? { details: input.details } : {}),
        ...(input.duplicateOf ? { duplicateOf: input.duplicateOf } : {}),
      };
      return queueForModeration(c, "remove", payload, id, baseUpdatedAt ?? checked.base.updatedAt);
    }),
);

/**
 * POST /loos/:id/restore
 *
 * "It's still here": puts a removed toilet back on the map. Trusted callers
 * apply it (200 with the loo and its `compressed` tuple); everyone else
 * queues a `restore` change (202). 409 `not_removed` when it is on the map.
 * `details` is a moderator note: kept on queued restores only. A trusted
 * restore does not store it and answers `detailsIgnored: true` when sent.
 */
loosRouter.post(
  "/:id/restore",
  optionalAuth,
  authenticatedWriteRateLimit,
  writeBodyLimit,
  validate("param", looIdParamSchema, "Invalid id path parameter"),
  validate("json", restoreSchema, "Invalid restore request body"),
  (c) =>
    handleRoute(c, "loos.restore", async () => {
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const { baseUpdatedAt, details } = c.req.valid("json");
      const looService = c.get("looService");

      if (await canWriteDirectly(c, user)) {
        const contributor = extractContributor(user, c.env.AUTH0_PROFILE_KEY);
        const result = await looService.restore(id, contributor, { baseUpdatedAt });
        // `details` is a note for moderators; a direct restore has no
        // moderator and no field to store it in, so it is not kept. Say so
        // rather than drop it silently.
        if (result.status === "updated" && details) {
          return c.json(
            { ...result.loo, compressed: toCompressedLoo(result.loo), detailsIgnored: true },
            200,
          );
        }
        return stateChangeResponse(c, result);
      }

      const limited = await queuedWriteRateLimitExceeded(c);
      if (limited) return limited;

      const checked = await looService.checkRestore(id, { baseUpdatedAt });
      if (checked.status !== "ok") return stateChangeResponse(c, checked);

      return queueForModeration(
        c,
        "restore",
        details ? { details } : {},
        id,
        baseUpdatedAt ?? checked.base.updatedAt,
      );
    }),
);

/**
 * POST /loos/:id/verify
 *
 * "Yes, it's still here": anyone may confirm a toilet, which only sets
 * `verified_at` to now. Anonymous callers share the anonymous write limiter.
 */
loosRouter.post(
  "/:id/verify",
  optionalAuth,
  authenticatedWriteRateLimit,
  writeBodyLimit,
  validate("param", looIdParamSchema, "Invalid id path parameter"),
  (c) =>
    handleRoute(c, "loos.verify", async () => {
      const { id } = c.req.valid("param");
      if (!c.get("user")) {
        const limited = await queuedWriteRateLimitExceeded(c);
        if (limited) return limited;
      }

      const result = await c.get("looService").verify(id);
      if (result.status === "not_found") return notFound(c, "Loo not found");
      if (result.status === "removed") {
        return c.json(
          { message: "This toilet has been removed from the map.", error: "removed" },
          409,
        );
      }
      return c.json({ id, verifiedAt: result.verifiedAt }, 200);
    }),
);

export { loosRouter };
