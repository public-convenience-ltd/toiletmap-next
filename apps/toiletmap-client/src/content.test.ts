// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { parseFrontmatter } from "astro/markdown";
import { describe, expect, it } from "vitest";
import { pagePath, postPath } from "./utils/content";
import { pageSchema, postSchema } from "./utils/contentSchemas";

/**
 * Every Markdown file in the content collections, checked without a build: its front matter
 * against the schemas the build uses (src/utils/contentSchemas.ts), its URL, and every
 * internal link and image in it. The rendered pages are checked against the built site in
 * content.render.test.ts.
 */
const root = resolve(import.meta.dirname, "..");
const contentDir = join(root, "src/content");
const publicDir = join(root, "public");

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return name.endsWith(".md") ? [path] : [];
  });
}

interface ContentFile {
  file: string;
  /** The entry id, as Astro's glob loader makes it: the path without ".md". */
  id: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

function load(collection: "posts" | "pages"): ContentFile[] {
  const dir = join(contentDir, collection);
  return markdownFiles(dir).map((file) => {
    const { frontmatter, content } = parseFrontmatter(readFileSync(file, "utf8"));
    return {
      file: relative(root, file),
      id: relative(dir, file).replace(/\.md$/, "").split(sep).join("/"),
      frontmatter,
      body: content,
    };
  });
}

const posts = load("posts");
const pages = load("pages");

/** The legacy site's posts (toiletmap/content/posts), whose URLs must keep working. */
const LEGACY_POST_SLUGS = [
  "gender-neutral-toilets-on-the-toilet-map",
  "loos-in-the-news",
  "our-2024-toilet-roll-of-honour",
];

/** The legacy site's text pages (header, footer and app links), except /dataset (Phase 6). */
const LEGACY_PAGES = ["about", "contact", "privacy", "app", "app/privacy"];

/** Server-rendered or generated routes content may link to. */
const ROUTES = [
  /^\/$/,
  /^\/feedback$/,
  /^\/posts$/,
  /^\/posts\/rss\.xml$/,
  /^\/loos\/add$/,
  /^\/loos\/[0-9a-f]{24}$/,
];

function resolvesOnSite(path: string): boolean {
  const pathname = decodeURIComponent(path.split(/[?#]/)[0]);
  if (ROUTES.some((route) => route.test(pathname))) return true;
  if (pages.some((page) => pagePath(page.id) === pathname)) return true;
  if (posts.some((post) => postPath(post.id) === pathname)) return true;
  const file = join(publicDir, pathname);
  return file.startsWith(publicDir) && existsSync(file) && statSync(file).isFile();
}

/** Site-relative links and images in Markdown (`[text](/path)`, `![alt](/path)`, HTML). */
function internalLinks(markdown: string): string[] {
  const links = [
    ...[...markdown.matchAll(/\]\(\s*<?(\/[^)\s>]*)/g)].map((match) => match[1]),
    ...[...markdown.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map((match) => match[1]),
  ];
  return links.filter((link) => !link.startsWith("//"));
}

describe("content collections", () => {
  it("finds the ported content", () => {
    expect(posts.map((post) => post.id).sort()).toEqual(expect.arrayContaining(LEGACY_POST_SLUGS));
    expect(pages.map((page) => page.id).sort()).toEqual(expect.arrayContaining(LEGACY_PAGES));
  });

  it.each(posts.map((post) => [post.file, post] as const))(
    "%s matches the post schema",
    (_, post) => {
      const result = postSchema.safeParse(post.frontmatter);
      expect(result.error?.issues ?? []).toEqual([]);
      expect(post.body.trim().length).toBeGreaterThan(0);
    },
  );

  it.each(pages.map((page) => [page.file, page] as const))(
    "%s matches the page schema",
    (_, page) => {
      const result = pageSchema.safeParse(page.frontmatter);
      expect(result.error?.issues ?? []).toEqual([]);
      expect(page.body.trim().length).toBeGreaterThan(0);
    },
  );

  it("names files the way Astro makes ids (lower-case slugs), so a file's name is its URL", () => {
    for (const entry of [...posts, ...pages]) {
      for (const segment of entry.id.split("/")) {
        expect(segment, entry.file).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      }
      expect(entry.frontmatter.slug, `${entry.file} must not override its URL`).toBeUndefined();
    }
  });

  it("keeps the legacy blog URLs: /posts/<legacy slug>", () => {
    for (const slug of LEGACY_POST_SLUGS) {
      expect(
        posts.find((post) => post.id === slug),
        slug,
      ).toBeDefined();
      expect(postPath(slug)).toBe(`/posts/${slug}`);
    }
  });

  it("keeps the legacy page URLs, /app/privacy included", () => {
    expect(LEGACY_PAGES.map(pagePath)).toEqual([
      "/about",
      "/contact",
      "/privacy",
      "/app",
      "/app/privacy",
    ]);
  });

  it("keeps the post dates and authors from the legacy front matter", () => {
    const byId = Object.fromEntries(
      posts.map((post) => [post.id, postSchema.parse(post.frontmatter)]),
    );
    expect(byId["our-2024-toilet-roll-of-honour"].date.toISOString()).toBe(
      "2024-12-23T14:32:00.000Z",
    );
    expect(byId["our-2024-toilet-roll-of-honour"].authors?.map((a) => a.name)).toEqual([
      "Gail",
      "Ollie",
    ]);
    expect(byId["loos-in-the-news"].date.toISOString()).toBe("2025-05-13T10:46:00.000Z");
    expect(byId["loos-in-the-news"].authors?.[0].name).toBe("Jo-Anne Bichard");
    expect(byId["gender-neutral-toilets-on-the-toilet-map"].date.toISOString()).toBe(
      "2025-05-05T00:57:00.000Z",
    );
  });

  it("keeps the app privacy policy's text (it is registered with the app store)", () => {
    const policy = pages.find((page) => page.id === "app/privacy");
    expect(policy?.frontmatter.heading).toBe("Privacy Policy - Toilet Map");
    for (const text of [
      "Last updated: 5 December 2025",
      'Toilet Map (the "App", "we", "us", or "our") is committed to protecting your privacy.',
      "**Location (ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION):** Required to determine your position and retrieve nearby toilet information.",
      "Toilet Map is not directed at children under 13.",
      "**Organization/Developer Name:** Public Convenience Ltd",
    ]) {
      expect(policy?.body).toContain(text);
    }
    expect(policy?.body.match(/^## /gm)).toHaveLength(10);
  });

  it("leaves /dataset to its own page (Phase 6) and links to no legacy-only routes", () => {
    expect(pages.find((page) => page.id === "dataset")).toBeUndefined();
    for (const entry of [...posts, ...pages]) {
      expect(entry.body, entry.file).not.toMatch(/\]\(\/(?:explorer|map|login|dataset)\b/);
      // Links to our own toilets are relative, so they also work on previews.
      expect(entry.body, entry.file).not.toMatch(
        /\]\(https?:\/\/(?:www\.)?toiletmap\.org\.uk\/loos/,
      );
    }
  });

  it.each([...posts, ...pages].map((entry) => [entry.file, entry] as const))(
    "%s: every internal link and image resolves",
    (_, entry) => {
      const broken = internalLinks(entry.body).filter((link) => !resolvesOnSite(link));
      expect(broken).toEqual([]);
    },
  );

  it("serves every site-relative author avatar from public/", () => {
    for (const post of posts) {
      const { authors = [] } = postSchema.parse(post.frontmatter);
      for (const author of authors) {
        if (author.profile_image_url?.startsWith("/")) {
          expect(resolvesOnSite(author.profile_image_url), author.profile_image_url).toBe(true);
        }
      }
    }
  });

  it("keeps the legacy upload and PDF URLs working", () => {
    for (const path of [
      "/images/uploads/img_6413.jpeg",
      "/images/uploads/48.jpg",
      "/images/uploads/70d58c93-4e4d-4954-8dd5-f3edb0f02749.jpeg",
      "/Toilet.Map.Volunteer.Help.Guide.pdf",
      "/GBPTM.Toilet.Checklist.pdf",
    ]) {
      expect(resolvesOnSite(path), path).toBe(true);
    }
  });
});
