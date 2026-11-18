// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseFrontmatter } from "astro/markdown";
import { describe, expect, it } from "vitest";
import { REMOTE_IMAGE_ORIGINS, siteContentSecurityPolicy } from "./utils/securityHeaders";

/**
 * The Markdown content (blog posts and pages, which CMS editors write) stays inside the site's
 * Content Security Policy: every image it shows is local or on a host img-src allows, and it
 * has no inline scripts (script-src allows only the site's own; the build also fails on one).
 */
const contentRoot = resolve(import.meta.dirname, "content");

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

const files = markdownFiles(contentRoot).map((path) => ({
  name: relative(contentRoot, path),
  source: readFileSync(path, "utf8"),
}));

/** Every image a page renders from `source`: Markdown images, raw <img>, author avatars. */
function imageUrls(source: string): string[] {
  const { frontmatter, content } = parseFrontmatter(source);
  const urls: string[] = [];
  for (const match of content.matchAll(/!\[[^\]]*\]\(\s*<?([^\s)>]+)/g)) urls.push(match[1] ?? "");
  for (const match of content.matchAll(/<img\b[^>]*\ssrc\s*=\s*["']?([^"'\s>]+)/gi)) {
    urls.push(match[1] ?? "");
  }
  const authors = (frontmatter as { authors?: Array<{ profile_image_url?: unknown }> }).authors;
  for (const author of authors ?? []) {
    if (typeof author.profile_image_url === "string") urls.push(author.profile_image_url.trim());
  }
  return urls;
}

const imgSrc = siteContentSecurityPolicy()
  .split("; ")
  .find((directive) => directive.startsWith("img-src "))
  ?.split(" ")
  .slice(1);

describe("content and the Content Security Policy", () => {
  it("finds the content", () => {
    expect(files.map((file) => file.name)).toContain("posts/our-2024-toilet-roll-of-honour.md");
  });

  it("lets the site's img-src show the remote image hosts content uses", () => {
    for (const origin of REMOTE_IMAGE_ORIGINS) expect(imgSrc).toContain(origin);
  });

  it.each(files)("$name shows only local images or ones from an allowed host", ({ source }) => {
    for (const url of imageUrls(source)) {
      if (url.startsWith("/") && !url.startsWith("//")) continue;
      expect(
        (REMOTE_IMAGE_ORIGINS as readonly string[]).includes(new URL(url).origin),
        `${url}: copy it into public/images/uploads, or add its host to REMOTE_IMAGE_ORIGINS`,
      ).toBe(true);
    }
  });

  it.each(files)("$name has no inline scripts or event handlers", ({ source }) => {
    expect(source).not.toMatch(/<script\b/i);
    expect(source).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
  });

  it("reads Markdown images, raw <img> tags and avatars", () => {
    const urls = imageUrls(
      [
        "---",
        "authors:",
        "  - name: A",
        "    profile_image_url: https://a.example/me.png",
        "---",
        '![A photo,\nover two lines](https://b.example/x.jpg "Title")',
        '<img alt="" src="https://c.example/y.png">',
      ].join("\n"),
    );
    expect(urls).toEqual([
      "https://b.example/x.jpg",
      "https://c.example/y.png",
      "https://a.example/me.png",
    ]);
  });
});
