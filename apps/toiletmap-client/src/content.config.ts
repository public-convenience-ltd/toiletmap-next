/**
 * Content collections: Markdown files under src/content/, edited in git or through the CMS
 * (/cms, which writes the same files; see public/cms/config.yml and docs/cms.md).
 *
 * - `posts`: the blog, at /posts/<id> (see postPath in src/utils/content.ts), also in
 *   /posts/rss.xml and the sitemap. Drafts are left out of all three.
 * - `pages`: standalone text pages (about, privacy, ...), at /<id> (see pagePath), and in
 *   the sitemap. Rendered by src/pages/[...slug].astro.
 *
 * An entry's id is its path under the collection folder without the extension, so
 * src/content/pages/app/privacy.md is the page "app/privacy", at /app/privacy, and
 * src/content/posts/loos-in-the-news.md is the post at /posts/loos-in-the-news (the legacy
 * site's slugs, which links out there still use).
 *
 * The front matter schemas live in src/utils/contentSchemas.ts, so tests can check every file
 * against them without a build.
 */
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { pageSchema, postSchema } from "./utils/contentSchemas";

const posts = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/posts" }),
  schema: postSchema,
});

const pages = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/pages" }),
  schema: pageSchema,
});

export const collections = { posts, pages };
