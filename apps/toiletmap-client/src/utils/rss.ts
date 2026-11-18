/**
 * The blog's RSS 2.0 feed (/posts/rss.xml), hand-built: every text and URL is XML-escaped
 * (escapeXml), so a title like "Loos & you <3" stays well formed.
 */
import { type PostLike, postAuthorNames, postPath, postSummary, publishedPosts } from "./content";
import { absoluteUrl, SITE_NAME } from "./seo";
import { BLOG_PATH } from "./siteNav";
import { escapeXml, XML_DECLARATION } from "./xml";

export const RSS_PATH = `${BLOG_PATH}/rss.xml`;
export const RSS_TITLE = `${SITE_NAME} blog`;
export const RSS_DESCRIPTION = "News and stories from the Toilet Map.";
/** The newest posts only; older ones are on the blog. */
export const RSS_ITEM_LIMIT = 50;

export interface RssOptions {
  site: URL | string | undefined | null;
  posts: readonly PostLike[];
  /** For lastBuildDate; defaults to the newest post's date. */
  now?: Date;
}

const element = (name: string, value: string | null | undefined) =>
  value ? `<${name}>${escapeXml(value)}</${name}>` : "";

export function buildRss({ site, posts, now }: RssOptions): string {
  const items = publishedPosts(posts).slice(0, RSS_ITEM_LIMIT);
  const blogUrl = absoluteUrl(BLOG_PATH, site);
  const feedUrl = absoluteUrl(RSS_PATH, site);
  const built = now ?? items[0]?.data.date ?? null;

  const itemXml = items.map((post) => {
    const link = absoluteUrl(postPath(post.id), site);
    return [
      "<item>",
      element("title", post.data.title),
      element("link", link),
      `<guid isPermaLink="true">${escapeXml(link)}</guid>`,
      element("pubDate", post.data.date.toUTCString()),
      element("description", postSummary(post)),
      element("dc:creator", postAuthorNames(post)),
      "</item>",
    ]
      .filter(Boolean)
      .join("");
  });

  return [
    XML_DECLARATION,
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "<channel>",
    element("title", RSS_TITLE),
    element("link", blogUrl),
    element("description", RSS_DESCRIPTION),
    "<language>en-gb</language>",
    `<atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>`,
    built ? element("lastBuildDate", built.toUTCString()) : "",
    ...itemXml,
    "</channel>",
    "</rss>",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n")
    .concat("\n");
}

export const RSS_HEADERS = {
  "content-type": "application/rss+xml; charset=utf-8",
  "x-content-type-options": "nosniff",
} as const;
