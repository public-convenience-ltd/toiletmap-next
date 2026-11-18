// @vitest-environment node
import { describe, expect, it } from "vitest";
import { robotsTxt } from "./robots";

const SITE = "https://www.toiletmap.org.uk";

describe("robotsTxt", () => {
  it("in production, keeps crawlers out of the CMS, auth, API, dev pages and forms", () => {
    const text = robotsTxt({ environment: "production", site: SITE });
    const lines = text.split("\n");
    expect(lines[0]).toBe("User-agent: *");
    for (const path of [
      "/cms",
      "/auth",
      "/api",
      "/dev",
      "/loos/add",
      "/loos/*/edit",
      "/loos/*/remove",
    ]) {
      expect(lines, path).toContain(`Disallow: ${path}`);
    }
    // Toilet pages themselves stay crawlable.
    expect(lines).not.toContain("Disallow: /loos");
    expect(lines).not.toContain("Disallow: /");
    expect(lines).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });

  it("treats an unset ENVIRONMENT as production", () => {
    expect(robotsTxt({ environment: undefined, site: SITE })).toContain("Sitemap:");
  });

  it("turns every crawler away from preview and development deployments", () => {
    for (const environment of ["preview", "development", "local"]) {
      const text = robotsTxt({ environment, site: SITE });
      expect(text.split("\n"), environment).toContain("Disallow: /");
      expect(text, environment).not.toContain("Sitemap:");
    }
  });
});
