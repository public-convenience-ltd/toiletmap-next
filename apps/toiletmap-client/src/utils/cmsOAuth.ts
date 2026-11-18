/**
 * GitHub sign-in for the CMS (/cms, Sveltia CMS): the OAuth "authorization code" flow behind
 * /api/cms-oauth/auth and /api/cms-oauth/callback (see docs/cms.md).
 *
 * 1. The CMS opens a popup at /api/cms-oauth/auth?provider=github&scope=public_repo.
 * 2. We set a random `state` in a short-lived httpOnly cookie and redirect to GitHub.
 * 3. GitHub sends the editor back to /api/cms-oauth/callback?code=...&state=...; we check the
 *    state against the cookie, swap the code for a token (with the client secret, which never
 *    leaves the worker) and answer with a tiny page that hands the token to the CMS window.
 * 4. That page speaks the Netlify/Decap/Sveltia popup protocol: it posts
 *    "authorizing:github" to its opener, waits for the opener to echo it back, then posts
 *    "authorization:github:success:{token}" (or ":error:{...}"). Every postMessage is pinned
 *    to our own origin, and the echo is only accepted from the opener at our own origin, so
 *    the token can only ever reach a /cms page on this site (the legacy site posted to "*").
 *
 * Until GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET are set, both endpoints answer
 * 503 "CMS sign-in isn't configured yet".
 */
import { serializeJsonLd } from "./seo";

export const CMS_OAUTH_PROVIDER = "github";
export const CMS_OAUTH_BASE_PATH = "/api/cms-oauth";
export const CMS_OAUTH_AUTH_PATH = `${CMS_OAUTH_BASE_PATH}/auth`;
export const CMS_OAUTH_CALLBACK_PATH = `${CMS_OAUTH_BASE_PATH}/callback`;
export const CMS_OAUTH_STATE_COOKIE = "cms_oauth_state";
/** Long enough to sign in to GitHub (and pass two-factor), short enough not to linger. */
export const CMS_OAUTH_STATE_MAX_AGE = 600;

export const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
export const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

/**
 * Scopes the CMS may ask for. The repository is public, so `public_repo` (the config's
 * `auth_scope`) is enough to commit and open pull requests; `repo` is allowed in case it
 * ever goes private. Anything else falls back to `public_repo`.
 */
export const CMS_OAUTH_SCOPES = ["public_repo", "repo"] as const;
export type CmsOAuthScope = (typeof CMS_OAUTH_SCOPES)[number];
export const DEFAULT_CMS_OAUTH_SCOPE: CmsOAuthScope = "public_repo";

export const CMS_NOT_CONFIGURED_TITLE = "CMS sign-in isn't configured yet";

export interface CmsOAuthEnv {
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
}

export interface CmsOAuthConfig {
  clientId: string;
  clientSecret: string;
}

/** The GitHub OAuth app's credentials, or null while either is unset or blank. */
export function cmsOAuthConfig(env: CmsOAuthEnv | null | undefined): CmsOAuthConfig | null {
  const clientId =
    typeof env?.GITHUB_OAUTH_CLIENT_ID === "string" ? env.GITHUB_OAUTH_CLIENT_ID.trim() : "";
  const clientSecret =
    typeof env?.GITHUB_OAUTH_CLIENT_SECRET === "string"
      ? env.GITHUB_OAUTH_CLIENT_SECRET.trim()
      : "";
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** The requested scope if it is one we allow, else `public_repo`. */
export function cmsOAuthScope(requested: string | null | undefined): CmsOAuthScope {
  const scope = requested?.trim();
  return (CMS_OAUTH_SCOPES as readonly string[]).includes(scope ?? "")
    ? (scope as CmsOAuthScope)
    : DEFAULT_CMS_OAUTH_SCOPE;
}

/** 32 random bytes as hex: the OAuth `state`, also used for script nonces. */
export function randomToken(bytes = 32): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Compares two strings in time that does not depend on where they first differ. */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Where GitHub sends the editor back to: always this site's own callback. */
export function cmsOAuthRedirectUri(origin: string): string {
  return `${origin}${CMS_OAUTH_CALLBACK_PATH}`;
}

export function githubAuthorizeUrl({
  clientId,
  redirectUri,
  scope,
  state,
}: {
  clientId: string;
  redirectUri: string;
  scope: CmsOAuthScope;
  state: string;
}): string {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "false");
  return url.toString();
}

export type TokenExchangeResult =
  | { ok: true; token: string }
  | { ok: false; error: string; errorCode: string };

/**
 * Swaps the code for an access token. GitHub answers 200 even for a bad code, with an
 * `error` field, so both are checked. Its error text is not passed on (it is generic anyway).
 */
