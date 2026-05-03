import type { APIRoute } from "astro";

const CLEAR_OPTS = { httpOnly: true, path: "/" };

export const GET: APIRoute = ({ cookies, redirect }) => {
  cookies.delete("id_token", CLEAR_OPTS);
  cookies.delete("access_token", CLEAR_OPTS);
  cookies.delete("user_info", { path: "/" });
  return redirect("/");
};
