import cloudflare from "@astrojs/cloudflare";
import preact from "@astrojs/preact";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  // Absolute URLs in canonicals, social cards, the sitemap, robots.txt and RSS. Previews keep
  // the production default (their pages are noindex anyway); set SITE_URL to override.
  site: process.env.SITE_URL || "https://www.toiletmap.org.uk",
  output: "server",
  // Prerendered pages build to about.html, app/privacy.html, posts.html, ... (not
  // about/index.html), so the static assets serve them at /about and /app/privacy exactly,
  // with no redirect to a trailing slash (the app store links /app/privacy).
  build: { format: "file" },
  adapter: cloudflare(),
  integrations: [preact()],
  // The dev toolbar floats over the bottom of the page, where the map's details sheet sits.
  // The Playwright run (playwright.config.ts) turns it off so it can't take the sheet's taps.
  devToolbar: { enabled: process.env.ASTRO_DEV_TOOLBAR !== "off" },
  server: {
    port: 4321,
  },
});
