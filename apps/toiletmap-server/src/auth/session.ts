import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { logger } from "../utils/logger";

export interface SessionUser {
  sub: string;
  email?: string;
  name?: string;
  nickname?: string;
  [key: string]: unknown;
}

/**
 * Session data structure - stores Auth0 tokens directly
 */
export interface SessionData {
  idToken: string;
  accessToken: string;
  user: SessionUser;
}

/**
 * Sets session cookies with Auth0 tokens
 */
export function setSessionCookies(c: Context, data: SessionData) {
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    secure: true, // Always true in production/workers
    sameSite: "Lax" as const,
    maxAge: 86400, // 24 hours
  };

  // Store both tokens in separate cookies
  setCookie(c, "id_token", data.idToken, cookieOptions);
  setCookie(c, "access_token", data.accessToken, cookieOptions);

  // Store user info as JSON
  const userInfo = btoa(JSON.stringify(data.user));
  setCookie(c, "user_info", userInfo, cookieOptions);
}

/**
 * Clears all session cookies
 */
export function clearSessionCookies(c: Context) {
  const clearOptions = {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
  };

  deleteCookie(c, "id_token", clearOptions);
  deleteCookie(c, "access_token", clearOptions);
  deleteCookie(c, "user_info", clearOptions);
}

/**
 * Gets session data from request cookies
 */
export function getSession(c: Context): SessionData | null {
  const idToken = getCookie(c, "id_token");
  const accessToken = getCookie(c, "access_token");
  const userInfoStr = getCookie(c, "user_info");

  if (!idToken || !accessToken || !userInfoStr) {
    return null;
  }

  try {
    const user = JSON.parse(atob(userInfoStr)) as SessionUser;
    return {
      idToken,
      accessToken,
      user,
    };
  } catch (error) {
    if (error instanceof Error) {
      logger.logError(error, {});
    } else {
      logger.error("Failed to parse user info from session cookie", {
        errorMessage: String(error),
      });
    }
    return null;
  }
}
