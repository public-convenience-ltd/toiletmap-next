/**
 * Front matter schemas for the content collections (src/content.config.ts). Kept apart from
 * the collection config, which imports `astro:content`, so unit tests can validate every
 * Markdown file against exactly the schemas the build uses (src/content.test.ts).
 *
 * The CMS (public/cms/config.yml) writes these same fields: keep the two in step.
 */
import { z } from "astro/zod";

/** One of a post's authors, as the legacy site and the CMS write them. */
export const postAuthorSchema = z.object({
  name: z.string().min(1),
  /** Link on the author's name, e.g. their Bluesky profile. */
  social_url: z.string().optional(),
  /** Avatar shown next to the byline: a path under public/ or an absolute URL. */
  profile_image_url: z.string().optional(),
});

export const postSchema = z.object({
  title: z.string().min(1),
  /** Publication date (an ISO date or date-time in front matter). */
  date: z.coerce.date(),
  /** Meta description and RSS summary. Defaults to the start of the post. */
  description: z.string().optional(),
  /** A single author's name. Posts from the legacy site and the CMS use `authors`. */
  author: z.string().optional(),
  /** The post's authors, in byline order. */
  authors: z.array(postAuthorSchema).optional(),
  /** Social-card image: a path under public/ or an absolute URL. Defaults to its first image. */
  image: z.string().optional(),
  /** Drafts build nowhere: not as a page, nor in RSS or the sitemap. */
  draft: z.boolean().default(false),
});

export const pageSchema = z.object({
  /** The page's name in the document title ("About – Toilet Map") and the sitemap. */
  title: z.string().min(1),
  /** The page's <h1>. Defaults to the title. */
  heading: z.string().optional(),
  description: z.string().optional(),
});

export type PostAuthor = z.infer<typeof postAuthorSchema>;
export type PostData = z.infer<typeof postSchema>;
export type PageData = z.infer<typeof pageSchema>;
