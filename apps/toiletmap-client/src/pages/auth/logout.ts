import type { APIRoute } from "astro";

// Attributes must match what was set in /auth/callback so browsers honour the deletion
const TOKEN_CLEAR_OPTS = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };
const USER_INFO_CLEAR_OPTS = { httpOnly: false, secure: true, sameSite: "lax" as const, path: "/" };

export const GET: APIRoute = ({ cookies, redirect }) => {
  cookies.delete("id_token", TOKEN_CLEAR_OPTS);
  cookies.delete("access_token", TOKEN_CLEAR_OPTS);
  cookies.delete("user_info", USER_INFO_CLEAR_OPTS);
  return redirect("/");
};
