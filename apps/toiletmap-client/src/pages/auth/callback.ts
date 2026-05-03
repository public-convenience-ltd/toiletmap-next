import { env } from "cloudflare:workers";
import { authenticateToken } from "@toiletmap/auth";
import type { APIRoute } from "astro";

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
  maxAge: 86400,
};

export const GET: APIRoute = async ({ cookies, redirect, url }) => {
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const storedState = cookies.get("auth_state")?.value;
  const storedNonce = cookies.get("auth_nonce")?.value;

  cookies.delete("auth_state", { path: "/" });
  cookies.delete("auth_nonce", { path: "/" });

  if (!returnedState || !storedState || !constantTimeEquals(returnedState, storedState)) {
    return new Response("Invalid authentication state", { status: 400 });
  }

  if (!storedNonce) {
    return new Response("Invalid authentication nonce", { status: 400 });
  }

  if (!code) {
    return new Response("Missing authorization code", { status: 400 });
  }

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
        redirect_uri: env.AUTH0_REDIRECT_URI,
      }),
    });

    if (!tokenResponse.ok) {
      return new Response("Authentication failed", { status: 401 });
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      id_token: string;
    };

    const idTokenUser = await authenticateToken(tokenData.id_token, env, env.AUTH0_CLIENT_ID);

    const nonceClaim = (idTokenUser as Record<string, unknown>).nonce;
    const tokenNonce = typeof nonceClaim === "string" ? nonceClaim : null;

    if (!tokenNonce || !constantTimeEquals(tokenNonce, storedNonce)) {
      return new Response("Invalid authentication nonce", { status: 401 });
    }

    cookies.set("id_token", tokenData.id_token, SESSION_COOKIE_OPTS);
    cookies.set("access_token", tokenData.access_token, SESSION_COOKIE_OPTS);

    const userInfo = btoa(
      JSON.stringify({
        sub: idTokenUser.sub,
        email: idTokenUser.email,
        name: idTokenUser.name,
        nickname: idTokenUser.nickname,
      }),
    );
    cookies.set("user_info", userInfo, {
      ...SESSION_COOKIE_OPTS,
      httpOnly: false,
    });

    return redirect("/");
  } catch {
    return new Response("Authentication error", { status: 500 });
  }
};
