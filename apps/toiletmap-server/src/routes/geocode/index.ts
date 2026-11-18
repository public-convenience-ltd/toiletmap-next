/**
 * `GET /api/geocode?q=...[&mode=suggest]`: public GB place and postcode search
 * for the website's search boxes (see services/geocode/geocode.ts for the
 * upstreams, the two modes and the Nominatim usage-policy rules).
 *
 * Rate limits: every request counts against the shared `/api/*` read limit
 * (app.ts). An explicit search (the default mode, which may reach Nominatim)
 * also has its own per-IP limit (rateLimiters.geocode, 20/min), and each
 * Nominatim request takes a token from a budget shared by every isolate in a
 * Cloudflare location (the admin binding, 60/min, under the constant key
 * `nominatim`). `mode=suggest` (typing) never reaches Nominatim.
 *
 * 200 `{ results: [{ label, lat, lng, bbox?, kind }], attribution }`, cached
 * for a day in browsers and (on a custom domain) at the edge, keyed on the
 * mode and the normalised query.
 */

import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { edgeCache } from "../../middleware/cache";
import { rateLimiters } from "../../middleware/cloudflare-rate-limit";
import {
  createGeocoder,
  GEOCODE_QUERY_MAX_LENGTH,
  GEOCODE_QUERY_MIN_LENGTH,
  GeocodeBusyError,
  type GeocodeMode,
  type Geocoder,
  GeocodeUpstreamError,
  normaliseQuery,
} from "../../services/geocode/geocode";
import type { AppVariables, Env } from "../../types";
import { logger } from "../../utils/logger";

export const GEOCODE_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const GEOCODE_CACHE_CONTROL = `public, max-age=${GEOCODE_CACHE_TTL_SECONDS}`;
/** Bump to orphan every cached entry when the response shape changes. */
const CACHE_KEY_VERSION = "2";

/** The key every isolate shares on the Nominatim budget's rate-limit binding. */
export const NOMINATIM_BUDGET_KEY = "nominatim";

const querySchema = z.object({
  q: z
    .string({ error: "Enter a place or postcode to search for" })
    .transform(normaliseQuery)
    .pipe(
      z
        .string()
        .min(GEOCODE_QUERY_MIN_LENGTH, "Enter at least two characters")
        .max(
          GEOCODE_QUERY_MAX_LENGTH,
          `Search for ${GEOCODE_QUERY_MAX_LENGTH} characters or fewer`,
        ),
    ),
  mode: z
    .enum(["search", "suggest"], { error: "mode must be search or suggest" })
    .default("search"),
});

const noStore = { "Cache-Control": "no-store" };

type GeocodeContext = Context<{ Variables: AppVariables; Bindings: Env }>;

const modeOf = (c: GeocodeContext): GeocodeMode =>
  c.req.query("mode") === "suggest" ? "suggest" : "search";

/**
 * Takes a token from the Nominatim budget every isolate in this location
 * shares. Fails open, like the other limiters, when the binding is missing
 * (tests, some local setups) or errors: each isolate still spaces its own
 * requests a second apart.
 */
const nominatimBudget = (c: GeocodeContext) => async (): Promise<boolean> => {
  const limiter = c.env?.RATE_LIMIT_ADMIN;
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit({ key: NOMINATIM_BUDGET_KEY });
    if (!success) logger.warn("Nominatim budget used up", { rateLimiter: NOMINATIM_BUDGET_KEY });
    return success;
  } catch (error) {
    logger.warn("Nominatim budget check failed", {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
};

export const createGeocodeRouter = (geocoder: Geocoder = createGeocoder()) => {
  const router = new Hono<{ Variables: AppVariables; Bindings: Env }>();

  // Explicit searches (the ones that may reach Nominatim) have their own per-IP limit.
  router.get("/", (c, next) => (modeOf(c) === "suggest" ? next() : rateLimiters.geocode(c, next)));

  router.get("/", async (c) => {
    const parsed = querySchema.safeParse({ q: c.req.query("q"), mode: c.req.query("mode") });
    if (!parsed.success) {
      return c.json(
        { message: parsed.error.issues[0]?.message ?? "Invalid search", error: "invalid_query" },
        400,
        noStore,
      );
    }
    const { q: query, mode } = parsed.data;

    const cacheKey = `${new URL(c.req.url).origin}/api/geocode/__cache/v${CACHE_KEY_VERSION}?mode=${mode}&q=${encodeURIComponent(query)}`;
    const hit = await edgeCache.match(c, cacheKey, GEOCODE_CACHE_CONTROL);
    if (hit) return hit;

    try {
      const body = await geocoder.search(query, {
        mode,
        allowNominatim: nominatimBudget(c),
      });
      const response = c.json(body, 200, { "Cache-Control": GEOCODE_CACHE_CONTROL });
      edgeCache.put(c, cacheKey, response, GEOCODE_CACHE_TTL_SECONDS);
      return response;
    } catch (error) {
      if (error instanceof GeocodeBusyError) {
        return c.json(
          {
            message: "Place search is busy. Please try again in a moment.",
            error: "geocoder_busy",
          },
          503,
          { ...noStore, "Retry-After": "2" },
        );
      }
      if (!(error instanceof GeocodeUpstreamError)) throw error;
      // The query is not logged: people search for their own address.
      logger.warn("Geocoding failed", { errorName: error.name, errorMessage: error.message });
      return c.json(
        {
          message: "Place search is unavailable. Please try again later.",
          error: "geocoder_unavailable",
        },
        502,
        noStore,
      );
    }
  });

  return router;
};

export const geocodeRouter = createGeocodeRouter();
