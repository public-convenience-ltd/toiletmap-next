import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { clearSessionCookies } from "../auth/session";
import { ADMIN_PERMISSION, REPORT_LOO_PERMISSION } from "../common/permissions";
import { Auth0ManagementClient, hasAuth0ManagementConfig } from "../services/auth0/management";
import type { AppVariables, Env, RequestUser } from "../types";
import { logger } from "../utils/logger";

export const ADMIN_ROLE_ID = ADMIN_PERMISSION;

export const hasAdminRole = (user?: RequestUser | null): boolean => {
  if (!user) return false;
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  return permissions.includes(ADMIN_PERMISSION);
};

const PERMISSION_CACHE_TTL_MS = 60 * 1000; // 60 seconds

type PermissionCacheEntry = {
  /** The user's current permission names, as the Auth0 Management API reports them. */
  permissions: ReadonlySet<string>;
  expiresAt: number;
};

const permissionCache = new Map<string, PermissionCacheEntry>();

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

const getCachedPermissions = (userId: string): ReadonlySet<string> | null => {
  const entry = permissionCache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    permissionCache.delete(userId);
    return null;
  }
  return entry.permissions;
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
    permissionCache.set(userId, {
      permissions,
      expiresAt: Date.now() + PERMISSION_CACHE_TTL_MS,
    });
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

  const current = getCachedPermissions(user.sub) ?? (await refreshPermissions(c.env, user.sub));
  if (current === null) return new Set(claimed);
  return new Set(claimed.filter((permission) => current.has(permission)));
};

const ensureCurrentAdminPermission = async (
  c: Context<{ Variables: AppVariables; Bindings: Env }>,
  user: RequestUser,
): Promise<boolean> =>
  (await currentPermissions(c, user, [ADMIN_PERMISSION])).has(ADMIN_PERMISSION);

/**
 * Whether `user` may write loo data directly (create, edit, report, restore)
 * rather than having the change queued for moderation: they hold `report:loo`
 * or `access:admin`. Both are confirmed by the same refreshed check the admin
 * dashboard uses (one cached Management API lookup per user per 60s; falls
 * back to the token when the Auth0 Management API is not configured).
 */
export const canWriteDirectly = async (
  c: Context<{ Variables: AppVariables; Bindings: Env }>,
  user: RequestUser | null | undefined,
): Promise<boolean> => {
  if (!user) return false;
  const held = await currentPermissions(c, user, [REPORT_LOO_PERMISSION, ADMIN_PERMISSION]);
  return held.size > 0;
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
  clearManagementClientCache: () => managementClientCache.clear(),
};
