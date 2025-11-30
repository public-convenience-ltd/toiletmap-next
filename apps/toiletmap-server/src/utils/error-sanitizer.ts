/**
 * Error sanitization utilities for security
 *
 * Prevents leaking sensitive information like database credentials,
 * internal paths, or stack traces in public-facing error responses.
 */

import type { Env } from "../types";
import { isPublicEnvironment } from "./environment";

/**
 * Sanitized error response for health checks
 */
export interface SanitizedHealthCheckError {
  status: "error";
  message: string;
  responseTime?: number;
}

/**
 * Sanitized error response for API endpoints
 */
export interface SanitizedApiError {
  message: string;
  error?: string;
  stack?: string;
}

/**
 * Sanitizes an error for inclusion in a health check response.
 *
 * In public environments (production/preview):
 * - Returns generic error message
 * - Preserves the type of check that failed
 * - Omits specific error details
 *
 * In development:
 * - Includes the actual error message for debugging
 *
 * @param env - Environment bindings
 * @param checkName - Name of the health check (e.g., "database", "cache")
 * @param error - The error that occurred
 * @param responseTime - Optional response time in milliseconds
 * @returns Sanitized error object safe for client response
 */
export function sanitizeHealthCheckError(
  env: Env,
  checkName: string,
  error: unknown,
  responseTime?: number,
): SanitizedHealthCheckError {
  const isPublic = isPublicEnvironment(env);

  const errorMessage = error instanceof Error ? error.message : String(error);

  return {
    status: "error",
    message: isPublic ? `${checkName} check failed` : errorMessage,
    responseTime,
  };
}

/**
 * Sanitizes an error for inclusion in a general API error response.
 *
 * In public environments (production/preview):
 * - Returns generic error message
 * - No stack traces
 * - No sensitive details
 *
 * In development:
 * - Includes error details and stack trace for debugging
 *
 * @param env - Environment bindings
 * @param error - The error that occurred
 * @param fallbackMessage - Generic message to show in public environments
 * @returns Sanitized error object safe for client response
 */
export function sanitizeApiError(
  env: Env,
  error: unknown,
  fallbackMessage: string = "An unexpected error occurred",
): SanitizedApiError {
  const isPublic = isPublicEnvironment(env);

  if (isPublic) {
    return {
      message: fallbackMessage,
    };
  }

  // Development: include full details
  return {
    message: fallbackMessage,
    error: String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
}
