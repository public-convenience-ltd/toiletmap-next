/**
 * The legacy app records a location change as an audit row of its own: right
 * after the user's edit, `setLooLocation` runs
 *
 *   contributors = array_append(contributors,
 *     concat(contributors[array_upper(contributors, 1)], '-location'))
 *
 * so the row's last contributor is exactly the one before it plus
 * `-location` (just `-location` when the array was empty, as `concat` treats
 * NULL as ''). History hides these system rows.
 *
 * Only that exact shape counts. A contributor whose own handle happens to end
 * in `-location` is an ordinary edit and stays visible.
 */
export const LEGACY_LOCATION_SUFFIX = "-location";

export const isLegacyLocationReport = (contributors: unknown): boolean => {
  if (!Array.isArray(contributors) || contributors.length === 0) return false;
  const last = contributors[contributors.length - 1];
  const before = contributors.length > 1 ? contributors[contributors.length - 2] : "";
  return (
    typeof last === "string" &&
    typeof before === "string" &&
    last === `${before}${LEGACY_LOCATION_SUFFIX}`
  );
};

/** {@link isLegacyLocationReport} for an audit snapshot of a toilets row. */
export const isLegacyLocationSnapshot = (record: unknown): boolean =>
  record !== null &&
  typeof record === "object" &&
  !Array.isArray(record) &&
  isLegacyLocationReport((record as { contributors?: unknown }).contributors);
