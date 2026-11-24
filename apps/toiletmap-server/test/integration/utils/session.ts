import { getTestContext } from "../setup";

/** The origin `callApi` sends requests to (see test-client.ts). */
export const TEST_ORIGIN = "https://integration.test";

export interface SessionCookieOptions {
  sub: string;
  permissions?: string[];
  /** Profile claims carried by the id_token (the server reads name and email from it). */
  profile?: { name?: string; nickname?: string; email?: string };
}

/**
 * The cookies the admin sign-in sets (src/admin/auth.ts): an access token for
 * the API audience and an id_token for the client id, nothing else.
 */
export const sessionCookie = ({ sub, permissions = [], profile = {} }: SessionCookieOptions) => {
  const { issueToken } = getTestContext();
  const accessToken = issueToken({ sub, permissions });
  const idToken = issueToken({ sub, permissions, ...profile, aud: process.env.AUTH0_CLIENT_ID });
  return `id_token=${idToken}; access_token=${accessToken}`;
};

/**
 * Session cookies plus the same-origin `Origin` a browser sends with the
 * admin's own requests; cookie-authenticated POST/PUT need it (CSRF check).
 */
export const sessionHeaders = (options: SessionCookieOptions) => ({
  Cookie: sessionCookie(options),
  Origin: TEST_ORIGIN,
});
