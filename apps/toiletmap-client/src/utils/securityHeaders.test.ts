import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  applySecurityHeaders,
  baseSecurityHeaders,
  CMS_CSP_ENFORCED,
  CSP_HEADER,
  CSP_REPORT_ONLY_HEADER,
  cmsContentSecurityPolicy,
  contentSecurityPolicyFor,
  crossOriginOpenerPolicy,
  HSTS_VALUE,
  inlineScriptHashes,
  inlineScripts,
  isProduction,
  PERMISSIONS_POLICY,
  SITE_CSP_ENFORCED,
  SVELTIA_CMS_VERSION,
  scriptHash,
  siteContentSecurityPolicy,
} from "./securityHeaders";

const nodeHash = (text: string) =>
  `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

/** A policy as { directive: [sources] }. */
const directives = (policy: string) =>
  Object.fromEntries(
    policy
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...sources]) => [name, sources]),
  );

const SITE_CSP_NAME = SITE_CSP_ENFORCED ? CSP_HEADER : CSP_REPORT_ONLY_HEADER;
const CMS_CSP_NAME = CMS_CSP_ENFORCED ? CSP_HEADER : CSP_REPORT_ONLY_HEADER;

describe("baseSecurityHeaders per environment", () => {
  it.each([
    ["production over HTTPS", true, true, HSTS_VALUE],
    ["production over HTTP (astro dev, a local preview)", true, false, undefined],
    ["preview", false, true, undefined],
    ["development", false, false, undefined],
  ])("%s", (_label, production, https, hsts) => {
    const headers = baseSecurityHeaders({ pathname: "/", production, https });
    expect(headers["Strict-Transport-Security"]).toBe(hsts);
    expect(headers).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Permissions-Policy": PERMISSIONS_POLICY,
    });
  });

  it("sends HSTS for two years with subdomains, and never preload", () => {
    expect(HSTS_VALUE).toBe("max-age=63072000; includeSubDomains");
    expect(HSTS_VALUE).not.toMatch(/preload/);
  });

  it("only production (and never astro dev) counts as production", () => {
    expect(isProduction("production", false)).toBe(true);
    expect(isProduction(" Production ", false)).toBe(true);
    expect(isProduction("production", true)).toBe(false);
    expect(isProduction("preview", false)).toBe(false);
    expect(isProduction("development", false)).toBe(false);
    expect(isProduction(undefined, false)).toBe(false);
  });

  it("allows geolocation for this origin only, and turns the rest off", () => {
    const features = Object.fromEntries(
      PERMISSIONS_POLICY.split(", ").map((entry) => entry.split("=") as [string, string]),
    );
    expect(features.geolocation).toBe("(self)");
    // Chromium doesn't recognise web-share and logs a warning on every page for it.
    expect(features["web-share"]).toBeUndefined();
    for (const [name, allow] of Object.entries(features)) {
      if (name === "geolocation") continue;
      expect(allow, name).toBe("()");
    }
    expect(Object.keys(features)).toEqual(
      expect.arrayContaining(["camera", "microphone", "payment", "usb", "browsing-topics"]),
    );
  });

  it("keeps window.opener for the CMS's GitHub sign-in popup", () => {
    expect(crossOriginOpenerPolicy("/")).toBe("same-origin");
    expect(crossOriginOpenerPolicy("/loos/abc")).toBe("same-origin");
    expect(crossOriginOpenerPolicy("/cms")).toBe("same-origin-allow-popups");
    expect(crossOriginOpenerPolicy("/cms/index.html")).toBe("same-origin-allow-popups");
    expect(crossOriginOpenerPolicy("/api/cms-oauth/callback")).toBeNull();
    expect(crossOriginOpenerPolicy("/cmsx")).toBe("same-origin");
    const popup = baseSecurityHeaders({
      pathname: "/api/cms-oauth/auth",
      production: true,
      https: true,
    });
    expect(popup["Cross-Origin-Opener-Policy"]).toBeUndefined();
  });
});

describe("siteContentSecurityPolicy", () => {
  it("allows only this origin's scripts plus the given hashes: no unsafe-inline or eval", () => {
    const policy = directives(
      siteContentSecurityPolicy({ scriptHashes: ["'sha256-b'", "'sha256-a'", "'sha256-a'"] }),
    );
    expect(policy["script-src"]).toEqual(["'self'", "'sha256-a'", "'sha256-b'"]);
    expect(policy["script-src"]).not.toContain("'unsafe-inline'");
    expect(policy["script-src"]).not.toContain("'unsafe-eval'");
  });

  it("covers Leaflet, OSM tiles, Google Fonts, the same-origin API and framing", () => {
    const policy = directives(siteContentSecurityPolicy());
    expect(policy["default-src"]).toEqual(["'self'"]);
    expect(policy["style-src"]).toEqual([
      "'self'",
      "'unsafe-inline'",
      "https://fonts.googleapis.com",
    ]);
    expect(policy["img-src"]).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://tile.openstreetmap.org",
      // Blog post images (src/contentImages.test.ts keeps content to these hosts).
      "https://avatars.githubusercontent.com",
      "https://upload.wikimedia.org",
    ]);
    expect(policy["font-src"]).toEqual(["'self'", "data:", "https://fonts.gstatic.com"]);
    expect(policy["connect-src"]).toEqual(["'self'"]);
    expect(policy["object-src"]).toEqual(["'none'"]);
    expect(policy["base-uri"]).toEqual(["'self'"]);
    expect(policy["form-action"]).toEqual(["'self'"]);
    expect(policy["frame-ancestors"]).toEqual(["'none'"]);
    expect(policy["report-uri"]).toEqual(["/api/csp-report"]);
    expect(policy["report-to"]).toEqual(["csp"]);
    expect(policy["upgrade-insecure-requests"]).toBeUndefined();
  });

  it("lets astro dev's hot reload connect, and nothing else changes", () => {
    const dev = directives(siteContentSecurityPolicy({ dev: true }));
    expect(dev["connect-src"]).toEqual(["'self'", "ws:", "wss:"]);
    expect({ ...dev, "connect-src": null }).toEqual({
      ...directives(siteContentSecurityPolicy()),
      "connect-src": null,
    });
  });

  it("upgrades insecure requests only when the site policy is enforced", () => {
    const [, value] = contentSecurityPolicyFor("/", { upgradeInsecureRequests: true });
    expect("upgrade-insecure-requests" in directives(value)).toBe(SITE_CSP_ENFORCED);
  });
});

describe("cmsContentSecurityPolicy", () => {
  it("lets Sveltia load from its pinned unpkg package (not all of unpkg) and talk to GitHub", () => {
    const policy = directives(cmsContentSecurityPolicy());
    expect(policy["script-src"]).toEqual([
      "'self'",
      `https://unpkg.com/@sveltia/cms@${SVELTIA_CMS_VERSION}/`,
    ]);
    expect(policy["script-src"]).not.toContain("https://unpkg.com");
    expect(policy["connect-src"]).toEqual(
      expect.arrayContaining([
        "'self'",
        "https://api.github.com",
        "https://raw.githubusercontent.com",
        "https://unpkg.com",
      ]),
    );
    expect(policy["img-src"]).toEqual(
      expect.arrayContaining(["https://*.githubusercontent.com", "blob:", "data:"]),
    );
    expect(policy["frame-ancestors"]).toEqual(["'none'"]);
    expect(policy["script-src"]).not.toContain("'unsafe-inline'");
  });

  it("is used for /cms and everything under it, and only there", () => {
    expect(contentSecurityPolicyFor("/cms", {})).toEqual([
      CMS_CSP_NAME,
      cmsContentSecurityPolicy(),
    ]);
    expect(contentSecurityPolicyFor("/cms/index.html", {})[1]).toBe(cmsContentSecurityPolicy());
    expect(contentSecurityPolicyFor("/cmsx", {})[0]).toBe(SITE_CSP_NAME);
    expect(contentSecurityPolicyFor("/about", {})[1]).toBe(siteContentSecurityPolicy());
  });
});

