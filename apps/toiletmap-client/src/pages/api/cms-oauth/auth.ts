import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import {
  CMS_OAUTH_BASE_PATH,
  CMS_OAUTH_PROVIDER,
  CMS_OAUTH_STATE_COOKIE,
  CMS_OAUTH_STATE_MAX_AGE,
  cmsAuthResultPage,
  cmsNotConfiguredPage,
  cmsOAuthConfig,
  cmsOAuthRedirectUri,
  cmsOAuthScope,
  githubAuthorizeUrl,
  randomToken,
} from "../../../utils/cmsOAuth";

/**
 * GET /api/cms-oauth/auth: where the CMS's "Sign in with GitHub" popup starts. Remembers a
 * random state in a short-lived httpOnly cookie and sends the editor to GitHub. A static
 * route, so it outranks the API proxy (src/pages/api/[...path].ts), which would 404 it.
 * See src/utils/cmsOAuth.ts and docs/cms.md.
 */
export const prerender = false;

export const GET: APIRoute = ({ url, cookies }) => {
  const origin = url.origin;
  const nonce = randomToken(16);
  const config = cmsOAuthConfig(env);
  if (!config) return cmsNotConfiguredPage({ origin, nonce });

  const provider = url.searchParams.get("provider");
  if (provider && provider !== CMS_OAUTH_PROVIDER) {
    return cmsAuthResultPage({
      origin,
      nonce,
      status: 400,
      result: { error: "Only GitHub sign-in is supported.", errorCode: "UNSUPPORTED_BACKEND" },
    });
  }

  const state = randomToken();
  cookies.set(CMS_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: CMS_OAUTH_BASE_PATH,
    maxAge: CMS_OAUTH_STATE_MAX_AGE,
  });

  const location = githubAuthorizeUrl({
    clientId: config.clientId,
    redirectUri: cmsOAuthRedirectUri(origin),
    scope: cmsOAuthScope(url.searchParams.get("scope")),
    state,
  });
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
};
