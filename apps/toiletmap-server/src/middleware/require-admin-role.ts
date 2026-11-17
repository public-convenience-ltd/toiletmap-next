import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { clearSessionCookies } from "../auth/session";
import { ADMIN_PERMISSION } from "../common/permissions";
import { Auth0ManagementClient, hasAuth0ManagementConfig } from "../services/auth0/management";
import type { AppVariables, Env, RequestUser } from "../types";
import { logger } from "../utils/logger";

export const ADMIN_ROLE_ID = ADMIN_PERMISSION;

export const hasAdminRole = (user?: RequestUser | null): boolean => {
  if (!user) return false;
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  return permissions.includes(ADMIN_PERMISSION);
};

/** How long one Management API answer about a user (permissions, block status) is reused. */
const MANAGEMENT_CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * How long a failed block lookup is remembered. The user's changes are
 * queued meanwhile; the short wait stops every write during an Auth0 outage
 * or 429 from calling the Management API again.
 */
const FAILED_LOOKUP_CACHE_TTL_MS = 10 * 1000; // 10 seconds

type CacheEntry<T> = { value: T; expiresAt: number };

/** The user's current permission names, as the Auth0 Management API reports them. */
const permissionCache = new Map<string, CacheEntry<ReadonlySet<string>>>();

/** Whether Auth0 reports the user as blocked; `null` while a failed lookup is remembered. */
const blockedCache = new Map<string, CacheEntry<boolean | null>>();

const readCache = <T>(cache: Map<string, CacheEntry<T>>, userId: string): T | undefined => {
  const entry = cache.get(userId);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(userId);
    return undefined;
  }
  return entry.value;
};

const writeCache = <T>(
  cache: Map<string, CacheEntry<T>>,
  userId: string,
  value: T,
  ttlMs = MANAGEMENT_CACHE_TTL_MS,
): void => {
  cache.set(userId, { value, expiresAt: Date.now() + ttlMs });
};

const managementClientCache = new Map<string, Auth0ManagementClient>();

const getCacheKey = (env: Env) => `${env.AUTH0_ISSUER_BASE_URL}|${env.AUTH0_MANAGEMENT_CLIENT_ID}`;

