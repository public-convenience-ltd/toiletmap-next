import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { unknownInlineScripts } from "../integrations/securityHeaders";
import {
  CMS_CSP_ENFORCED,
  CSP_HEADER,
  CSP_REPORT_ONLY_HEADER,
  cmsContentSecurityPolicy,
  HSTS_VALUE,
  SITE_CSP_ENFORCED,
  scriptHash,
} from "./securityHeaders";
import {
  GENERATED_MARKER,
  MAX_HEADERS_LINE_LENGTH,
  withStaticSecurityHeaders,
} from "./staticSecurityHeaders";

const PUBLIC_HEADERS = `# comment
/images/*
  X-Example: 1
`;

type Rule = { set: [string, string][]; unset: string[] };

/**
 * `_headers` as Cloudflare reads it (workers-shared parseHeaders + constructHeaders): rules
 * keyed by path, so a repeated path replaces the earlier rule (in the earlier one's place);
 * `! Name` (with the space) unsets.
 */
function parseRules(content: string): [string, Rule][] {
  const rules = new Map<string, Rule>();
  let current: Rule | undefined;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("/")) {
      current = { set: [], unset: [] };
      rules.set(line, current);
      continue;
    }
    if (!current) throw new Error("header before any rule");
    if (!line.includes(":")) {
      if (!line.startsWith("! ")) throw new Error(`invalid line: ${line}`);
      current.unset.push(line.slice(2).toLowerCase());
      continue;
    }
    const colon = line.indexOf(":");
    current.set.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return [...rules];
}

/** The response headers for `path`, applying the rules the way the asset worker does. */
function headersFor(content: string, path: string): Headers {
  const headers = new Headers();
  const seen = new Set<string>();
  for (const [pattern, rule] of parseRules(content)) {
    const regex = new RegExp(
      `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace("*", ".*")}$`,
    );
    if (!regex.test(path)) continue;
    for (const name of rule.unset) headers.delete(name);
    for (const [name, value] of rule.set) {
      if (seen.has(name.toLowerCase())) headers.append(name, value);
      else {
        headers.set(name, value);
        seen.add(name.toLowerCase());
      }
    }
  }
  return headers;
}

const SITE_CSP_NAME = SITE_CSP_ENFORCED ? CSP_HEADER : CSP_REPORT_ONLY_HEADER;
const CMS_CSP_NAME = CMS_CSP_ENFORCED ? CSP_HEADER : CSP_REPORT_ONLY_HEADER;

describe("withStaticSecurityHeaders", () => {
  const generate = (production: boolean) =>
    withStaticSecurityHeaders(PUBLIC_HEADERS, { production, scriptHashes: ["'sha256-abc'"] });

  it("gives prerendered pages the site headers, with the build's script hashes", () => {
    const headers = headersFor(generate(true), "/about");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(headers.get("Permissions-Policy")).toContain("geolocation=(self)");
    expect(headers.get(SITE_CSP_NAME)).toContain("script-src 'self' 'sha256-abc'");
    expect(headers.get("Strict-Transport-Security")).toBe(HSTS_VALUE);
  });

  it("adds HSTS to production builds only", () => {
    expect(headersFor(generate(false), "/about").get("Strict-Transport-Security")).toBeNull();
    expect(headersFor(generate(true), "/posts/x").get("Strict-Transport-Security")).toBe(
      HSTS_VALUE,
    );
  });

  it("replaces (not merges) the CSP, COOP and Referrer-Policy for /cms", () => {
    for (const path of ["/cms", "/cms/", "/cms/index.html", "/cms/config.yml"]) {
      const headers = headersFor(generate(true), path);
      expect(headers.get(CMS_CSP_NAME), path).toBe(cmsContentSecurityPolicy());
      if (CMS_CSP_NAME !== SITE_CSP_NAME) expect(headers.get(SITE_CSP_NAME)).toBeNull();
      expect(headers.get("Cross-Origin-Opener-Policy"), path).toBe("same-origin-allow-popups");
      expect(headers.get("X-Frame-Options"), path).toBe("DENY");
    }
    const cms = headersFor(generate(true), "/cms/");
    expect(cms.get("Referrer-Policy")).toBe("same-origin");
    expect(cms.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(headersFor(generate(true), "/about").get("X-Robots-Tag")).toBeNull();
  });

  it("keeps public/_headers' own rules", () => {
    expect(headersFor(generate(true), "/images/a.png").get("X-Example")).toBe("1");
    expect(headersFor(generate(true), "/images/a.png").get("X-Frame-Options")).toBe("DENY");
  });

  it.each(["/*", "/cms", "/cms/*"])(
    "refuses a public/_headers rule for %s (a second rule for a path replaces the first)",
    (path) => {
      expect(() =>
        withStaticSecurityHeaders(`${path}\n  X-Thing: 1\n`, {
          production: true,
          scriptHashes: [],
        }),
      ).toThrow(/owns|own/);
    },
  );

  it("works with the real public/_headers", async () => {
    const { readFile } = await import("node:fs/promises");
    const real = await readFile(join(import.meta.dirname, "../../public/_headers"), "utf8");
    const headers = headersFor(
      withStaticSecurityHeaders(real, { production: true, scriptHashes: [] }),
      "/cms/",
    );
    expect(headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("is idempotent and keeps every line within Cloudflare's limit", () => {
    const once = generate(true);
    expect(once.startsWith(GENERATED_MARKER)).toBe(true);
    expect(withStaticSecurityHeaders(once, { production: true, scriptHashes: [] })).toBe(once);
    for (const line of once.split("\n"))
      expect(line.length).toBeLessThanOrEqual(MAX_HEADERS_LINE_LENGTH);
  });

  it("refuses a policy too long for Cloudflare rather than shipping it silently dropped", () => {
    const scriptHashes = Array.from({ length: 60 }, (_, i) => `'sha256-${"x".repeat(43)}${i}'`);
    expect(() => withStaticSecurityHeaders("", { production: true, scriptHashes })).toThrow(
      /limit/,
    );
  });
});

describe("unknownInlineScripts (the build's check)", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("lists every inline script in a built HTML file that isn't an allowed one", async () => {
    dir = await mkdtemp(join(tmpdir(), "csp-"));
    await mkdir(join(dir, "posts"), { recursive: true });
    await writeFile(join(dir, "about.html"), "<script>a()</script><script src=/x.js></script>");
    await writeFile(
      join(dir, "posts", "one.html"),
      '<script>a()</script><script>\n  alert(document.cookie)\n</script><script type="application/ld+json">{}</script>',
    );
    await writeFile(join(dir, "app.js"), "<script>not html</script>");
    expect(await unknownInlineScripts(dir, [await scriptHash("a()")])).toEqual([
      { file: join("posts", "one.html"), excerpt: "alert(document.cookie)" },
    ]);
    expect(await unknownInlineScripts(dir, [])).toHaveLength(3);
  });
});
