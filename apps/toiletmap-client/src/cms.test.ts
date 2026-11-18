// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseFrontmatter } from "astro/markdown";
import { describe, expect, it } from "vitest";
import { pageSchema, postSchema } from "./utils/contentSchemas";
import { DISALLOWED_PATHS, robotsTxt } from "./utils/robots";

/**
 * The CMS at /cms (public/cms/): Sveltia CMS's config matches the repository layout and the
 * content schemas, the CMS build is pinned and integrity-checked, and /cms stays out of
 * search engines. The sign-in endpoints are tested in pages/api/cms-oauth/_cmsOAuth.test.ts.
 */
const clientRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(clientRoot, "../..");
const cmsDir = join(clientRoot, "public/cms");

const read = (path: string) => readFileSync(path, "utf8");
// YAML without a YAML dependency: config.yml is parsed as a Markdown file's front matter.
type Field = { name: string; widget: string; required?: boolean; fields?: Field[] };
interface CmsConfig {
  backend: Record<string, string>;
  publish_mode: string;
  media_folder: string;
  public_folder: string;
  collections: Array<{
    name: string;
    folder?: string;
    extension?: string;
    fields: Field[];
    files: Array<{ name: string; file: string; fields: Field[] }>;
  }>;
}
const config = parseFrontmatter(`---\n${read(join(cmsDir, "config.yml"))}\n---\n`)
  .frontmatter as CmsConfig;
const collection = (name: string) => {
  const found = config.collections.find((c) => c.name === name);
  if (!found) throw new Error(`No ${name} collection in config.yml`);
  return found;
};
const indexHtml = read(join(cmsDir, "index.html"));
const loader = read(join(cmsDir, "cms-loader.js"));

const fieldNames = (fields: Field[]) =>
  fields.map((field) => field.name).filter((name) => name !== "body");

describe("public/cms/config.yml", () => {
  it("edits this repository's main branch, signing in through our own endpoint", () => {
    expect(config.backend).toMatchObject({
      name: "github",
      repo: "public-convenience-ltd/toiletmap-next",
      branch: "main",
      auth_endpoint: "api/cms-oauth/auth",
      auth_scope: "public_repo",
    });
    expect(existsSync(join(clientRoot, "src/pages", `${config.backend.auth_endpoint}.ts`))).toBe(
      true,
    );
  });

  it("uses the editorial workflow (pull requests, published by merging)", () => {
    expect(config.publish_mode).toBe("editorial_workflow");
  });

  it("keeps uploads at the legacy /images/uploads URLs", () => {
    expect(config.public_folder).toBe("/images/uploads");
    expect(config.media_folder).toBe("apps/toiletmap-client/public/images/uploads");
    expect(statSync(join(repoRoot, config.media_folder)).isDirectory()).toBe(true);
  });

  it("writes posts to the posts collection, with the schema's fields", () => {
    const posts = collection("posts");
    expect(posts.folder).toBe("apps/toiletmap-client/src/content/posts");
    expect(statSync(join(repoRoot, posts.folder ?? "")).isDirectory()).toBe(true);
    expect(posts.extension).toBe("md");
    const names = fieldNames(posts.fields);
    expect(names.sort()).toEqual(
      Object.keys(postSchema.shape)
        .filter((key) => key !== "author")
        .sort(),
    );
    const authors = posts.fields.find((field) => field.name === "authors");
    expect(fieldNames(authors?.fields ?? [])).toEqual(["name", "social_url", "profile_image_url"]);
    // Every field the schema requires is required in the CMS too.
    for (const field of posts.fields) {
      const schema = postSchema.shape[field.name as keyof typeof postSchema.shape];
      const optional = schema?.safeParse(undefined).success;
      if (field.name !== "body" && field.name !== "draft") {
        expect(field.required === false, field.name).toBe(!!optional);
      }
    }
  });

  it("lists every page file, each with the page schema's fields", () => {
    const pages = collection("pages");
    const pagesDir = join(clientRoot, "src/content/pages");
    const onDisk = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return walk(path);
        return name.endsWith(".md") ? [path] : [];
      });
    })(pagesDir).map((path) => path.slice(repoRoot.length + 1));
    const files = pages.files.map((file) => file.file);
    expect(files.sort()).toEqual(onDisk.sort());
    for (const file of pages.files) {
      expect(fieldNames(file.fields).sort(), file.name).toEqual(
        Object.keys(pageSchema.shape).sort(),
      );
    }
  });
});

describe("public/cms/index.html and cms-loader.js", () => {
  it("is noindex and points Sveltia at /cms/config.yml", () => {
    expect(indexHtml).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(indexHtml).toContain(
      '<link href="/cms/config.yml" type="application/yaml" rel="cms-config-url" />',
    );
    expect(indexHtml).toContain('<script src="/cms/cms-loader.js"></script>');
    // No inline scripts: a future CSP need only allow 'self' and the CDN.
    expect(indexHtml.match(/<script\b[^>]*>[^<]+<\/script>/g)).toBeNull();
  });

  it("explains, from the status check, when sign-in isn't configured yet", () => {
    expect(indexHtml).toContain("<h1>CMS sign-in isn't configured yet</h1>");
    expect(loader).toContain('fetch("/api/cms-oauth/status"');
  });

  it("loads an exact Sveltia CMS version from the CDN with Subresource Integrity", () => {
    const version = loader.match(/const SVELTIA_VERSION = "([^"]+)";/)?.[1];
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(loader).toMatch(
      /const SVELTIA_SRC = `https:\/\/unpkg\.com\/@sveltia\/cms@\$\{SVELTIA_VERSION\}\/dist\/sveltia-cms\.js`;/,
    );
    expect(loader).toMatch(/const SVELTIA_INTEGRITY =\s+"sha384-[A-Za-z0-9+/]{64}";/);
    expect(loader).toContain("script.integrity = SVELTIA_INTEGRITY;");
    expect(loader).toContain('script.crossOrigin = "anonymous";');
    expect(loader).not.toMatch(/@latest|@\^|@~/);
  });

  it("signs in through the page's own origin", () => {
    expect(loader).toContain("window.CMS_MANUAL_INIT = true;");
    expect(loader).toContain("backend: { base_url: window.location.origin }");
  });
});

describe("/cms and search engines", () => {
  it("is disallowed in robots.txt", () => {
    expect(DISALLOWED_PATHS).toContain("/cms");
    expect(
      robotsTxt({ environment: "production", site: "https://www.toiletmap.org.uk" }),
    ).toContain("Disallow: /cms");
  });

  it("sends X-Robots-Tag: noindex for everything under /cms", () => {
    const headers = read(join(clientRoot, "public/_headers"));
    expect(headers).toMatch(/^\/cms\/\*\n {2}X-Robots-Tag: noindex, nofollow$/m);
    expect(headers).toMatch(/^\/cms\n {2}X-Robots-Tag: noindex, nofollow$/m);
  });

  it("refuses to be framed at /cms as well as /cms/*", () => {
    const headers = read(join(clientRoot, "public/_headers"));
    for (const rule of ["/cms", "/cms/*"]) {
      const block = headers.split(/\n(?=\S)/).find((part) => part.split("\n")[0] === rule);
      expect(block, rule).toContain("X-Frame-Options: DENY");
      expect(block, rule).toContain("Referrer-Policy: same-origin");
    }
  });

  it("is not in the sitemap", () => {
    const sitemap =
      read(join(clientRoot, "src/utils/sitemap.ts")) +
      read(join(clientRoot, "src/utils/sitemapRoute.ts"));
    expect(sitemap).not.toContain("/cms");
  });
});
