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

const ADMIN_PERMISSION_CACHE_TTL_MS = 60 * 1000; // 60 seconds

type AdminPermissionCacheEntry = {
  hasPermission: boolean;
  expiresAt: number;
};

const adminPermissionCache = new Map<string, AdminPermissionCacheEntry>();

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

const getCachedAdminPermission = (userId: string): boolean | null => {
  const entry = adminPermissionCache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    adminPermissionCache.delete(userId);
    return null;
  }
  return entry.hasPermission;
};

const setCachedAdminPermission = (userId: string, hasPermission: boolean) => {
  adminPermissionCache.set(userId, {
    hasPermission,
    expiresAt: Date.now() + ADMIN_PERMISSION_CACHE_TTL_MS,
  });
};

const refreshAdminPermission = async (env: Env, userId: string): Promise<boolean | null> => {
  const client = getManagementClient(env);
  if (!client) {
    return null;
  }
  try {
    const permissions = await client.getUserPermissions(userId);
    const hasPermission = permissions.some(
      (permission) => permission.permission_name === ADMIN_PERMISSION,
    );
    setCachedAdminPermission(userId, hasPermission);
    return hasPermission;
  } catch (error) {
    logger.warn("Failed to refresh admin permissions", {
      userId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const ensureCurrentAdminPermission = async (
  c: Context<{ Variables: AppVariables; Bindings: Env }>,
  user: RequestUser,
): Promise<boolean> => {
  const baseHasPermission = hasAdminRole(user);
  if (!baseHasPermission) {
    return false;
  }

  const cached = getCachedAdminPermission(user.sub);
  if (cached !== null) {
    return cached;
  }

  const refreshed = await refreshAdminPermission(c.env, user.sub);
  if (refreshed === null) {
    return baseHasPermission;
  }
  return refreshed;
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
      adminPermissionCache.delete(user.sub);
      if (options?.unauthorizedResponse) {
        return options.unauthorizedResponse(c);
      }
      return c.json({ message: "Forbidden: Admin role required" }, 403);
    }

    return next();
  });

export const __adminRoleTestUtils = {
  clearPermissionCache: () => adminPermissionCache.clear(),
  clearManagementClientCache: () => managementClientCache.clear(),
};
