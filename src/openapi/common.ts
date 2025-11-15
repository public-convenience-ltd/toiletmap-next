import { z } from '@hono/zod-openapi';

export const ErrorResponseSchema = z
  .object({
    message: z
      .string()
      .openapi({
        description: 'Human readable error message.',
        example: 'Route not found',
      }),
    issues: z.unknown().optional().openapi({
      description: 'Validation details when applicable.',
    }),
  })
  .openapi('ErrorResponse');

export const ValidationErrorResponseSchema = ErrorResponseSchema.openapi(
  'ValidationErrorResponse',
);

export const HealthResponseSchema = z
  .object({
    status: z.enum(['ok']).openapi({
      description: 'Service health indicator.',
      example: 'ok',
    }),
    service: z.string().openapi({
      description: 'Identifier for the running service.',
      example: 'toiletmap-hono-api',
    }),
    uptime: z.number().nonnegative().openapi({
      description: 'Process uptime in seconds.',
      example: 42.17,
    }),
  })
  .openapi('HealthResponse');
