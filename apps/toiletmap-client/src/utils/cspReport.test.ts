import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL, POST } from "../pages/api/csp-report";
import { formatCspViolation, MAX_REPORTS_PER_REQUEST, parseCspReports } from "./cspReport";

describe("parseCspReports", () => {
  it("reads report-uri reports (Firefox, Safari), dropping query strings", () => {
    const [v] = parseCspReports({
      "csp-report": {
        "document-uri": "https://www.toiletmap.org.uk/loos/abc?token=secret",
        "violated-directive": "script-src-elem",
        "effective-directive": "script-src-elem",
        "blocked-uri": "https://evil.example/x.js?y=1",
        disposition: "report",
        "source-file": "https://www.toiletmap.org.uk/_astro/a.js",
        "line-number": 12,
        "script-sample": "alert(1)",
      },
    });
    expect(v).toEqual({
      document: "https://www.toiletmap.org.uk/loos/abc",
      directive: "script-src-elem",
      blocked: "https://evil.example/x.js",
      disposition: "report",
      sourceFile: "https://www.toiletmap.org.uk/_astro/a.js",
      line: 12,
      sample: "alert(1)",
    });
  });

  it("reads Reporting API reports (Chromium) and ignores other report types", () => {
    const reports = parseCspReports([
      {
        type: "csp-violation",
        url: "https://www.toiletmap.org.uk/",
        body: {
          documentURL: "https://www.toiletmap.org.uk/",
          effectiveDirective: "img-src",
          blockedURL: "https://a.tile.openstreetmap.org/1/2/3.png",
          disposition: "enforce",
        },
      },
      { type: "deprecation", body: { id: "x" } },
    ]);
    expect(reports).toEqual([
      {
        document: "https://www.toiletmap.org.uk/",
        directive: "img-src",
        blocked: "https://a.tile.openstreetmap.org/1/2/3.png",
        disposition: "enforce",
        sourceFile: undefined,
        line: undefined,
        sample: undefined,
      },
    ]);
  });

  it("keeps keywords like inline and eval, and caps the number of reports", () => {
    expect(parseCspReports({ "csp-report": { "blocked-uri": "inline" } })[0]?.blocked).toBe(
      "inline",
    );
    const many = Array.from({ length: 50 }, () => ({ type: "csp-violation", body: {} }));
    expect(parseCspReports(many)).toHaveLength(MAX_REPORTS_PER_REQUEST);
  });

  it("returns nothing for anything else", () => {
    expect(parseCspReports(null)).toEqual([]);
    expect(parseCspReports("x")).toEqual([]);
    expect(parseCspReports({ other: 1 })).toEqual([]);
  });

  it("formats one log line without control characters", () => {
    const line = formatCspViolation({
      document: "https://x/",
      directive: "script-src",
      blocked: "inline",
      disposition: "report",
      sample: "a\nb",
    });
    expect(line).toBe('[csp] report script-src blocked=inline on https://x/ sample="a\\nb"');
  });
});

describe("POST /api/csp-report", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A minimal stand-in for Astro's APIContext: the route only reads `request`. */
  const post = (body: string, headers: Record<string, string> = {}) =>
    POST({
      request: new Request("https://x/api/csp-report", { method: "POST", body, headers }),
    } as unknown as APIContext) as Promise<Response>;

  it("logs each violation and answers 204", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await post(
      JSON.stringify({
        "csp-report": { "blocked-uri": "inline", "violated-directive": "script-src" },
      }),
      {
        "Content-Type": "application/csp-report",
      },
    );
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/^\[csp\] .*blocked=inline/);
  });

  it("ignores junk and oversized bodies without logging", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await post("not json")).status).toBe(204);
    expect((await post("x".repeat(20_000))).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });

  it("only accepts POST", async () => {
    const res = (await ALL({} as unknown as APIContext)) as Response;
    expect(res.status).toBe(405);
  });
});
