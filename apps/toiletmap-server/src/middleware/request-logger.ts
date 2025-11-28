import { MiddlewareHandler } from 'hono';
import { Env, AppVariables } from '../types';
import { createLogger } from '../utils/logger';

/**
 * Request logging middleware
 *
 * Logs all HTTP requests with structured logging including:
 * - Request method and path
 * - Response status and timing
 * - User information (if authenticated)
 * - Error details (if any)
 */
export const requestLogger = (env?: 'production' | 'development'): MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> => {
  const logger = createLogger(env);

  return async (c, next) => {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    const method = c.req.method;
    const path = c.req.path;

    // Log incoming request
    logger.info('Incoming request', {
      requestId,
      method,
      path,
      userAgent: c.req.header('user-agent'),
      ip: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'),
    });

    try {
      await next();

      // Log successful response
      const duration = Date.now() - startTime;
      const status = c.res.status;

      logger.info('Request completed', {
        requestId,
        method,
        path,
        status,
        duration,
        userId: c.get('user')?.sub,
      });
    } catch (error) {
      // Log error
      const duration = Date.now() - startTime;

      logger.error('Request failed', {
        requestId,
        method,
        path,
        duration,
        userId: c.get('user')?.sub,
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        } : {
          name: 'UnknownError',
          message: String(error),
        },
      });

      // Re-throw to let error handler deal with it
      throw error;
    }
  };
};
