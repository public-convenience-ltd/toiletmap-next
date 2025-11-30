import type { ZodIssue } from "zod";

/**
 * Shared form utility functions used across loo form handling
 */

export type TriStateValue = "true" | "false" | "";
export type FieldErrors = Record<string, string>;

/**
 * Sanitizes coordinate input by trimming whitespace
 * Returns 'NaN' for empty strings to trigger validation errors
 */
export const sanitizeCoordinate = (value: string): string => {
  const trimmed = value.trim();
  return trimmed === "" ? "NaN" : trimmed;
};

/**
 * Sanitizes text input by trimming whitespace
 */
export const sanitizeText = (value: string): string => value.trim();

/**
 * Converts a string to null if empty after trimming
 * Used for optional string fields that should be null when empty
 */
export const toNullableString = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

/**
 * Converts tri-state form values to boolean or null
 * 'true' -> true
 * 'false' -> false
 * '' -> null (unknown/not set)
 */
export const triStateToBoolean = (value: TriStateValue): boolean | null => {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
};

/**
 * Maps Zod validation issues to a flat field error object
 * Only captures the first error for each field
 */
export const mapIssuesToErrors = (issues: ZodIssue[]): FieldErrors => {
  const errors: FieldErrors = {};
  issues.forEach((issue) => {
    const key = issue.path[0];
    if (typeof key === "string" && !errors[key]) {
      errors[key] = issue.message;
    }
  });
  return errors;
};
