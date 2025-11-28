import { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { AppVariables, Env } from '../types';
import {
  authenticateRequest,
  AuthOptions,
  AuthResult,
} from './auth-context';
import { logger } from '../utils/logger';

type HonoBindings = { Bindings: Env; Variables: AppVariables };

type UnauthorizedHandler = (c: Context<HonoBindings>) => Response | Promise<Response>;

interface AuthMiddlewareOptions extends AuthOptions {
  unauthorizedResponse?: UnauthorizedHandler;
}

const defaultUnauthorized = (c: Context<HonoBindings>) =>
  c.json({ message: 'Unauthorized' }, 401);

const handleUnauthorized = (
  c: Context<HonoBindings>,
  options?: AuthMiddlewareOptions,
) => {
  const handler = options?.unauthorizedResponse ?? defaultUnauthorized;
  return handler(c);
};

const createAuthMiddleware = (
  mode: 'optional' | 'required',
  options?: AuthMiddlewareOptions,
) =>
  createMiddleware<HonoBindings>(async (c, next) => {
    let result: AuthResult | null;

    try {
      result = await authenticateRequest(c, options);
    } catch (error) {
      if (error instanceof Error) {
        logger.logError(error, {
          path: c.req.path,
          method: c.req.method,
        });
      } else {
        logger.error('Authentication failed', {
          path: c.req.path,
          method: c.req.method,
          errorMessage: String(error),
        });
      }
      return handleUnauthorized(c, options);
    }

    if (!result) {
      if (mode === 'required') {
        return handleUnauthorized(c, options);
      }
      return next();
    }

    c.set('user', result.user);
    return next();
  });

export const optionalAuth = createAuthMiddleware('optional');
export const requireAuth = createAuthMiddleware('required');
export const requireAdminAuth = createAuthMiddleware('required', {
  unauthorizedResponse: (c) => c.redirect('/admin/login'),
});
