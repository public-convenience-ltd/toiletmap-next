import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

// Attributes must match what was set in /auth/callback so browsers honour the deletion
const TOKEN_CLEAR_OPTS = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };
const USER_INFO_CLEAR_OPTS = { httpOnly: false, secure: true, sameSite: "lax" as const, path: "/" };

export const GET: APIRoute = ({ cookies, redirect, url }) => {
  cookies.delete("id_token", TOKEN_CLEAR_OPTS);
  cookies.delete("access_token", TOKEN_CLEAR_OPTS);
  cookies.delete("user_info", USER_INFO_CLEAR_OPTS);

  // Redirect through Auth0's logout endpoint to terminate the SSO session.
  // Without this the Auth0 cookie stays active and the user is silently
  // re-authenticated on the next login attempt.
  const issuerBase = env.AUTH0_ISSUER_BASE_URL?.replace(/\/$/, "");
  const clientId = env.AUTH0_CLIENT_ID;
  if (issuerBase && clientId) {
    const auth0LogoutUrl = new URL(`${issuerBase}/v2/logout`);
    auth0LogoutUrl.searchParams.set("client_id", clientId);
    auth0LogoutUrl.searchParams.set("returnTo", url.origin);
    return redirect(auth0LogoutUrl.toString());
  }

  return redirect("/");
};
