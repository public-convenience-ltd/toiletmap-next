import type { Auth0User } from '../types';

/**
 * Safely extracts a string value from an object using a key.
 * Returns the trimmed string if it exists and is non-empty, otherwise null.
 */
function getStringValue(
  obj: Record<string, unknown>,
  key: string,
): string | null {
  const value = obj[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Extracts a contributor identifier from an Auth0 user profile.
 *
 * This function attempts to extract a meaningful identifier for tracking
 * contributions to the toilet map. It follows a priority order to find
 * the most appropriate identifier.
 *
 * **Priority order:**
 * 1. Custom profile nickname (if `AUTH0_PROFILE_KEY` environment variable is set)
 * 2. User's `nickname` field
 * 3. User's `name` field
 * 4. User's `sub` (subject) field
 *
 * @param user - The Auth0 user object from the authentication context
 * @returns The contributor identifier string, or `null` if none can be determined
 *
 * @example
 * ```typescript
 * const user = { nickname: "john_doe", name: "John Doe", sub: "auth0|123" };
 * const contributor = extractContributor(user);
 * // Returns: "john_doe"
 * ```
 */
export function extractContributor(
  user: Auth0User | undefined | null,
): string | null {
  // Early return for null/undefined users
  if (!user) {
    return null;
  }

  // Check for custom profile nickname first (if configured)
  const profileKey = process.env.AUTH0_PROFILE_KEY;
  if (profileKey) {
    const profileValue = user[profileKey];
    if (typeof profileValue === 'object' && profileValue !== null) {
      const profile = profileValue as Record<string, unknown>;
      const nickname = getStringValue(profile, 'nickname');
      if (nickname) {
        return nickname;
      }
    }
  }

  // Fallback chain: nickname → name → sub
  if (user.nickname?.trim()) {
    return user.nickname.trim();
  }

  if (user.name?.trim()) {
    return user.name.trim();
  }

  if (user.sub?.trim()) {
    return user.sub.trim();
  }

  return null;
}
