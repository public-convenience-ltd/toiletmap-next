/// <reference types="astro/client" />

interface Env {
  PUBLIC_API_URL: string;
  /** toiletmap-server service binding (production only; absent in dev/preview). */
  API?: Fetcher;
  ENVIRONMENT?: string;
  AUTH0_ISSUER_BASE_URL: string;
  AUTH0_CLIENT_ID: string;
  AUTH0_CLIENT_SECRET: string;
  AUTH0_SCOPE: string;
  AUTH0_AUDIENCE: string;
}

// Worker secrets that `wrangler types` can't see (they aren't in wrangler.jsonc).
declare namespace Cloudflare {
  interface Env {
    /** GitHub OAuth app for CMS sign-in (/cms). Unset: /api/cms-oauth/* answer 503. See docs/cms.md. */
    GITHUB_OAUTH_CLIENT_ID?: string;
    GITHUB_OAUTH_CLIENT_SECRET?: string;
  }
}

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}