export async function exchangeGitHubCode({
  config,
  code,
  redirectUri,
  fetchImpl = fetch,
}: {
  config: CmsOAuthConfig;
  code: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenExchangeResult> {
  let response: Response;
  try {
    response = await fetchImpl(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "toiletmap-cms-oauth",
      },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
  } catch {
    return {
      ok: false,
      error: "Couldn't reach GitHub. Please try again.",
      errorCode: "TOKEN_REQUEST_FAILED",
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: "GitHub didn't accept the sign-in. Please try again.",
      errorCode: "TOKEN_REQUEST_FAILED",
    };
  }
  let data: { access_token?: unknown; error?: unknown };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    return {
      ok: false,
      error: "GitHub sent an unexpected answer. Please try again.",
      errorCode: "MALFORMED_RESPONSE",
    };
  }
  if (typeof data.access_token === "string" && data.access_token) {
    return { ok: true, token: data.access_token };
  }
  return {
    ok: false,
    error: "GitHub didn't accept the sign-in. Please try again.",
    errorCode: "TOKEN_REQUEST_FAILED",
  };
}

export type CmsAuthResult = { token: string } | { error: string; errorCode: string };

/** The message the CMS window waits for: `authorization:github:<success|error>:<json>`. */
export function cmsAuthMessage(result: CmsAuthResult): string {
  const provider = CMS_OAUTH_PROVIDER;
  if ("token" in result) {
    return `authorization:${provider}:success:${JSON.stringify({ provider, token: result.token })}`;
  }
  return `authorization:${provider}:error:${JSON.stringify({
    provider,
    error: result.error,
    errorCode: result.errorCode,
  })}`;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Headers for every OAuth response: never cached, never indexed, never leaks a referrer. */
export function cmsOAuthHeaders(nonce?: string): Headers {
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    // Only this page's own inline script (if any) may run; nothing else loads.
    "Content-Security-Policy": [
      "default-src 'none'",
      nonce ? `script-src 'nonce-${nonce}'` : "script-src 'none'",
      "style-src 'unsafe-inline'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
  });
  return headers;
}

const pageShell = ({
  title,
  body,
  script,
  nonce,
}: {
  title: string;
  body: string;
  script?: string;
  nonce?: string;
}) => `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} – Toilet Map</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#0a165e}code{font-size:.95em}</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
${script && nonce ? `<script nonce="${nonce}">${script}</script>` : ""}
</body>
</html>
`;

/**
 * The script that hands a result to the CMS window (the popup's opener). `origin` is this
 * site's origin: the only place either message can go, and the only origin whose echo of
 * the handshake is answered. The CMS closes the popup once it has the result.
 */
export function cmsAuthHandoffScript({
  origin,
  result,
}: {
  origin: string;
  result: CmsAuthResult;
}): string {
  // JSON string literals, escaped so nothing in them can end the <script> element.
  return `(function () {
  var origin = ${serializeJsonLd(origin)};
  var handshake = ${serializeJsonLd(`authorizing:${CMS_OAUTH_PROVIDER}`)};
  var message = ${serializeJsonLd(cmsAuthMessage(result))};
  var opener = window.opener;
  if (!opener) return;
  window.addEventListener("message", function onMessage(event) {
    if (event.source !== opener || event.origin !== origin || event.data !== handshake) return;
    window.removeEventListener("message", onMessage);
    opener.postMessage(message, origin);
  });
  opener.postMessage(handshake, origin);
})();`;
}

/** The callback's answer: the hand-off script plus a line of text for the popup. */
export function cmsAuthResultPage({
  origin,
  result,
  nonce,
  status = 200,
}: {
  origin: string;
  result: CmsAuthResult;
  nonce: string;
  status?: number;
}): Response {
  const success = "token" in result;
  const body = success
    ? "<p>Signing you in to the CMS… This window will close by itself.</p>"
    : `<p>${escapeHtml(result.error)}</p><p>You can close this window and try again from <a href="/cms/">the CMS</a>.</p>`;
  return new Response(
    pageShell({
      title: success ? "Signing in" : "Sign-in failed",
      body,
      nonce,
      script: cmsAuthHandoffScript({ origin, result }),
    }),
    { status, headers: cmsOAuthHeaders(nonce) },
  );
}

/**
 * 503 while the GitHub OAuth app isn't set up. It still tells an open CMS window why, so the
 * CMS shows the reason next to its sign-in button rather than an endless "Authorizing…".
 */
export function cmsNotConfiguredPage({
  origin,
  nonce,
}: {
  origin: string;
  nonce: string;
}): Response {
  const body = `<p>Signing in to the CMS with GitHub needs a GitHub OAuth app, which hasn't been set up for this site yet.</p>
<p>The site owner can set it up by creating the app and setting <code>GITHUB_OAUTH_CLIENT_ID</code> and <code>GITHUB_OAUTH_CLIENT_SECRET</code> on the client worker (see <code>apps/toiletmap-client/docs/cms.md</code>).</p>`;
  const headers = cmsOAuthHeaders(nonce);
  headers.set("Retry-After", "3600");
  return new Response(
    pageShell({
      title: CMS_NOT_CONFIGURED_TITLE,
      body,
      nonce,
      script: cmsAuthHandoffScript({
        origin,
        result: { error: `${CMS_NOT_CONFIGURED_TITLE}.`, errorCode: "NOT_CONFIGURED" },
      }),
    }),
    { status: 503, headers },
  );
}
