/**
 * Parses the 'active' query parameter from API requests.
 *
 * This function interprets various string values to determine the active filter state:
 * - `"true"` → `true` (show only active loos)
 * - `"false"` → `false` (show only inactive loos)
 * - `"any"` or `"all"` → `null` (show all loos regardless of active status)
 * - `null`, `undefined`, or any other value → `true` (default to active only)
 *
 * @param value - The query parameter value to parse
 * @returns `true` for active only, `false` for inactive only, or `null` for all
 *
 * @example
 * ```typescript
 * parseActiveFlag("true")   // Returns: true
 * parseActiveFlag("false")  // Returns: false
 * parseActiveFlag("any")    // Returns: null
 * parseActiveFlag(undefined) // Returns: true (default)
 * ```
 */
export const parseActiveFlag = (
  value: string | undefined | null,
): boolean | null => {
  if (value === null || value === undefined) {
    return true;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  if (normalized === 'any' || normalized === 'all') {
    return null;
  }

  return true;
};
