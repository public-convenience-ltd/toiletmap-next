import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { hasBearerToken } from "../auth/auth-context";
import { hasSessionCookie } from "../auth/session";
import { isLegacyGraphqlPath } from "../routes/legacy-graphql/path";
import type { AppVariables, Env } from "../types";
import { logger } from "../utils/logger";

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

/** Methods that cannot change state. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const isProtectedPath = (path: string) =>
  path === "/admin" || path.startsWith("/admin/") || path === "/api" || path.startsWith("/api/");

/**
 * Whether the browser says this request came from this server's own pages:
 * `Origin` equal to the request's own origin, or, when a browser sends no
 * `Origin`, `Sec-Fetch-Site: same-origin` (or `none`, a user-initiated
 * navigation). A request with neither header is refused: every browser that
 * sends cookies sends one of them on a POST.
 */
export const isSameOriginRequest = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  if (origin !== null) {
    try {
      return origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === "same-origin" || fetchSite === "none";
};

const FORBIDDEN_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Request blocked</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5;">
<h1>Request blocked</h1>
<p>This change did not come from a Toilet Map admin page, so it was not made. Go back to the <a href="/admin">admin dashboard</a> and try again from there.</p>
</body>
</html>`;

/**
 * CSRF protection for cookie sessions. A state-changing request (anything but
 * GET, HEAD and OPTIONS) to `/admin/*` or `/api/*` that carries a session
 * cookie must come from this origin (see {@link isSameOriginRequest});
 * otherwise it gets a 403 (JSON under `/api`, a short page under `/admin`)
 * before any handler runs. SameSite=Lax alone does not stop a same-site
 * attacker (another subdomain of the same registrable domain).
 *
 * Not checked:
 * - requests with `Authorization: Bearer`: they authenticate by the header,
 *   which a browser never attaches on its own, and ignore the cookies;
 * - requests without a session cookie: they are anonymous, so there is no
 *   ambient credential to abuse (the Flutter app and the client's server-side
 *   proxy send no cookies);
 * - the legacy GraphQL endpoint, which never looks at the caller.
 */
export const requireSameOriginForCookieAuth = createMiddleware<{
  Bindings: Env;
  Variables: AppVariables;
}>(async (c: AppContext, next) => {
  const path = c.req.path;
  if (
    SAFE_METHODS.has(c.req.method.toUpperCase()) ||
    !isProtectedPath(path) ||
    isLegacyGraphqlPath(path) ||
    hasBearerToken(c) ||
    !hasSessionCookie(c) ||
    isSameOriginRequest(c.req.raw)
  ) {
    await next();
    return;
  }

  logger.warn("Blocked a cookie-authenticated request from another origin", {
    method: c.req.method,
    path,
    origin: c.req.header("origin") ?? null,
    secFetchSite: c.req.header("sec-fetch-site") ?? null,
  });

  if (path === "/admin" || path.startsWith("/admin/")) {
    return c.html(FORBIDDEN_PAGE, 403);
  }
  return c.json(
    { message: "Forbidden: cross-origin request with session cookies", error: "csrf" },
    403,
  );
});
