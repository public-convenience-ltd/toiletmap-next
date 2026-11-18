/**
 * Friendly sign-in error pages (src/pages/auth/error.astro). /auth/callback classifies what
 * went wrong and rewrites to that page with the details in `locals.authError`, so the
 * details never come from the address bar: a crafted /auth/error URL can't put words on the
 * page. Visiting /auth/error directly (or with `?reason=<kind>`) shows fixed copy only.
 */

export const AUTH_ERROR_PATH = "/auth/error";

export const AUTH_ERROR_KINDS = [
  /** Auth0 said no: the visitor cancelled, or the account is blocked or not allowed. */
  "denied",
  /** Auth0 is having problems (`temporarily_unavailable`, `server_error`). */
  "unavailable",
  /** The sign-in took too long, or was started in another tab or browser (no state cookie). */
  "expired",
  /** The state or nonce didn't match this browser's: possibly someone else's sign-in link. */
  "state",
  /** Anything else Auth0 or the token exchange rejected. */
  "failed",
  /** Our side broke (an exception in the callback). */
  "error",
] as const;

export type AuthErrorKind = (typeof AUTH_ERROR_KINDS)[number];

export interface AuthErrorInfo {
  kind: AuthErrorKind;
  /**
   * Auth0's own explanation (`error_description`), only when the state matched, i.e. it
   * really came back from this browser's sign-in. Shown as plain text.
   */
  description?: string;
  /** Where "Try again" should come back to (already checked by safeReturnTo). */
  returnTo?: string | null;
}

export interface AuthErrorCopy {
  status: number;
  title: string;
  message: string;
}

const COPY: Record<AuthErrorKind, AuthErrorCopy> = {
  denied: {
    status: 403,
    title: "Sign-in didn't go through",
    message:
      "Signing in was cancelled, or isn't allowed for this account. You can still use the map, and suggest changes without signing in.",
  },
  unavailable: {
    status: 503,
    title: "Sign-in isn't working right now",
    message:
      "Our sign-in service is having problems. Please try again in a few minutes. You can still use the map, and suggest changes without signing in.",
  },
  expired: {
    status: 400,
    title: "Your sign-in expired",
    message:
      "Signing in took too long, or was started in another tab or browser, so we couldn't finish it. Please try again.",
  },
  state: {
    status: 400,
    title: "We stopped this sign-in",
    message:
      "We couldn't confirm that this sign-in was started in this browser, so we stopped it to keep your account safe. If you were signing in, please try again.",
  },
  failed: {
    status: 400,
    title: "We couldn't sign you in",
    message: "Something went wrong while signing you in. Please try again.",
  },
  error: {
    status: 500,
    title: "Something went wrong",
    message:
      "Something went wrong on our side while signing you in. Please try again in a moment. If it keeps happening, let us know through the feedback page.",
  },
};

export function isAuthErrorKind(value: unknown): value is AuthErrorKind {
  return typeof value === "string" && (AUTH_ERROR_KINDS as readonly string[]).includes(value);
}

/** The page's status code, heading and explanation for an error. */
export function authErrorCopy(kind: AuthErrorKind): AuthErrorCopy {
  return COPY[kind];
}

/** What an Auth0 `error` code (on the callback's query string) means for the visitor. */
export function auth0ErrorKind(error: string): AuthErrorKind {
  switch (error) {
    case "access_denied":
    case "unauthorized":
      return "denied";
    case "temporarily_unavailable":
    case "server_error":
      return "unavailable";
    case "login_required":
    case "consent_required":
    case "interaction_required":
      return "expired";
    default:
      return "failed";
  }
}

/** At most this much of Auth0's error_description is shown. */
export const MAX_AUTH_ERROR_DESCRIPTION = 300;

/** Auth0's error_description, trimmed to one short line of plain text, or undefined. */
export function cleanAuthErrorDescription(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are dropped
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (!text) return undefined;
  return text.length > MAX_AUTH_ERROR_DESCRIPTION
    ? `${text.slice(0, MAX_AUTH_ERROR_DESCRIPTION - 1)}…`
    : text;
}

/**
 * The error to show for a request to /auth/error: the callback's `locals.authError` when it
 * rewrote here, else a fixed `?reason=` kind (no description), else a general one.
 */
export function resolveAuthError(locals: unknown, reason: string | null): AuthErrorInfo {
  const fromCallback = (locals as { authError?: unknown } | null | undefined)?.authError;
  if (
    fromCallback &&
    typeof fromCallback === "object" &&
    isAuthErrorKind((fromCallback as AuthErrorInfo).kind)
  ) {
    return fromCallback as AuthErrorInfo;
  }
  return { kind: isAuthErrorKind(reason) ? reason : "failed" };
}
