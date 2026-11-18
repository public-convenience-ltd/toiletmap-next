import type { APIRoute } from "astro";
import { formatCspViolation, MAX_CSP_REPORT_BYTES, parseCspReports } from "../../utils/cspReport";

/**
 * `POST /api/csp-report`: where browsers send Content Security Policy violation reports
 * (`report-uri` / `report-to` in src/utils/securityHeaders.ts). Each one becomes a single
 * line in the worker's logs (observability is on in wrangler.jsonc); nothing is stored.
 * Always 204, so a report can't tell the sender anything. A static route, so it outranks
 * the API proxy (src/pages/api/[...path].ts).
 */
export const prerender = false;

const NO_CONTENT = () =>
  new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export const POST: APIRoute = async ({ request }) => {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > MAX_CSP_REPORT_BYTES) return NO_CONTENT();
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NO_CONTENT();
  }
  if (raw.length > MAX_CSP_REPORT_BYTES) return NO_CONTENT();
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NO_CONTENT();
  }
  for (const violation of parseCspReports(payload)) {
    console.warn(formatCspViolation(violation));
  }
  return NO_CONTENT();
};

export const ALL: APIRoute = () =>
  new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
