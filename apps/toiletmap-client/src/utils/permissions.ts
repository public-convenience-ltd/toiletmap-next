import { jwtExpiry } from "./returnTo";
import { type CookieReader, hasSignedInFlag } from "./session";

/**
 * Whether an access token's holder can expect their changes to go live straight away: it is
 * a readable JWT whose `exp` is still in the future, so the API will see them as signed in.
 * Mirrors `canWriteDirectly` in the server's `src/middleware/require-admin-role.ts`, which
 * lets anyone signed in write directly unless they are blocked in Auth0. Like this check, the
 * server goes by the access token: a session it can only authenticate by its id_token is queued.
 *
 * The client cannot see Auth0 blocks, so a blocked user is told their change goes live and
 * then shown the "a moderator will review" result the API returns instead. The token is
 * decoded WITHOUT verifying it: this only chooses between "Your change will go live straight
 * away" and "A moderator will check your change", never whether a write is allowed (the API
 * decides that on every request, and may still queue it).
 */
export function canWriteDirectlyFromToken(
  accessToken: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  const exp = jwtExpiry(accessToken);
  return exp !== null && exp * 1000 > nowMs;
}

/** For pages: signed in (the `signed_in` flag) with an access token that has not expired. */
export function sessionCanWriteDirectly(
  cookies: CookieReader,
  nowMs: number = Date.now(),
): boolean {
  if (!hasSignedInFlag(cookies)) return false;
  return canWriteDirectlyFromToken(cookies.get("access_token")?.value, nowMs);
}
