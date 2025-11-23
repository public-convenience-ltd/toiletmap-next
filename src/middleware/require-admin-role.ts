import { createMiddleware } from 'hono/factory';
import { AppVariables, RequestUser } from '../types';

export const ADMIN_ROLE_ID = 'access:admin';

export const hasAdminRole = (
  user?: RequestUser | null,
): boolean => {
  if (!user) return false;
  const permissions = Array.isArray(user.permissions)
    ? user.permissions
    : [];
  return permissions.includes(ADMIN_ROLE_ID);
};

/**
 * Middleware to require admin role permissions.
 * Must be used after requireAuth middleware.
 */
export const requireAdminRole = createMiddleware<{ Variables: AppVariables }>(
  async (c, next) => {
    const user = c.get('user');

    if (!user) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    if (!hasAdminRole(user)) {
      return c.json(
        { message: 'Forbidden: Admin role required' },
        403,
      );
    }

    return next();
  },
);