describe("inline script hashes", () => {
  const html = `<!doctype html><html><head>
<script>(function(){self.Astro=1})();</script>
<script type="module">import "/x.js";</script>
<script type="application/ld+json">{"@context":"https://schema.org"}</script>
<script defer data-api="/api/event" src="/js/p.js"></script>
<SCRIPT TYPE='text/javascript'>a()</SCRIPT >
<script type="importmap">{"imports":{}}</script>
<script type="text/template"><p>hi</p></script>
</head><body></body></html>`;

  it("finds the scripts a browser runs, skipping data blocks and external scripts", () => {
    expect(inlineScripts(html)).toEqual([
      "(function(){self.Astro=1})();",
      'import "/x.js";',
      "a()",
      '{"imports":{}}',
    ]);
  });

  it("hashes exactly as browsers do (SHA-256 of the text, CRLF read as LF)", async () => {
    expect(await scriptHash("alert(1)")).toBe(nodeHash("alert(1)"));
    expect(await scriptHash("a()\r\nb()\rc()")).toBe(nodeHash("a()\nb()\nc()"));
    expect(await scriptHash("é")).toBe(nodeHash("é"));
  });

  it("returns each distinct hash once, sorted", async () => {
    const hashes = await inlineScriptHashes(`${html}<script>a()</script>`);
    expect(hashes).toHaveLength(4);
    expect(hashes).toEqual([...hashes].sort());
    expect(hashes).toContain(nodeHash("a()"));
  });
});

