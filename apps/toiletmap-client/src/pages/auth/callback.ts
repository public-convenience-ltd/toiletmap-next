import { env } from "cloudflare:workers";
import { authenticateToken } from "@toiletmap/auth";
import type { APIContext, APIRoute } from "astro";
import {
  AUTH_ERROR_PATH,
  type AuthErrorInfo,
  type AuthErrorKind,
  auth0ErrorKind,
  cleanAuthErrorDescription,
} from "../../utils/authError";
import { RETURN_TO_COOKIE, safeReturnTo, sessionMaxAge } from "../../utils/returnTo";
import { LEGACY_USER_INFO_COOKIE, SIGNED_IN_COOKIE, SIGNED_IN_VALUE } from "../../utils/session";

const constantTimeEquals = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
};

/**
 * Shows the friendly sign-in error page (src/pages/auth/error.astro) for this request. A
 * rewrite, not a redirect: the details travel in `locals`, never in a URL someone could
 * craft. "Try again" on that page comes back to the same returnTo.
 */
const showError = (
  context: Pick<APIContext, "locals" | "rewrite">,
  info: AuthErrorInfo,
): Promise<Response> => {
  (context.locals as { authError?: AuthErrorInfo }).authError = info;
  return context.rewrite(AUTH_ERROR_PATH);
};

export const GET: APIRoute = async (context) => {
  const { cookies, redirect, url } = context;
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const storedState = cookies.get("auth_state")?.value;
  const storedNonce = cookies.get("auth_nonce")?.value;
  // Re-validated here too: the cookie is httpOnly, but never trust a redirect target blindly.
  const savedReturnTo = safeReturnTo(cookies.get(RETURN_TO_COOKIE)?.value);
  const returnTo = savedReturnTo ?? "/";

  cookies.delete("auth_state", { path: "/" });
  cookies.delete("auth_nonce", { path: "/" });
  cookies.delete(RETURN_TO_COOKIE, { path: "/" });

  const stateMatches =
    !!returnedState && !!storedState && constantTimeEquals(returnedState, storedState);
  const fail = (kind: AuthErrorKind, description?: string) =>
    showError(context, { kind, description, returnTo: savedReturnTo });

  // Auth0 sends the visitor back with ?error=… when it won't sign them in (cancelled,
  // blocked, a rule or Action said no, or an outage). Its explanation is only shown when the
  // state proves the round trip started in this browser.
  const auth0Error = url.searchParams.get("error");
  if (auth0Error) {
    return fail(
      auth0ErrorKind(auth0Error),
      stateMatches
        ? cleanAuthErrorDescription(url.searchParams.get("error_description"))
        : undefined,
    );
  }

  // No state cookie at all: it expired (5 minutes) or the sign-in began in another browser.
  if (!storedState || !storedNonce) return fail("expired");
  if (!stateMatches) return fail("state");
  if (!code) return fail("failed");

  try {
    const tokenUrl = new URL(`${env.AUTH0_ISSUER_BASE_URL}oauth/token`);
    const tokenResponse = await fetch(tokenUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: env.AUTH0_CLIENT_ID,
        client_secret: env.AUTH0_CLIENT_SECRET,
        code,
        redirect_uri: `${url.origin}/auth/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      // invalid_grant: the code was already used (Back, then reload) or has expired.
      const body = (await tokenResponse.json().catch(() => null)) as { error?: unknown } | null;
      return fail(body?.error === "invalid_grant" ? "expired" : "failed");
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      id_token: string;
    };

    const idTokenUser = await authenticateToken(tokenData.id_token, env, env.AUTH0_CLIENT_ID);

    const nonceClaim = (idTokenUser as Record<string, unknown>).nonce;
    const tokenNonce = typeof nonceClaim === "string" ? nonceClaim : null;

    if (!tokenNonce || !constantTimeEquals(tokenNonce, storedNonce)) {
      return fail("state");
    }

    // Every step that can fail is done: only now write the session, so a failure (which
    // shows the error page) never leaves a half-session behind.
    // The session lasts as long as the access token: once it expires the API rejects it, so
    // keeping the cookies longer would only make the site look signed in when it isn't.
    const sessionCookieOpts = {
      ...SESSION_COOKIE_OPTS,
      maxAge: sessionMaxAge(tokenData.access_token),
    };
    cookies.set("id_token", tokenData.id_token, sessionCookieOpts);
    cookies.set("access_token", tokenData.access_token, sessionCookieOpts);
    // A value-less flag for "Sign out" in the header; the profile is never in a readable cookie.
    cookies.set(SIGNED_IN_COOKIE, SIGNED_IN_VALUE, { ...sessionCookieOpts, httpOnly: false });
    cookies.delete(LEGACY_USER_INFO_COOKIE, { path: "/" });

    return redirect(returnTo);
  } catch {
    return fail("error");
  }
};
