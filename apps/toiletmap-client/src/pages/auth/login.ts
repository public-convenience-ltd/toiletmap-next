import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

const generateToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

export const GET: APIRoute = ({ cookies, redirect }) => {
  const state = generateToken();
  const nonce = generateToken();

  cookies.set("auth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 300,
  });
  cookies.set("auth_nonce", nonce, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 300,
  });

  const url = new URL(`${env.AUTH0_ISSUER_BASE_URL}authorize`);
  url.searchParams.set("client_id", env.AUTH0_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.AUTH0_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", env.AUTH0_SCOPE);
  url.searchParams.set("audience", env.AUTH0_AUDIENCE);
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);

  return redirect(url.toString());
};
