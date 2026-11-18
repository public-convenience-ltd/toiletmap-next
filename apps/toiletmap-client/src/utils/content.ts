/**
 * URLs, ordering and display helpers for the content collections (src/content.config.ts),
 * shared by the post and page routes, the RSS feed and the sitemap so they always agree.
 * Pure functions: callers pass entries from `getCollection()`.
 */
import { truncate } from "./seo";
import { BLOG_PATH } from "./siteNav";

export interface PostAuthorLike {
  name: string;
  social_url?: string;
  profile_image_url?: string;
}

export interface PostLike {
  id: string;
  /** The Markdown source (without front matter), when the loader provides it. */
  body?: string;
  data: {
    title: string;
    date: Date;
    description?: string;
    author?: string;
    authors?: readonly PostAuthorLike[];
    image?: string;
    draft?: boolean;
  };
}

export interface PageLike {
  id: string;
  data: { title: string; heading?: string; description?: string };
}

const encodePath = (id: string) =>
  id
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

/** A post's URL: /posts/<id>. */
export function postPath(id: string): string {
  return `${BLOG_PATH}/${encodePath(id)}`;
}

/** A page's URL: /<id> (e.g. "app/privacy" → /app/privacy). */
export function pagePath(id: string): string {
  return `/${encodePath(id)}`;
}

/** Posts that are published (not drafts), newest first. */
export function publishedPosts<T extends PostLike>(posts: readonly T[]): T[] {
  return posts
    .filter((post) => !post.data.draft)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

/** Posts per page of the blog index (/posts, then /posts/page/2, ...). */
export const POSTS_PER_PAGE = 20;

/** The URL of a page of the blog index: page 1 is /posts itself. */
export function postsIndexPath(page: number): string {
  return page <= 1 ? BLOG_PATH : `${BLOG_PATH}/page/${page}`;
}

export interface PostsPage<T> {
  items: T[];
  page: number;
  pageCount: number;
  prevPath: string | null;
  nextPath: string | null;
}

/** One page of the blog index (pages count from 1; there is always at least one). */
export function paginatePosts<T>(
  posts: readonly T[],
  page: number,
  perPage = POSTS_PER_PAGE,
): PostsPage<T> {
  const pageCount = Math.max(1, Math.ceil(posts.length / perPage));
  const current = Math.min(Math.max(1, Math.floor(page)), pageCount);
  return {
    items: posts.slice((current - 1) * perPage, current * perPage),
    page: current,
    pageCount,
    prevPath: current > 1 ? postsIndexPath(current - 1) : null,
    nextPath: current < pageCount ? postsIndexPath(current + 1) : null,
  };
}

export interface Byline {
  name: string;
  /** Link on the name (e.g. a Bluesky profile), only when it is an http(s) URL. */
  url?: string;
  /** Avatar: a site path or an http(s) URL. */
  image?: string;
}

const isWebUrl = (value: string | undefined): value is string =>
  !!value && /^https?:\/\//i.test(value.trim());
const isImageSource = (value: string | undefined): value is string =>
  !!value && /^(?:https?:\/\/|\/(?!\/))/i.test(value.trim());

/** A post's authors in byline order: `authors`, or the single `author`, or none. */
export function postAuthors(post: PostLike): Byline[] {
  const authors: readonly PostAuthorLike[] = post.data.authors?.length
    ? post.data.authors
    : post.data.author
      ? [{ name: post.data.author }]
      : [];
  return authors
    .filter((author) => author.name.trim())
    .map((author) => ({
      name: author.name.trim(),
      url: isWebUrl(author.social_url) ? author.social_url.trim() : undefined,
      image: isImageSource(author.profile_image_url) ? author.profile_image_url.trim() : undefined,
    }));
}

/** "Gail", "Gail and Ollie", "A, B and C"; undefined when the post names nobody. */
export function postAuthorNames(post: PostLike): string | undefined {
  const names = postAuthors(post).map((author) => author.name);
  if (names.length === 0) return undefined;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Markdown to plain text, roughly: enough for a meta description or an RSS summary. Images,
 * footnotes, tables, HTML and rules are dropped; links keep their text.
 */
export function markdownToText(markdown: string): string {
  return (
    markdown
      .replace(/\r\n?/g, "\n")
      // Footnote definitions, including their indented continuation lines.
      .replace(/^\[\^[^\]]+\]:.*(?:\n(?: {2,}|\t).*)*/gm, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[\^[^\]]+\]/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/^\s*\|.*$/gm, "")
      .replace(/^\s*(?:[-*_]\s*){3,}$/gm, "")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
      .replace(/(\*\*|__|\*|`)/g, "")
      .replace(/[ \t]+\n/g, "\n")
  );
}

/** Plain text of the post's opening paragraphs, up to about `max` characters. */
export function markdownExcerpt(markdown: string, max = 160): string | undefined {
  const paragraphs = markdownToText(markdown)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  let text = "";
  for (const paragraph of paragraphs) {
    text = text ? `${text} ${paragraph}` : paragraph;
    if (text.length >= max) break;
  }
  return text ? truncate(text, max) : undefined;
}

/** The post's description, or failing that the start of the post. */
export function postSummary(post: PostLike, max = 160): string | undefined {
  const description = post.data.description?.trim();
  if (description) return description;
  return post.body ? markdownExcerpt(post.body, max) : undefined;
}

/** The post's social-card image: `image`, or the first image in its Markdown. */
export function postImage(post: PostLike): { src: string; alt?: string } | undefined {
  if (isImageSource(post.data.image)) return { src: post.data.image.trim() };
  const match = post.body?.match(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)/);
  if (!match || !isImageSource(match[2])) return undefined;
  const alt = match[1].replace(/\s+/g, " ").trim();
  return { src: match[2], alt: alt || undefined };
}

const POST_DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/London",
});

/** "23 December 2024" (UK date, in UK time). */
export function formatPostDate(date: Date): string {
  return POST_DATE_FORMAT.format(date);
}
