import type { APIRoute } from "astro";
import { readBodyWithLimit } from "../../utils/api";
import {
  createCspLogBudget,
  formatCspViolation,
  MAX_CSP_REPORT_BYTES,
  parseCspReports,
} from "../../utils/cspReport";

/**
 * `POST /api/csp-report`: where browsers send Content Security Policy violation reports
 * (`report-uri` / `report-to` in src/utils/securityHeaders.ts). Each one becomes a single
 * line in the worker's logs (observability is on in wrangler.jsonc); nothing is stored.
 * Always 204, so a report can't tell the sender anything. A static route, so it outranks
 * the API proxy (src/pages/api/[...path].ts).
 *
 * Bounded so it can't be used as a log sink: bodies over MAX_CSP_REPORT_BYTES are dropped
 * while being read, at most MAX_REPORTS_PER_REQUEST reports are read from one body, and
 * the lines go through a per-isolate log budget (duplicates skipped, sampled after the
 * first few, capped per minute; see createCspLogBudget). This worker has no rate-limit
 * binding, so the budget is the limiter.
 */
export const prerender = false;

const NO_CONTENT = () =>
  new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

const budget = createCspLogBudget();

export const POST: APIRoute = async ({ request }) => {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > MAX_CSP_REPORT_BYTES) return NO_CONTENT();
  let raw: string;
  try {
    // Content-Length may be missing (chunked) or wrong: count while reading.
    const body = await readBodyWithLimit(request, MAX_CSP_REPORT_BYTES);
    if (!body) return NO_CONTENT();
    raw = new TextDecoder().decode(body);
  } catch {
    return NO_CONTENT();
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NO_CONTENT();
  }
  for (const violation of parseCspReports(payload)) {
    for (const line of budget.take(formatCspViolation(violation))) console.warn(line);
  }
  return NO_CONTENT();
};

export const ALL: APIRoute = () =>
  new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
