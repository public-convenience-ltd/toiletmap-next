// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A smoke test of the page shells' wiring (meta tags, which pages are map pages, the one
 * nav), so a plain `pnpm test` catches a page losing it. What the meta logic produces is
 * unit-tested in utils/seo.test.ts and utils/looSeo.test.ts; the rendered pages (statuses,
 * tags) in seo.render.test.ts against the built worker; how the shells lay out (body and
 * main overflow on map vs form pages) in e2e/layout.spec.ts.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const base = read("./BaseLayout.astro");
const mapLayout = read("./MapLayout.astro");
const contentLayout = read("./ContentLayout.astro");
const chrome = read("../components/SiteChrome/SiteChrome.astro");

const mapPages = {
  "/": read("../pages/index.astro"),
  "/loos/[id]": read("../pages/loos/[id].astro"),
};
const formPages = {
  "/loos/add": read("../pages/loos/add.astro"),
  "/loos/[id]/edit": read("../pages/loos/[id]/edit.astro"),
  "/loos/[id]/remove": read("../pages/loos/[id]/remove.astro"),
};
const errorPages = {
  "/404": read("../pages/404.astro"),
  "/500": read("../pages/500.astro"),
};
const datasetPage = read("../pages/dataset.astro");

describe("BaseLayout.astro", () => {
  it("lets the page reach under notches and stay unzoomed", () => {
    expect(base).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
    );
  });

  it("colours the browser chrome with the brand navy", () => {
    expect(base).toContain('<meta name="theme-color" content="#0a165e" />');
    const tokens = read("../../../toiletmap-design-system/src/tokens.css");
    expect(tokens).toContain("--color-primary-navy: #0a165e;");
  });

  it("does not load Font Awesome (icons come from the design system's sprite)", () => {
    expect(base).not.toMatch(/font-awesome/i);
  });

  it("puts each page's body class on <body>", () => {
    expect(base).toContain("<body class:list={[bodyClass]}>");
  });

  it("writes the description, robots, canonical, Open Graph and Twitter tags", () => {
    expect(base).toContain('<meta name="description" content={description} />');
    expect(base).toContain('{robots && <meta name="robots" content={robots} />}');
    expect(base).toContain('{canonicalUrl && <link rel="canonical" href={canonicalUrl} />}');
    for (const property of ["og:title", "og:description", "og:url", "og:type", "og:site_name"]) {
      expect(base, property).toContain(`property="${property}"`);
    }
    for (const name of ["twitter:card", "twitter:title", "twitter:description"]) {
      expect(base, name).toContain(`name="${name}"`);
    }
  });

  it("decides robots from the deployment, so previews are never indexed", () => {
    expect(base).toContain('import { env } from "cloudflare:workers";');
    expect(base).toContain("robotsContent({ noindex, nofollow, environment: env.ENVIRONMENT })");
  });

  it("inlines JSON-LD only through the escaping serialiser", () => {
    expect(base).toContain("serializeJsonLd(jsonLd)");
    expect(base).toMatch(
      /<script is:inline type="application\/ld\+json" set:html=\{structuredData\}/,
    );
  });

  it("keeps the analytics tag and the head slot", () => {
    expect(base).toContain("<Analytics />");
    expect(base).toContain('<slot name="head" />');
  });

  it("only map pages are locked to one screen", () => {
    expect(base).toMatch(/body\.map-page\s*\{[^}]*overflow: hidden/);
    expect(base).not.toMatch(/(^|\n)\s*body\s*\{[^}]*overflow: hidden/);
  });
});

describe("MapLayout / ContentLayout / SiteChrome", () => {
  it("MapLayout is the map-page body class with the map chrome", () => {
    expect(mapLayout).toContain('bodyClass="map-page"');
    expect(mapLayout).toContain("<SiteChrome map");
  });

  it("ContentLayout puts the content in the design system's prose column and scrolls", () => {
    expect(contentLayout).toContain('<div class="prose">');
    expect(contentLayout).not.toContain("map-page");
    const stylesheet = read("../../../toiletmap-design-system/src/stylesheet.css");
    expect(stylesheet).toContain('@import "./components/Prose/Prose.css";');
  });

  it("SiteChrome hides the footer on small map screens and moves its links into the menu", () => {
    expect(chrome).toContain("<Footer links={siteFooterLinks()} hideOnMobile={map} />");
    expect(chrome).toContain("drawerLinks={map ? defaultFooterLinks : undefined}");
  });
});

describe.each(Object.entries(mapPages))("map page %s", (_path, source) => {
  it("uses MapLayout", () => {
    expect(source).toMatch(/<MapLayout[\s>]/);
  });

  it("has a visually hidden page heading", () => {
    // "Toilet Map" on the home page; the toilet's name on /loos/:id (seo.render.test.ts).
    expect(source).toMatch(/<h1 class="visually-hidden">(?:Toilet Map|\{heading\})<\/h1>/);
  });

  it("tells the map which environment it runs in (gates the developer controls)", () => {
    expect(source).toContain('import { env } from "cloudflare:workers";');
    expect(source).toMatch(/<LooMap[^>]*environment=\{env\.ENVIRONMENT\}/s);
  });
});

describe("/loos/[id]", () => {
  const source = mapPages["/loos/[id]"];

  it("loads the toilet on the server and 404s an unknown one with the site's 404 page", () => {
    expect(source).toContain("await loadLoo(");
    expect(source).toContain('if (load.kind === "not-found") return notFoundResponse();');
  });

  it("describes the toilet in its meta", () => {
    expect(source).toContain("looPageMeta(load.loo, Astro.site)");
    expect(source).toContain("<MapLayout {...meta}>");
  });
});

describe.each(Object.entries(formPages))("form page %s", (_path, source) => {
  it("scrolls (no map-page body class) and has the site chrome", () => {
    expect(source).not.toContain("map-page");
    expect(source).toContain("<SiteChrome");
  });

  it("is kept out of search results", () => {
    expect(source).toMatch(/<BaseLayout[^>]*\bnoindex\b/s);
  });
});

describe.each(Object.entries(errorPages))("error page %s", (_path, source) => {
  it("uses ContentLayout and is noindex", () => {
    expect(source).toMatch(/<ContentLayout[^>]*\bnoindex\b/s);
  });
});

describe("/dataset", () => {
  it("is a text page: ContentLayout (site chrome, scrolls), not a map page", () => {
    expect(datasetPage).toMatch(/<ContentLayout[\s>]/);
    expect(datasetPage).not.toContain("map-page");
  });

  it("sets its title, description and canonical, and stays indexable", () => {
    expect(datasetPage).toContain('title={pageTitle("Our Data")}');
    expect(datasetPage).toMatch(/<ContentLayout[^>]*\bdescription="[^"]+"/s);
    expect(datasetPage).toContain("canonical={DATASET_PATH}");
    expect(datasetPage).not.toMatch(/<ContentLayout[^>]*\bnoindex\b/s);
  });
});

describe("the nav is defined once", () => {
  const pagesDir = new URL("../pages", import.meta.url).pathname;
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(astro|ts|tsx)$/.test(name) && !/\.test\./.test(name)) files.push(path);
    }
  };
  walk(pagesDir);

  it.each(files.map((file) => [relative(pagesDir, file), file]))(
    "%s builds no navLinks array of its own",
    (_name, file) => {
      expect(readFileSync(file, "utf8")).not.toMatch(/navLinks\s*=/);
    },
  );

  it("the 500 page is prerendered, so it does not depend on what just failed", () => {
    expect(errorPages["/500"]).toContain("export const prerender = true;");
  });
});