const getManagementClient = (env: Env): Auth0ManagementClient | null => {
  if (!hasAuth0ManagementConfig(env)) {
    return null;
  }
  const cacheKey = getCacheKey(env);
  const existing = managementClientCache.get(cacheKey);
  if (existing) {
    return existing;
  }
  try {
    const client = Auth0ManagementClient.fromEnv(env);
    if (client) {
      managementClientCache.set(cacheKey, client);
    }
    return client;
  } catch (error) {
    logger.error("Failed to initialize Auth0 management client", {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

/**
 * Fetches the user's current permissions from the Auth0 Management API and
 * caches them. `null` when the API is not configured (local dev, tests) or
 * the lookup fails; callers then fall back to the token's claims.
 */
const refreshPermissions = async (
  env: Env,
  userId: string,
): Promise<ReadonlySet<string> | null> => {
  const client = getManagementClient(env);
  if (!client) {
    return null;
  }
  try {
    const records = await client.getUserPermissions(userId);
    const permissions = new Set(records.map((record) => record.permission_name));
    writeCache(permissionCache, userId, permissions);
    return permissions;
  } catch (error) {
    logger.warn("Failed to refresh user permissions", {
      userId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const tokenPermissions = (user: RequestUser): string[] =>
  Array.isArray(user.permissions) ? user.permissions : [];

/**
 * Which of `wanted` the user holds right now: the token must carry the
 * permission and, when the Auth0 Management API is configured, Auth0 must
 * still grant it (looked up once per user per 60s), so a revocation takes
 * effect within a minute rather than when the token expires.
 */
const currentPermissions = async (
  c: Context<{ Variables: AppVariables; Bindings: Env }>,
  user: RequestUser,
  wanted: readonly string[],
): Promise<Set<string>> => {
  const claimed = wanted.filter((permission) => tokenPermissions(user).includes(permission));
  if (claimed.length === 0) return new Set();

  const current =
    readCache(permissionCache, user.sub) ?? (await refreshPermissions(c.env, user.sub));
  if (current === null) return new Set(claimed);
  return new Set(claimed.filter((permission) => current.has(permission)));
};

const ensureCurrentAdminPermission = async (
  c: Context<{ Variables: AppVariables; Bindings: Env }>,
  user: RequestUser,
): Promise<boolean> =>
  (await currentPermissions(c, user, [ADMIN_PERMISSION])).has(ADMIN_PERMISSION);

let missingManagementConfigLogged = false;

/**
 * Whether Auth0 has blocked the user, looked up once per user per 60s.
 * `false` when the Management API is not configured outside production
 * (local dev, tests); `null` when the answer cannot be confirmed, including
 * a production deployment missing its Management API secrets.
 */
const isBlocked = async (env: Env, userId: string): Promise<boolean | null> => {
  const cached = readCache(blockedCache, userId);
  if (cached !== undefined) return cached;
  if (!hasAuth0ManagementConfig(env)) {
    if (env.ENVIRONMENT !== "production") return false;
    if (!missingManagementConfigLogged) {
      missingManagementConfigLogged = true;
      logger.error(
        "Auth0 Management API is not configured in production; queueing every signed-in change",
      );
    }
    return null;
  }

  const client = getManagementClient(env);
  if (!client) return null; // Configured but failed to initialise (already logged).
  try {
    const blocked = await client.isUserBlocked(userId);
    writeCache(blockedCache, userId, blocked);
    return blocked;
  } catch (error) {
    writeCache(blockedCache, userId, null, FAILED_LOOKUP_CACHE_TTL_MS);
    logger.error("Failed to check whether user is blocked; queueing their change", {
      userId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

/**
 * A machine-to-machine (client-credentials) token. Its subject is an Auth0
 * application, not a user, so there is nobody to look up or block.
 */
const isClientCredentialsToken = (user: RequestUser): boolean =>
  user.gty === "client-credentials" || user.sub.endsWith("@clients");

/**
 * Whether `user` may write loo data directly (create, edit, report, restore)
 * rather than having the change queued for moderation. Anyone signed in may,
 * unless they are blocked in Auth0. Queued instead:
 * - anonymous callers;
 * - blocked users, and users whose block status cannot be confirmed (when in
 *   doubt the change goes to a moderator, never straight to the map). This
 *   includes admins: during an Auth0 Management outage their API edits are
 *   queued too, and they can approve them in /admin/pending;
 * - sessions authenticated only by their id_token (the access token failed
 *   verification), matching the client, which predicts direct writes from
 *   the access token alone;
 * - machine-to-machine tokens, unless the token carries `access:admin`.
 */
export const canWriteDirectly = async (
  c: Context<{ Variables: AppVariables; Bindings: Env }>,
  user: RequestUser | null | undefined,
): Promise<boolean> => {
  if (!user) return false;
  if (c.get("authSource") === "session-id-token") return false;
  if (isClientCredentialsToken(user)) return hasAdminRole(user);
  return (await isBlocked(c.env, user.sub)) === false;
};

type UnauthorizedHandler = (
  c: Context<{ Variables: AppVariables; Bindings: Env }>,
) => Response | Promise<Response>;

interface AdminRoleOptions {
  unauthorizedResponse?: UnauthorizedHandler;
}

/**
 * Middleware to require admin role permissions.
 * Must be used after requireAuth middleware.
 */
export const requireAdminRole = (options?: AdminRoleOptions) =>
  createMiddleware<{ Variables: AppVariables; Bindings: Env }>(async (c, next) => {
    const user = c.get("user");

    if (!user) {
      return c.json({ message: "Unauthorized" }, 401);
    }

    const hasPermission = await ensureCurrentAdminPermission(c, user);
    if (!hasPermission) {
      clearSessionCookies(c);
      permissionCache.delete(user.sub);
      if (options?.unauthorizedResponse) {
        return options.unauthorizedResponse(c);
      }
      return c.json({ message: "Forbidden: Admin role required" }, 403);
    }

    return next();
  });

export const __adminRoleTestUtils = {
  clearPermissionCache: () => permissionCache.clear(),
  clearBlockedCache: () => blockedCache.clear(),
  clearManagementClientCache: () => managementClientCache.clear(),
};
