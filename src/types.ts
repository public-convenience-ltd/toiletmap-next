export type Auth0UserProfile = {
  nickname?: string | null;
  name?: string | null;
  [key: string]: unknown;
};

export type Auth0User = {
  sub?: string;
  name?: string;
  nickname?: string;
  email?: string;
  permissions?: string[];
  [key: string]: unknown;
};

/**
 * Cloudflare Workers environment bindings
 * Defines all environment variables and bindings available to the worker
 */
export interface Env {
  // Required environment variables
  POSTGRES_URI: string;
  AUTH0_ISSUER_BASE_URL: string;
  AUTH0_AUDIENCE: string;

  // Auth0 OAuth configuration (Regular Web App)
  AUTH0_CLIENT_ID: string;
  AUTH0_CLIENT_SECRET: string;
  AUTH0_SCOPE: string;
  AUTH0_REDIRECT_URI: string;

  // Optional environment variables
  AUTH0_PROFILE_KEY?: string;
}

export type AppVariables = {
  user?: {
    sub: string;
    email?: string;
    name?: string;
    nickname?: string;
  };
};
