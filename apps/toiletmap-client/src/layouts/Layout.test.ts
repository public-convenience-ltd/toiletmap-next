// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A smoke test of the page shell's wiring (meta tags, which pages are map pages), so a
 * plain `pnpm test` catches a page losing it. How the shell actually lays out (body and
 * main overflow and height on map vs form pages) is checked on the rendered page, in
 * e2e/layout.spec.ts ("page shell"), not against the CSS source.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const layout = read("./Layout.astro");
const mapPages = {
  "/": read("../pages/index.astro"),
  "/loos/[id]": read("../pages/loos/[id].astro"),
};
const formPages = {
  "/loos/add": read("../pages/loos/add.astro"),
  "/loos/[id]/edit": read("../pages/loos/[id]/edit.astro"),
  "/loos/[id]/remove": read("../pages/loos/[id]/remove.astro"),
};
const contentPages = {
  "/dataset": read("../pages/dataset.astro"),
};

describe("Layout.astro", () => {
  it("lets the page reach under notches and stay unzoomed", () => {
    expect(layout).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
    );
  });

  it("colours the browser chrome with the brand navy", () => {
    expect(layout).toContain('<meta name="theme-color" content="#0a165e" />');
    const tokens = read("../../../toiletmap-design-system/src/tokens.css");
    expect(tokens).toContain("--color-primary-navy: #0a165e;");
  });

  it("does not load Font Awesome (icons come from the design system's sprite)", () => {
    expect(layout).not.toMatch(/font-awesome/i);
  });

  it("takes the document title from a prop, defaulting to Toilet Map", () => {
    expect(layout).toContain('title = "Toilet Map"');
    expect(layout).toContain("<title>{title}</title>");
    expect(contentPages["/dataset"]).toContain('<Layout title="Toilet Map: Our Data">');
  });

  it("puts each page's body class on <body>", () => {
    expect(layout).toContain("<body class:list={[bodyClass]}>");
  });
});

describe.each(Object.entries(mapPages))("map page %s", (_path, source) => {
  it("uses the map-page body class", () => {
    expect(source).toContain('<Layout bodyClass="map-page">');
  });

  it("has a visually hidden page heading", () => {
    expect(source).toContain('<h1 class="visually-hidden">Toilet Map</h1>');
  });

  it("hides the footer on small screens and puts its links in the menu", () => {
    expect(source).toContain("<Footer hideOnMobile />");
    expect(source).toMatch(/<Header[^>]*drawerLinks=\{defaultFooterLinks\}/s);
  });

  it("tells the map which environment it runs in (gates the developer controls)", () => {
    expect(source).toContain('import { env } from "cloudflare:workers";');
    expect(source).toMatch(/<LooMap[^>]*environment=\{env\.ENVIRONMENT\}/s);
  });
});

describe.each(Object.entries({ ...formPages, ...contentPages }))(
  "content page %s",
  (_path, source) => {
    it("scrolls (no map-page body class)", () => {
      expect(source).not.toContain("map-page");
    });
  },
);