describe("applySecurityHeaders", () => {
  const url = new URL("https://www.toiletmap.org.uk/loos/abc");
  const apply = (
    response: Response,
    options: Partial<Parameters<typeof applySecurityHeaders>[1]> = {},
  ) =>
    applySecurityHeaders(response, {
      url,
      scriptHashes: [nodeHash("boot()")],
      environment: "production",
      dev: false,
      ...options,
    });

  it("adds the headers and a CSP allowing the given (known) script hashes", async () => {
    const page = "<html><head><script>boot()</script></head><body>hi</body></html>";
    const res = apply(
      new Response(page, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": String(page.length),
          "X-Custom": "1",
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(page);
    expect(res.headers.get("Content-Length")).toBe(String(page.length));
    expect(res.headers.get("X-Custom")).toBe("1");
    expect(res.headers.get("Strict-Transport-Security")).toBe(HSTS_VALUE);
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    const csp = res.headers.get(SITE_CSP_NAME) ?? "";
    expect(directives(csp)["script-src"]).toEqual(["'self'", nodeHash("boot()")]);
    expect(res.headers.get(SITE_CSP_ENFORCED ? CSP_REPORT_ONLY_HEADER : CSP_HEADER)).toBeNull();
    expect(res.headers.get("Reporting-Endpoints")).toBe('csp="/api/csp-report"');
  });

  it("never allows a script just because the response contains it (injected markup)", () => {
    const injected = "alert(document.cookie)";
    const res = apply(
      new Response(`<html><body><h1>Loo</h1><script>${injected}</script></body></html>`, {
        headers: { "Content-Type": "text/html" },
      }),
    );
    const scriptSrc = directives(res.headers.get(SITE_CSP_NAME) ?? "")["script-src"];
    expect(scriptSrc).toEqual(["'self'", nodeHash("boot()")]);
    expect(scriptSrc).not.toContain(nodeHash(injected));
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("leaves out HSTS outside production and over plain HTTP", () => {
    const preview = apply(new Response("x"), { environment: "preview" });
    expect(preview.headers.get("Strict-Transport-Security")).toBeNull();
    const dev = apply(new Response("x"), { dev: true });
    expect(dev.headers.get("Strict-Transport-Security")).toBeNull();
    expect(directives(dev.headers.get(SITE_CSP_NAME) ?? "")["connect-src"]).toContain("ws:");
    const http = apply(new Response("x"), { url: new URL("http://localhost:4321/") });
    expect(http.headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("keeps a route's own CSP and other headers it set (the CMS sign-in popup)", () => {
    const own = "default-src 'none'; script-src 'nonce-abc'";
    const res = apply(
      new Response("<script nonce=abc>x()</script>", {
        headers: {
          "Content-Type": "text/html",
          [CSP_HEADER]: own,
          "Referrer-Policy": "no-referrer",
        },
      }),
      { url: new URL("https://www.toiletmap.org.uk/api/cms-oauth/callback") },
    );
    expect(res.headers.get(CSP_HEADER)).toBe(own);
    expect(res.headers.get(CSP_REPORT_ONLY_HEADER)).toBeNull();
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBeNull();
  });

  it("passes non-HTML bodies (API JSON, downloads) through untouched", async () => {
    const body = JSON.stringify({ data: [1, 2, 3] });
    const res = apply(
      new Response(body, { status: 201, headers: { "Content-Type": "application/json" } }),
    );
    expect(res.status).toBe(201);
    expect(await res.text()).toBe(body);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(directives(res.headers.get(SITE_CSP_NAME) ?? "")["script-src"]).toEqual([
      "'self'",
      nodeHash("boot()"),
    ]);
  });

  it("keeps redirects and body-less responses as they are", () => {
    const res = apply(new Response(null, { status: 301, headers: { Location: "/" } }));
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("works on responses with immutable headers (fetched from upstream)", () => {
    const upstream = Response.redirect("https://www.toiletmap.org.uk/", 302);
    const res = apply(upstream);
    expect(res.status).toBe(302);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("gives /cms its own policy", () => {
    const res = apply(new Response("<html></html>", { headers: { "Content-Type": "text/html" } }), {
      url: new URL("https://www.toiletmap.org.uk/cms/"),
    });
    expect(res.headers.get(CMS_CSP_NAME)).toBe(cmsContentSecurityPolicy());
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin-allow-popups");
  });
});
