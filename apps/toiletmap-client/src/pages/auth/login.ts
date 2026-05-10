import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

const generateToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

export const GET: APIRoute = ({ cookies, redirect, url }) => {
  const state = generateToken();
  const nonce = generateToken();

  cookies.set("auth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 300,
  });
  cookies.set("auth_nonce", nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 300,
  });

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
