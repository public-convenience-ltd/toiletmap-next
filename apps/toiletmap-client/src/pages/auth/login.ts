import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { RETURN_TO_COOKIE, safeReturnTo } from "../../utils/returnTo";

const generateToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

const SHORT_LIVED_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 300,
};

export const GET: APIRoute = ({ cookies, redirect, url }) => {
  const state = generateToken();
  const nonce = generateToken();

  cookies.set("auth_state", state, SHORT_LIVED_COOKIE_OPTS);
  cookies.set("auth_nonce", nonce, SHORT_LIVED_COOKIE_OPTS);

  // Where to go after signing in. Only same-origin relative paths are kept, so this can't
  // be used as an open redirect; anything else falls back to the home page.
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  if (returnTo) {
    cookies.set(RETURN_TO_COOKIE, returnTo, SHORT_LIVED_COOKIE_OPTS);
  } else {
    cookies.delete(RETURN_TO_COOKIE, { path: "/" });
  }

  const authUrl = new URL(`${env.AUTH0_ISSUER_BASE_URL}authorize`);
  authUrl.searchParams.set("client_id", env.AUTH0_CLIENT_ID || "");
  authUrl.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", env.AUTH0_SCOPE || "");
  authUrl.searchParams.set("audience", env.AUTH0_AUDIENCE || "");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);

  return redirect(authUrl.toString());
};
