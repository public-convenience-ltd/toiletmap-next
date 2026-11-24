import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL, POST } from "../pages/api/csp-report";
import {
  CSP_LOG_FULL_PER_WINDOW,
  CSP_LOG_MAX_PER_WINDOW,
  CSP_LOG_SAMPLE_EVERY,
  CSP_LOG_WINDOW_MS,
  createCspLogBudget,
  formatCspViolation,
  MAX_CSP_REPORT_BYTES,
  MAX_REPORTS_PER_REQUEST,
  parseCspReports,
} from "./cspReport";

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

describe("createCspLogBudget", () => {
  it("logs a repeated line once per window", () => {
    let clock = 0;
    const budget = createCspLogBudget(() => clock);
    expect(budget.take("a")).toEqual(["a"]);
    expect(budget.take("a")).toEqual([]);
    expect(budget.take("b")).toEqual(["b"]);
    clock += CSP_LOG_WINDOW_MS;
    expect(budget.take("a")).toEqual([
      "[csp] 1 more reports were not logged in the previous minute",
      "a",
    ]);
  });

  it("logs the first lines in full, then samples, then stops at the cap", () => {
    let clock = 0;
    const budget = createCspLogBudget(() => clock);
    const logged = Array.from({ length: 2_000 }, (_, n) => budget.take(`line ${n}`)).flat();
    expect(logged.slice(0, CSP_LOG_FULL_PER_WINDOW)).toEqual(
      Array.from({ length: CSP_LOG_FULL_PER_WINDOW }, (_, n) => `line ${n}`),
    );
    expect(logged[CSP_LOG_FULL_PER_WINDOW]).toBe(
      `line ${CSP_LOG_FULL_PER_WINDOW + CSP_LOG_SAMPLE_EVERY - 1}`,
    );
    expect(logged).toHaveLength(CSP_LOG_MAX_PER_WINDOW);

    clock += CSP_LOG_WINDOW_MS;
    expect(budget.take("next")).toEqual([
      `[csp] ${2_000 - CSP_LOG_MAX_PER_WINDOW} more reports were not logged in the previous minute`,
      "next",
    ]);
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

  it("logs a flood of identical reports once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = JSON.stringify({
      "csp-report": {
        "blocked-uri": "https://flood.example/x.js",
        "violated-directive": "script-src",
      },
    });
    for (let n = 0; n < 50; n += 1) expect((await post(body)).status).toBe(204);
    expect(warn.mock.calls.filter(([line]) => String(line).includes("flood.example"))).toHaveLength(
      1,
    );
  });

  it("stops reading a chunked body without Content-Length once it passes the cap", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let pulled = 0;
    let cancelled = false;
    const chunk = new Uint8Array(4 * 1024).fill(32);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 1_000) controller.close();
        else controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("https://x/api/csp-report", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    const res = (await POST({ request } as unknown as APIContext)) as Response;
    expect(res.status).toBe(204);
    expect(cancelled).toBe(true);
    expect(pulled * chunk.byteLength).toBeLessThan(MAX_CSP_REPORT_BYTES * 2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("only accepts POST", async () => {
    const res = (await ALL({} as unknown as APIContext)) as Response;
    expect(res.status).toBe(405);
  });
});
