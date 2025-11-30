/**
 * Environment detection utilities
 *
 * For security purposes, we treat both production and preview environments
 * as "public" environments that should not expose sensitive error details.
 */

import type { Env } from "../types";

/**
 * Determines if the current environment is public-facing and should
 * sanitize error messages to prevent information leakage.
 *
 * @param env - Environment bindings
 * @returns true if running in production or preview (public environments)
 */
export function isPublicEnvironment(env: Env): boolean {
  // Explicitly check for development to be safe by default
  // If ENVIRONMENT is not set or is anything other than 'development',
  // we treat it as public to prevent accidental information disclosure
  return env.ENVIRONMENT !== "development";
}

/**
 * Gets the current environment name for logging and debugging.
 * Defaults to 'development' if not explicitly set.
 *
 * @param env - Environment bindings
 * @returns 'production', 'preview', or 'development'
 */
export function getEnvironmentName(env: Env): "production" | "preview" | "development" {
  if (env.ENVIRONMENT === "production") {
    return "production";
  }
  if (env.ENVIRONMENT === "preview") {
    return "preview";
  }
  return "development";
}
