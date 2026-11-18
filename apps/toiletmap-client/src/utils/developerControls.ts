/**
 * Whether the Settings gear and DevTools are shown: local development builds, and deployed
 * `development`/`preview` environments (the worker's ENVIRONMENT var, passed in by the page).
 * Production — and anything unknown — hides them.
 */
export function showDeveloperControls(
  environment: string | null | undefined,
  isDevBuild: boolean,
): boolean {
  if (isDevBuild) return true;
  const env = (environment ?? "").trim().toLowerCase();
  return env === "development" || env === "preview" || env === "local";
}

/**
 * For pages that only exist for developers (e.g. /dev/components): `null` where the developer
 * controls show, otherwise a body-less 404 that the page returns from its frontmatter, so
 * Astro serves the site's 404 instead. Same rule as the Settings gear and DevTools.
 */
export function developerPageResponse(
  environment: string | null | undefined,
  isDevBuild: boolean,
): Response | null {
  if (showDeveloperControls(environment, isDevBuild)) return null;
  return new Response(null, { status: 404, statusText: "Not Found" });
}
