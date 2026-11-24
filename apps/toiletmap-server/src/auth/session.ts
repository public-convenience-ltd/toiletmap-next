import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

/**
 * Admin session: the Auth0 tokens from the sign-in, each in its own httpOnly
 * cookie. Nothing else is stored: the profile (name, email) comes from the
 * verified id_token on every request (see `auth-context.ts`), so no cookie
 * the browser could edit ever feeds the contributor name.
 */
export interface SessionData {
  /** The API access token: the session's only credential. */
  accessToken: string;
  /** The OIDC id_token, used only for profile claims; never a credential. */
  idToken?: string;
}

/** Cookie names the admin session uses. `user_info` is the pre-2026-11 profile cookie. */
const SESSION_COOKIES = ["id_token", "access_token"] as const;
const LEGACY_SESSION_COOKIES = ["user_info"] as const;

const baseCookieOptions = {
  path: "/",
  httpOnly: true,
  secure: true, // Always true in production/workers
  sameSite: "Lax" as const,
};

/** Seconds until `exp` (a JWT `exp`, in seconds), never negative. */
export const secondsUntil = (exp: number, nowMs: number = Date.now()): number =>
  Math.max(0, Math.floor(exp - nowMs / 1000));

export interface SessionCookieInput {
  accessToken: string;
  /** The access token's verified `exp` claim. */
  accessTokenExp: number;
  idToken: string;
  /** The id_token's verified `exp` claim. */
  idTokenExp: number;
}

/**
 * Sets the session cookies. Each lasts no longer than its token: the
 * access_token cookie until the access token expires, the id_token cookie
 * until the earlier of the two (it is no use once the session has ended).
 * Call this only after every step that can fail, so a failure never leaves a
 * half-written session behind.
 */
export function setSessionCookies(
  c: Context,
  data: SessionCookieInput,
  nowMs: number = Date.now(),
) {
  const accessMaxAge = secondsUntil(data.accessTokenExp, nowMs);
  const idMaxAge = Math.min(accessMaxAge, secondsUntil(data.idTokenExp, nowMs));

  setCookie(c, "access_token", data.accessToken, { ...baseCookieOptions, maxAge: accessMaxAge });
  setCookie(c, "id_token", data.idToken, { ...baseCookieOptions, maxAge: idMaxAge });
  // Earlier sessions also had a profile cookie; it is never read now.
  for (const name of LEGACY_SESSION_COOKIES) {
    if (getCookie(c, name) !== undefined) deleteCookie(c, name, baseCookieOptions);
  }
}

/**
 * Clears all session cookies
 */
export function clearSessionCookies(c: Context) {
  for (const name of [...SESSION_COOKIES, ...LEGACY_SESSION_COOKIES]) {
    deleteCookie(c, name, baseCookieOptions);
  }
}

/**
 * Gets session data from request cookies: `null` without an access token.
 */
export function getSession(c: Context): SessionData | null {
  const accessToken = getCookie(c, "access_token");
  if (!accessToken) {
    return null;
  }
  const idToken = getCookie(c, "id_token");
  return idToken ? { accessToken, idToken } : { accessToken };
}

/** Whether the request carries any session cookie (used by the CSRF check). */
export function hasSessionCookie(c: Context): boolean {
  return SESSION_COOKIES.some((name) => Boolean(getCookie(c, name)));
}
