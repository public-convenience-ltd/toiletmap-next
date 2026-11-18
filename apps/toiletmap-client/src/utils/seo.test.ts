// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  DEFAULT_SITE_URL,
  isIndexableEnvironment,
  pageTitle,
  robotsContent,
  serializeJsonLd,
  siteJsonLd,
  siteOrigin,
  truncate,
} from "./seo";

describe("pageTitle", () => {
  it("appends the site name, or is just the site name", () => {
    expect(pageTitle("About")).toBe("About – Toilet Map");
    expect(pageTitle("  ")).toBe("Toilet Map");
    expect(pageTitle()).toBe("Toilet Map");
  });
});

describe("isIndexableEnvironment / robotsContent", () => {
  it("keeps preview, development and local deployments out of search", () => {
    for (const env of ["preview", "development", "local", " Preview "]) {
      expect(isIndexableEnvironment(env), env).toBe(false);
      expect(robotsContent({ environment: env }), env).toBe("noindex, nofollow");
    }
  });

  it("treats production, and an unset or unknown ENVIRONMENT, as indexable", () => {
    for (const env of ["production", undefined, null, "", "staging"]) {
      expect(isIndexableEnvironment(env), String(env)).toBe(true);
    }
    expect(robotsContent({ environment: "production" })).toBeNull();
  });

  it("honours a page's noindex and nofollow in production", () => {
    expect(robotsContent({ environment: "production", noindex: true })).toBe("noindex, follow");
    expect(robotsContent({ environment: "production", noindex: true, nofollow: true })).toBe(
      "noindex, nofollow",
    );
    expect(robotsContent({ environment: "production", nofollow: true })).toBe("index, nofollow");
  });

  it("is noindex, nofollow on preview even for a page that only asks for noindex", () => {
    expect(robotsContent({ environment: "preview", noindex: true })).toBe("noindex, nofollow");
  });
});

describe("absoluteUrl", () => {
  it("resolves paths against the site's origin", () => {
    expect(absoluteUrl("/about", "https://www.toiletmap.org.uk")).toBe(
      "https://www.toiletmap.org.uk/about",
    );
    expect(absoluteUrl("/", new URL("https://example.test/ignored/path"))).toBe(
      "https://example.test/",
    );
  });

  it("falls back to the production site", () => {
    expect(siteOrigin(undefined)).toBe(DEFAULT_SITE_URL);
    expect(absoluteUrl("/loos/abc", null)).toBe(`${DEFAULT_SITE_URL}/loos/abc`);
  });

  it("keeps absolute URLs", () => {
    expect(absoluteUrl("https://cdn.example/img.png", DEFAULT_SITE_URL)).toBe(
      "https://cdn.example/img.png",
    );
  });
});

describe("serializeJsonLd", () => {
  it("can never close the script element it sits in", () => {
    const json = serializeJsonLd({ name: "</script><script>alert(1)</script> & co" });
    expect(json).not.toContain("<");
    expect(json).not.toContain(">");
    expect(json).not.toContain("&");
    // Still the same data once parsed.
    expect(JSON.parse(json)).toEqual({ name: "</script><script>alert(1)</script> & co" });
  });

  it("escapes the JavaScript line separators", () => {
    const json = serializeJsonLd({ name: "a\u2028b\u2029c" });
    expect(json).toContain("\\u2028");
    expect(json).toContain("\\u2029");
    expect(JSON.parse(json).name).toBe("a\u2028b\u2029c");
  });
});

describe("siteJsonLd", () => {
  it("describes the WebSite and its publishing Organization, linked by @id", () => {
    const data = siteJsonLd("https://www.toiletmap.org.uk");
    expect(data["@context"]).toBe("https://schema.org");
    const [website, organization] = data["@graph"] as Record<string, unknown>[];
    expect(website).toMatchObject({
      "@type": "WebSite",
      url: "https://www.toiletmap.org.uk/",
      name: "Toilet Map",
      publisher: { "@id": "https://www.toiletmap.org.uk/#organization" },
    });
    expect(organization).toMatchObject({
      "@type": "Organization",
      "@id": "https://www.toiletmap.org.uk/#organization",
      name: "Toilet Map",
      logo: "https://www.toiletmap.org.uk/apple-touch-icon.png",
    });
  });
});

describe("truncate", () => {
  it("leaves short text alone and collapses whitespace", () => {
    expect(truncate("  a   b  ", 10)).toBe("a b");
  });

  it("cuts long text at a word with an ellipsis", () => {
    const out = truncate("one two three four five six seven", 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out).toBe("one two three four…");
  });
});
