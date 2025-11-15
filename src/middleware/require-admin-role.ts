import { createMiddleware } from 'hono/factory';
import { AppVariables } from '../types';

const ADMIN_ROLE_ID = 'access:admin';

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

    // Check if user has admin permission in their permissions array
    const permissions = user.permissions as string[] | undefined;
    const hasAdminRole = permissions?.includes(ADMIN_ROLE_ID);

    if (!hasAdminRole) {
      return c.json(
        { message: 'Forbidden: Admin role required' },
        403,
      );
    }

    return next();
  },
);
