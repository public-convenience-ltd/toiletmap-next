/**
 * Page metadata helpers shared by BaseLayout, the SEO endpoints (sitemap, robots, RSS) and
 * pages that build their own titles. Pure functions, safe in the worker and in tests.
 */

/** The production origin. astro.config's `site` defaults to it (override with SITE_URL). */
export const DEFAULT_SITE_URL = "https://www.toiletmap.org.uk";

export const SITE_NAME = "Toilet Map";

/** Used when a page passes no description of its own. */
export const DEFAULT_DESCRIPTION =
  "Find public toilets near you across the UK, with opening hours, accessibility, baby changing and more. The Toilet Map is free, open data, kept up to date by people like you.";

/** "About" → "About – Toilet Map"; nothing → "Toilet Map". */
export function pageTitle(part?: string | null): string {
  const trimmed = part?.trim();
  return trimmed ? `${trimmed} – ${SITE_NAME}` : SITE_NAME;
}

/**
 * Whether a deployment may be indexed by search engines. Only `development`, `preview` and
 * `local` (the worker's ENVIRONMENT var) are kept out; anything else, including an unset
 * var, counts as production, so a missing var can never de-index the live site.
 */
export function isIndexableEnvironment(environment: string | null | undefined): boolean {
  const env = (environment ?? "").trim().toLowerCase();
  return !(env === "development" || env === "preview" || env === "local");
}

export interface RobotsOptions {
  noindex?: boolean;
  nofollow?: boolean;
  /** The worker's ENVIRONMENT var: non-production deployments are never indexed. */
  environment?: string | null;
}

/**
 * The content of `<meta name="robots">`, or null to leave the tag out (index, follow).
 * Preview and development deployments are always "noindex, nofollow".
 */
export function robotsContent({ noindex, nofollow, environment }: RobotsOptions): string | null {
  if (!isIndexableEnvironment(environment)) return "noindex, nofollow";
  if (!noindex && !nofollow) return null;
  return [noindex ? "noindex" : "index", nofollow ? "nofollow" : "follow"].join(", ");
}

/** The site origin without a trailing slash, e.g. "https://www.toiletmap.org.uk". */
export function siteOrigin(site: URL | string | undefined | null): string {
  const value = site ? new URL(String(site)) : new URL(DEFAULT_SITE_URL);
  return value.origin;
}

/**
 * An absolute URL on the site for a path ("/about") or an absolute URL (returned as is,
 * normalised). Query strings and fragments are kept; pass a bare path for canonicals.
 */
export function absoluteUrl(pathOrUrl: string, site: URL | string | undefined | null): string {
  return new URL(pathOrUrl, `${siteOrigin(site)}/`).href;
}

/**
 * JSON for an inline `<script type="application/ld+json">`. `<`, `>` and `&` are escaped
 * as \u003c etc. (still valid JSON), so text such as `</script>` in a toilet's name or a
 * post title can never close the script element; U+2028/U+2029 are escaped as well.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * schema.org JSON-LD for the home page: the WebSite and the Organization that publishes it
 * (the same name the blog posts' `publisher` uses), linked by `@id`.
 */
export function siteJsonLd(site: URL | string | undefined | null): Record<string, unknown> {
  const home = absoluteUrl("/", site);
  const organizationId = `${home}#organization`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${home}#website`,
        url: home,
        name: SITE_NAME,
        description: DEFAULT_DESCRIPTION,
        inLanguage: "en-GB",
        publisher: { "@id": organizationId },
      },
      {
        "@type": "Organization",
        "@id": organizationId,
        name: SITE_NAME,
        url: home,
        logo: absoluteUrl("/apple-touch-icon.png", site),
      },
    ],
  };
}

/** Shortens text to at most `max` characters at a word boundary, adding "…". */
export function truncate(text: string, max = 200): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}
