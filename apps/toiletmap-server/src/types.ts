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
  TEST_HYPERDRIVE: Hyperdrive;
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
  ENVIRONMENT?: "production" | "preview" | "development";
  ALLOWED_ORIGINS?: string; // Comma-separated list of allowed CORS origins

  /**
   * Optional Slack incoming-webhook URL (a secret). When set, a counts-only
   * "N changes awaiting review" message is posted whenever a change is queued
   * for moderation. Unset (the default) disables alerts.
   */
  MODERATION_SLACK_WEBHOOK?: string;

  /**
   * Optional Cloudflare Turnstile secret. When set, `POST /api/feedback`
   * requires a valid Turnstile token. Unset (the default) disables the check.
   * Turning it on rejects the legacy Flutter app, which cannot send a token,
   * and the website's /feedback form, which has no Turnstile widget yet (it
   * would need one, with a public site key, before this is set).
   */
  TURNSTILE_SECRET_KEY?: string;

  // Cloudflare Rate Limiting API bindings
  RATE_LIMIT_READ: RateLimiter;
  RATE_LIMIT_WRITE: RateLimiter;
  RATE_LIMIT_ADMIN: RateLimiter;
  RATE_LIMIT_AUTH: RateLimiter;
  RATE_LIMIT_ANON_WRITE: RateLimiter;
}

// Cloudflare Rate Limiting API type
interface RateLimiter {
  limit(options: { key: string }): Promise<{
    success: boolean;
  }>;
}

import type { FeedbackService } from "./services/feedback/feedback.service";
import type { LooService } from "./services/loo";
import type { PendingChangeService } from "./services/pending-change/pending-change.service";

/** Which credential authenticated the request (see `src/auth/auth-context.ts`). */
export type AuthSource = "authorization-header" | "session-access-token" | "session-id-token";

export type AppVariables = {
  user?: RequestUser;
  /** Set with `user`. */
  authSource?: AuthSource;
  looService: LooService;
  pendingChangeService: PendingChangeService;
  feedbackService: FeedbackService;
  resultCount?: number;
  /** Admin pages only: pending-change count for the nav badge. */
  pendingCount?: number;
};
