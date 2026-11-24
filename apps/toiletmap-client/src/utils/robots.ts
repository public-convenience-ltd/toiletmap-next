/**
 * /robots.txt. Production lets crawlers in except for the CMS, sign-in, the API proxy,
 * developer pages and the contribution forms, and points at the sitemap. Preview and
 * development deployments (the worker's ENVIRONMENT) turn every crawler away; their pages
 * also carry a noindex robots meta tag (BaseLayout). For prerendered pages that tag is decided
 * at build time, which is why previews are built with `build:preview` (deploy-preview.yml).
 */
import { absoluteUrl, isIndexableEnvironment } from "./seo";

/** Paths crawlers should not fetch (robots.txt patterns: `*` matches any run of characters). */
export const DISALLOWED_PATHS = [
  "/cms",
  "/auth",
  "/api",
  "/dev",
  "/loos/add",
  "/loos/*/edit",
  "/loos/*/remove",
] as const;

export const ROBOTS_CACHE_CONTROL = "public, max-age=3600";

export function robotsTxt({
  environment,
  site,
}: {
  environment: string | null | undefined;
  site: URL | string | undefined | null;
}): string {
  if (!isIndexableEnvironment(environment)) {
    return [
      "# Not the production site: not for search engines.",
      "User-agent: *",
      "Disallow: /",
      "",
    ].join("\n");
  }
  return [
    "User-agent: *",
    ...DISALLOWED_PATHS.map((path) => `Disallow: ${path}`),
    "",
    `Sitemap: ${absoluteUrl("/sitemap.xml", site)}`,
    "",
  ].join("\n");
}
