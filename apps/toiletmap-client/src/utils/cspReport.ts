/**
 * CSP violation reports (POST /api/csp-report, src/pages/api/csp-report.ts): reduced to one
 * short log line each, for the worker's logs. Two formats arrive:
 * - `report-uri` (Firefox, Safari): `application/csp-report`, `{"csp-report": {...}}`;
 * - `report-to` (Chromium, the Reporting API): `application/reports+json`, an array of
 *   `{type: "csp-violation", url, body: {...}}`.
 *
 * Nothing from a report is trusted or stored: it is truncated and logged, and the URLs keep
 * only their origin and path (no query strings, which can carry personal data).
 */

/** Reports bigger than this are dropped unread. */
export const MAX_CSP_REPORT_BYTES = 16 * 1024;
/** At most this many reports are logged from one request. */
export const MAX_REPORTS_PER_REQUEST = 10;

export interface CspViolation {
  /** Page the violation happened on (origin + path). */
  document: string;
  /** e.g. "script-src-elem". */
  directive: string;
  /** What was blocked: a URL (origin + path), or "inline", "eval", ... */
  blocked: string;
  /** "enforce" or "report". */
  disposition: string;
  sourceFile?: string;
  line?: number;
  /** The start of an inline script or style, when the browser sends one. */
  sample?: string;
}

const text = (value: unknown, max = 200): string =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip control characters from logs
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : "";

/** Origin + path of a URL, or the keyword browsers send instead ("inline", "eval", ...). */
function urlWithoutQuery(value: unknown): string {
  const raw = text(value, 500);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return `${url.origin}${url.pathname}`.slice(0, 200);
    }
    return url.protocol.slice(0, 20);
  } catch {
    return raw.slice(0, 50);
  }
}

function fromBody(body: Record<string, unknown>, legacy: boolean): CspViolation {
  const get = (modern: string, old: string) => (legacy ? body[old] : body[modern]);
  const line = get("lineNumber", "line-number");
  return {
    document: urlWithoutQuery(get("documentURL", "document-uri")),
    directive: text(
      legacy
        ? (body["effective-directive"] ?? body["violated-directive"])
        : body.effectiveDirective,
      60,
    ),
    blocked: urlWithoutQuery(get("blockedURL", "blocked-uri")),
    disposition: text(get("disposition", "disposition"), 10),
    sourceFile: urlWithoutQuery(get("sourceFile", "source-file")) || undefined,
    line: typeof line === "number" && Number.isFinite(line) ? line : undefined,
    sample: text(get("sample", "script-sample"), 60) || undefined,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** The violations in a parsed report body (either format); [] for anything else. */
export function parseCspReports(payload: unknown): CspViolation[] {
  if (isRecord(payload) && isRecord(payload["csp-report"])) {
    return [fromBody(payload["csp-report"], true)];
  }
  if (Array.isArray(payload)) {
    return payload
      .filter(
        (report): report is { type: string; body: Record<string, unknown> } =>
          isRecord(report) && report.type === "csp-violation" && isRecord(report.body),
      )
      .slice(0, MAX_REPORTS_PER_REQUEST)
      .map((report) => fromBody(report.body, false));
  }
  return [];
}

/** One log line for a violation. */
export function formatCspViolation(v: CspViolation): string {
  const where = v.sourceFile ? ` at ${v.sourceFile}${v.line ? `:${v.line}` : ""}` : "";
  const sample = v.sample ? ` sample=${JSON.stringify(v.sample)}` : "";
  return `[csp] ${v.disposition || "?"} ${v.directive || "?"} blocked=${v.blocked || "?"} on ${v.document || "?"}${where}${sample}`;
}

/** The window the log budget below is counted over. */
export const CSP_LOG_WINDOW_MS = 60_000;
/** Distinct violations logged in full at the start of each window... */
export const CSP_LOG_FULL_PER_WINDOW = 20;
/** ...then one in this many... */
export const CSP_LOG_SAMPLE_EVERY = 10;
/** ...up to this many lines per window in all. */
export const CSP_LOG_MAX_PER_WINDOW = 50;

/**
 * A per-isolate log budget, so the report endpoint (public, unauthenticated, and with no
 * rate-limit binding on this worker) can't be used to flood the worker's logs:
 * - a line identical to one already logged in this window is skipped;
 * - the first {@link CSP_LOG_FULL_PER_WINDOW} distinct lines are logged, then one in
 *   {@link CSP_LOG_SAMPLE_EVERY}, up to {@link CSP_LOG_MAX_PER_WINDOW};
 * - the first line of a new window is preceded by a count of what the last one skipped.
 * Workers run many isolates, so the bound is per isolate, not global.
 */
export function createCspLogBudget(now: () => number = Date.now) {
  let windowStart = Number.NEGATIVE_INFINITY;
  let distinct = 0;
  let skipped = 0;
  const logged = new Set<string>();

  return {
    /** The lines to log for this violation line: none, the line, or a summary and the line. */
    take(line: string): string[] {
      const out: string[] = [];
      const at = now();
      if (at - windowStart >= CSP_LOG_WINDOW_MS) {
        if (skipped > 0) {
          out.push(`[csp] ${skipped} more reports were not logged in the previous minute`);
        }
        windowStart = at;
        distinct = 0;
        skipped = 0;
        logged.clear();
      }
      if (logged.has(line)) {
        skipped += 1;
        return out;
      }
      distinct += 1;
      const sampled =
        distinct <= CSP_LOG_FULL_PER_WINDOW ||
        (distinct - CSP_LOG_FULL_PER_WINDOW) % CSP_LOG_SAMPLE_EVERY === 0;
      if (!sampled || logged.size >= CSP_LOG_MAX_PER_WINDOW) {
        skipped += 1;
        return out;
      }
      logged.add(line);
      out.push(line);
      return out;
    },
  };
}
