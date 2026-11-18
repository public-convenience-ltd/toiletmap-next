// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { parseFrontmatter } from "astro/markdown";
import { describe, expect, it } from "vitest";
import { pagePath, postPath } from "./utils/content";
import { pageSchema, postSchema } from "./utils/contentSchemas";

/**
 * The prerendered content pages and posts in the built site (dist/client): every page and
 * post rendered at its URL (legacy slugs included), with its heading, title and canonical,
 * no signed-in state baked in, and no broken links in the page body.
 *
 * Like render.test.ts this needs `astro build` output; it is skipped when dist/ is missing
 * or was built before these pages existed.
 */
const root = resolve(import.meta.dirname, "..");
const client = join(root, "dist/client");
const built =
  existsSync(join(client, "posts.html")) && existsSync(join(client, "app/privacy.html"));
const SITE = "https://www.toiletmap.org.uk";

function entries(collection: "posts" | "pages") {
  const dir = join(root, "src/content", collection);
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((name) => {
      const path = join(d, name);
      if (statSync(path).isDirectory()) return walk(path);
      return name.endsWith(".md") ? [path] : [];
    });
  return walk(dir).map((file) => ({
    id: relative(dir, file).replace(/\.md$/, "").split(sep).join("/"),
    frontmatter: parseFrontmatter(readFileSync(file, "utf8")).frontmatter,
  }));
}

const pages = entries("pages").map((entry) => ({
  ...entry,
  data: pageSchema.parse(entry.frontmatter),
}));
const posts = entries("posts")
  .map((entry) => ({ ...entry, data: postSchema.parse(entry.frontmatter) }))
  .filter((post) => !post.data.draft);

/** The built HTML for a URL path (build.format "file": /about → about.html). */
const html = (path: string) =>
  readFileSync(join(client, `${path === "/" ? "index" : path.slice(1)}.html`), "utf8");

const decode = (text: string) =>
  text
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

/** Server-rendered routes a content page may link to (not files in dist/client). */
const SERVER_ROUTES = [/^\/$/, /^\/feedback$/, /^\/loos\/add$/, /^\/loos\/[0-9a-f]{24}$/];

function linkResolves(href: string): boolean {
  const path = decodeURIComponent(href.split(/[?#]/)[0]);
  if (SERVER_ROUTES.some((route) => route.test(path))) return true;
  for (const candidate of [path, `${path}.html`]) {
    const file = join(client, candidate);
    if (file.startsWith(client) && existsSync(file) && statSync(file).isFile()) return true;
  }
  return false;
}

/** Site-relative links and images inside <main> (the header and footer are tested elsewhere). */
function mainLinks(page: string): string[] {
  const main = page.match(/<main\b[\s\S]*<\/main>/)?.[0] ?? "";
  return [...main.matchAll(/\b(?:href|src)="(\/(?!\/)[^"]*)"/g)].map((match) => decode(match[1]));
}

function expectStaticShell(page: string) {
  // Prerendered for everyone: the header works out the sign-in state in the browser.
  expect(page).not.toContain("Sign out");
  expect(page).not.toMatch(/isAuthenticated[^,}]*true/);
}

describe.skipIf(!built)("built content pages (dist/client)", () => {
  it.each(pages.map((page) => [pagePath(page.id), page] as const))("%s renders", (path, page) => {
    const out = html(path);
    expect(decode(out)).toContain(`<title>${page.data.title} – Toilet Map</title>`);
    expect(decode(out)).toMatch(
      new RegExp(
        `<h1[^>]*>${(page.data.heading ?? page.data.title).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</h1>`,
      ),
    );
    expect(out).toContain(`<link rel="canonical" href="${SITE}${path}">`);
    expect(out).toContain('class="prose"');
    expectStaticShell(out);
    expect(mainLinks(out).filter((href) => !linkResolves(href))).toEqual([]);
  });

  it("serves the app privacy policy at exactly /app/privacy", () => {
    expect(existsSync(join(client, "app/privacy.html"))).toBe(true);
    expect(existsSync(join(client, "app/privacy/index.html"))).toBe(false);
    expect(html("/app/privacy")).toContain("ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION");
  });

  it.each(posts.map((post) => [postPath(post.id), post] as const))("%s renders", (path, post) => {
    const out = html(path);
    const text = decode(out);
    expect(text).toContain(`<title>${post.data.title} – Toilet Map</title>`);
    expect(text).toContain(`>${post.data.title}</h1>`);
    expect(out).toContain(`<link rel="canonical" href="${SITE}${path}">`);
    expect(out).toContain(`<time datetime="${post.data.date.toISOString()}"`);
    expect(out).toContain('"@type":"BlogPosting"');
    expect(out).toContain('<meta property="og:type" content="article">');
    for (const author of post.data.authors ?? []) expect(text).toContain(author.name);
    expectStaticShell(out);
    expect(mainLinks(out).filter((href) => !linkResolves(href))).toEqual([]);
  });

  it("keeps the legacy post URLs", () => {
    for (const slug of [
      "gender-neutral-toilets-on-the-toilet-map",
      "loos-in-the-news",
      "our-2024-toilet-roll-of-honour",
    ]) {
      expect(existsSync(join(client, `posts/${slug}.html`)), slug).toBe(true);
    }
  });

  it("renders the roll of honour's tables and footnotes", () => {
    const out = html("/posts/our-2024-toilet-roll-of-honour");
    expect(out.match(/<table>/g)?.length).toBeGreaterThanOrEqual(3);
    expect(out).toContain('href="/loos/9c87f46cef7571c34d4a9f6a"');
    expect(out).toMatch(/data-footnotes|class="footnotes"/);
  });

  it('gives post bodies Prose\'s rhythm: the Markdown sits in <article class="prose">', () => {
    for (const post of posts) {
      expect(html(postPath(post.id)), post.id).toMatch(/<article class="post prose\b/);
    }
  });

  it("hides GFM's 'Footnotes' label: the stylesheet defines the .sr-only it uses", () => {
    expect(html("/posts/our-2024-toilet-roll-of-honour")).toMatch(/<h2 class="sr-only"/);
    const css = readdirSync(join(client, "_astro"))
      .filter((file) => file.endsWith(".css"))
      .map((file) => readFileSync(join(client, "_astro", file), "utf8"))
      .join("\n");
    expect(css).toMatch(/\.sr-only\s*[,{]/);
  });

  it("serves the roll of honour's photo (also its social card) from this site", () => {
    const out = html("/posts/our-2024-toilet-roll-of-honour");
    const image = "/images/uploads/trafalgar-square-fourth-plinth-and-toilets.jpg";
    expect(out).toContain(`<meta property="og:image" content="${SITE}${image}">`);
    expect(existsSync(join(client, image))).toBe(true);
    expect(out).not.toContain("upload.wikimedia.org/wikipedia/commons/thumb");
  });

  it("lists every published post on /posts, newest first", () => {
    const out = html("/posts");
    expect(decode(out)).toContain("<title>Blog – Toilet Map</title>");
    const order = [
      ...out.matchAll(/<h2 class="post-list__title[^"]*"[^>]*><a href="([^"]+)"/g),
    ].map((m) => m[1]);
    const expected = [...posts]
      .sort((a, b) => b.data.date.getTime() - a.data.date.getTime())
      .map((post) => postPath(post.id));
    expect(order).toEqual(expected.slice(0, 20));
    expectStaticShell(out);
  });
});
