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
   * Optional sunset date for the legacy GraphQL endpoint (`/api/graphql`), as
   * an HTTP-date such as "Sat, 01 Jan 2028 00:00:00 GMT". When set (and
   * valid), responses carry a `Sunset` header. Unset until a date is announced.
   */
  GRAPHQL_SUNSET?: string;

  /**
   * R2 bucket (`toiletmap-exports`) the daily dataset export writes to.
   * Bound in `env.production` only; absent in local dev, tests and preview
   * workers, where the export skips and the admin page says so.
   */
  EXPORTS?: R2Bucket;

  /**
   * Optional Cloudflare Turnstile secret. When set, `POST /api/feedback`
   * requires a valid Turnstile token. Unset (the default) disables the check.
   * Turning it on rejects the legacy Flutter app, which cannot send a token,
   * and the website's /feedback form, which has no Turnstile widget yet (it
   * would need one, with a public site key, before this is set).
   */
  TURNSTILE_SECRET_KEY?: string;

  /**
   * KV namespace for operational settings that must survive deploys. Key
   * `write_mode` is the write kill switch: `open` | `queue` | `read-only`
   * (src/services/write-mode.ts, docs/runbooks/kill-switch.md). Bound for
   * local dev only until the owner creates the production namespace; absent
   * means `open`.
   */
  SETTINGS?: KVNamespace;

  /**
   * Per-account limit on direct removals and moves in any 24 hours (default
   * 10; a non-negative integer, `0` queues every one). Past it, the write is
   * queued (202, `reason: "daily_cap"`). Confirmed admins are exempt. See
   * src/services/write-caps.ts.
   */
  ACCOUNT_DAILY_CAP?: string;

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
import type { WriteMode } from "./services/write-mode";

/** Which credential authenticated the request (see `src/auth/auth-context.ts`). */
export type AuthSource = "authorization-header" | "session-access-token";

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
  /** State-changing requests behind `writeModeGate` only: the write kill switch's mode. */
  writeMode?: WriteMode;
};
