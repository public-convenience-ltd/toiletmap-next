import { jwtPayload } from "./returnTo";

/**
 * Permissions whose holders' writes go live without moderation. Mirrors `canWriteDirectly` in
 * the server's `src/middleware/require-admin-role.ts`, which reads the access token's
 * top-level `permissions` claim.
 */
export const DIRECT_WRITE_PERMISSIONS = ["report:loo", "access:admin"] as const;

/**
 * Whether the session's access token says its holder's changes go live straight away.
 *
 * The token is decoded WITHOUT verifying it: this only chooses between "Your change will go
 * live straight away" and "A moderator will check your change", never whether a write is
 * allowed (the API decides that on every request, and may still queue it).
 */
export function canWriteDirectlyFromToken(accessToken: string | null | undefined): boolean {
  const permissions = jwtPayload(accessToken)?.permissions;
  if (!Array.isArray(permissions)) return false;
  return permissions.some(
    (p) => typeof p === "string" && (DIRECT_WRITE_PERMISSIONS as readonly string[]).includes(p),
  );
}

/** Reads the session cookies an Astro page sees. */
interface CookieReader {
  get(name: string): { value: string } | undefined;
}

/** For pages: signed in (the `user_info` cookie) and trusted to write directly. */
export function sessionCanWriteDirectly(cookies: CookieReader): boolean {
  if (!cookies.get("user_info")?.value) return false;
  return canWriteDirectlyFromToken(cookies.get("access_token")?.value);
}
