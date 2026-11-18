import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import {
  CMS_OAUTH_BASE_PATH,
  CMS_OAUTH_STATE_COOKIE,
  cmsAuthResultPage,
  cmsNotConfiguredPage,
  cmsOAuthConfig,
  cmsOAuthRedirectUri,
  constantTimeEquals,
  exchangeGitHubCode,
  randomToken,
} from "../../../utils/cmsOAuth";

/**
 * GET /api/cms-oauth/callback: GitHub's "Authorization callback URL". Checks the state
 * against the cookie set by /api/cms-oauth/auth (once: the cookie is cleared either way),
 * swaps the code for a token and hands it to the CMS window with postMessage pinned to this
 * site's origin. See src/utils/cmsOAuth.ts and docs/cms.md.
 */
export const prerender = false;

export const GET: APIRoute = async ({ url, cookies }) => {
  const origin = url.origin;
  const nonce = randomToken(16);
  const storedState = cookies.get(CMS_OAUTH_STATE_COOKIE)?.value;
  cookies.delete(CMS_OAUTH_STATE_COOKIE, { path: CMS_OAUTH_BASE_PATH });

  const config = cmsOAuthConfig(env);
  if (!config) return cmsNotConfiguredPage({ origin, nonce });

  const returnedState = url.searchParams.get("state");
  if (!returnedState || !storedState || !constantTimeEquals(returnedState, storedState)) {
    return cmsAuthResultPage({
      origin,
      nonce,
      status: 400,
      result: {
        error: "This sign-in link has expired or didn't start on this site. Please try again.",
        errorCode: "CSRF_DETECTED",
      },
    });
  }

  if (url.searchParams.get("error")) {
    return cmsAuthResultPage({
      origin,
      nonce,
      status: 400,
      result: { error: "GitHub sign-in was cancelled or refused.", errorCode: "AUTH_DENIED" },
    });
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return cmsAuthResultPage({
      origin,
      nonce,
      status: 400,
      result: {
        error: "GitHub didn't send a sign-in code. Please try again.",
        errorCode: "MISSING_CODE",
      },
    });
  }

  const exchange = await exchangeGitHubCode({
    config,
    code,
    redirectUri: cmsOAuthRedirectUri(origin),
  });
  if (!exchange.ok) {
    return cmsAuthResultPage({
      origin,
      nonce,
      status: 502,
      result: { error: exchange.error, errorCode: exchange.errorCode },
    });
  }
  return cmsAuthResultPage({ origin, nonce, result: { token: exchange.token } });
};
