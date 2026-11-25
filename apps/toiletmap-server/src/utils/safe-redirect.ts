/**
 * Redirect targets taken from a request (a form's `redirect_to`), kept on this
 * origin and inside the admin. The same checks as the client's `safeReturnTo`
 * (apps/toiletmap-client/src/utils/returnTo.ts), restricted to `/admin/`.
 */

const MAX_REDIRECT_LENGTH = 2048;
const PLACEHOLDER_ORIGIN = "https://redirect.invalid";

/**
 * A path a browser might resolve to another origin: `//host`, any backslash
 * (`/\host` is `//host`), control characters (URL parsing strips them:
 * `/\t/host` is `//host`), or anything not starting with `/` (a scheme).
 */
const looksCrossOrigin = (value: string): boolean =>
  !value.startsWith("/") ||
  value.startsWith("//") ||
  value.includes("\\") ||
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  /[\u0000-\u001f\u007f]/.test(value);

/**
 * `value` percent-decoded until it stops changing (at most three times), or
 * null when it, or any decoded form of it, looks cross-origin or can't be
 * decoded.
 */
const decodedForm = (value: string): string | null => {
  let decoded = value;
  for (let i = 0; i < 3; i++) {
    if (looksCrossOrigin(decoded)) return null;
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return null;
    }
    if (next === decoded) break;
    decoded = next;
  }
  return looksCrossOrigin(decoded) ? null : decoded;
};

const isAdminPathname = (pathname: string) => {
  const lower = pathname.toLowerCase();
  return lower === "/admin" || lower.startsWith("/admin/");
};

/**
 * `value` as a same-origin admin URL (on a placeholder origin: use only its
 * `pathname`, `search` and `hash`), or null when it is not a path under
 * `/admin`, or could resolve to another origin. The checks run on the raw
 * value, its decoded forms and the normalised path, because removing dot
 * segments can turn `/.//host` into `//host`.
 */
export const safeAdminRedirect = (value: string | null | undefined): URL | null => {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > MAX_REDIRECT_LENGTH) return null;
  if (decodedForm(value) === null) return null;

  let parsed: URL;
  try {
    parsed = new URL(value, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (parsed.origin !== PLACEHOLDER_ORIGIN) return null;
  if (decodedForm(`${parsed.pathname}${parsed.search}${parsed.hash}`) === null) return null;
  const pathname = decodedForm(parsed.pathname);
  if (pathname === null || !isAdminPathname(pathname)) return null;
  return parsed;
};
