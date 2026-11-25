/**
 * The signed-in flag cookie. Sign-in (src/pages/auth/callback.ts) sets it next to the httpOnly
 * token cookies so pages, including prerendered ones read in the browser, can show "Sign out"
 * instead of "Sign in". It holds no data (always {@link SIGNED_IN_VALUE}): no name, email or
 * sub is ever readable by page JavaScript. It decides nothing about access; the API checks the
 * token on every request.
 *
 * Safe to import from both the worker and browser islands.
 */
export const SIGNED_IN_COOKIE = "signed_in";
export const SIGNED_IN_VALUE = "1";

/** The profile cookie sessions used to have (sub, email, name): deleted at sign-in and sign-out. */
export const LEGACY_USER_INFO_COOKIE = "user_info";

/**
 * Cookie names that mean "signed in". Sessions from before the flag have only the legacy
 * profile cookie; until they sign in again (or their access token expires, at most 24 h after
 * this shipped) its presence counts too, so they are not shown "Sign in" while their changes
 * still go live. Only its presence: it is never parsed. Remove the legacy name a day after the
 * flag ships.
 */
export const SIGNED_IN_COOKIE_NAMES: readonly string[] = [
  SIGNED_IN_COOKIE,
  LEGACY_USER_INFO_COOKIE,
];

/** Reads the cookies an Astro page sees. */
export interface CookieReader {
  get(name: string): { value: string } | undefined;
}

/** For pages: whether the visitor has the signed-in flag (or a legacy session's profile cookie). */
export function hasSignedInFlag(cookies: CookieReader): boolean {
  return SIGNED_IN_COOKIE_NAMES.some((name) => !!cookies.get(name)?.value);
}
