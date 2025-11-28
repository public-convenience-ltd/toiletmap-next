type Auth0UserProfile = {
  sub?: string | null;
  nickname?: string | null;
  name?: string | null;
  email?: string | null;
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

export type RequestUser = Auth0User & {
  sub: string;
  profile?: Auth0UserProfile;
};

/**
 * Cloudflare Workers environment bindings
 * Defines all environment variables and bindings available to the worker
 */
export interface Env {
  // Required environment variables
  TEST_DB: Hyperdrive;
  HYPERDRIVE: Hyperdrive;
  AUTH0_ISSUER_BASE_URL: string;
  AUTH0_AUDIENCE: string;

  // Auth0 OAuth configuration (Regular Web App)
  AUTH0_CLIENT_ID: string;
  AUTH0_CLIENT_SECRET: string;
  AUTH0_SCOPE: string;
  AUTH0_REDIRECT_URI: string;

  // Optional environment variables
  AUTH0_PROFILE_KEY?: string;
  AUTH0_PERMISSIONS_KEY?: string;
  AUTH0_MANAGEMENT_CLIENT_ID?: string;
  AUTH0_MANAGEMENT_CLIENT_SECRET?: string;
  AUTH0_MANAGEMENT_AUDIENCE?: string;

  // Environment configuration
  ENVIRONMENT?: 'production' | 'development';
  ALLOWED_ORIGINS?: string; // Comma-separated list of allowed CORS origins

  // Cloudflare Rate Limiting API bindings
  RATE_LIMIT_READ: RateLimiter;
  RATE_LIMIT_WRITE: RateLimiter;
  RATE_LIMIT_ADMIN: RateLimiter;
  RATE_LIMIT_AUTH: RateLimiter;
}

// Cloudflare Rate Limiting API type
interface RateLimiter {
  limit(options: { key: string }): Promise<{
    success: boolean;
  }>;
}

import { LooService } from './services/loo';

export type AppVariables = {
  user?: RequestUser;
  looService: LooService;
};
