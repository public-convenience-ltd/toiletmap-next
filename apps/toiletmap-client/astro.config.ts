import cloudflare from "@astrojs/cloudflare";
import preact from "@astrojs/preact";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: cloudflare(),
  integrations: [preact()],
  // The dev toolbar floats over the bottom of the page, where the map's details sheet sits.
  // The Playwright run (playwright.config.ts) turns it off so it can't take the sheet's taps.
  devToolbar: { enabled: process.env.ASTRO_DEV_TOOLBAR !== "off" },
  server: {
    port: 4321,
  },
});
