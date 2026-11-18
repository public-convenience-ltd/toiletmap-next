// @vitest-environment node
import { describe, expect, it } from "vitest";
import { pagePath, postPath, publishedPosts } from "./content";
import { buildRss, RSS_HEADERS, RSS_ITEM_LIMIT } from "./rss";

const SITE = "https://www.toiletmap.org.uk";

const post = (
  id: string,
  date: string,
  extra: Partial<{ title: string; description: string; author: string; draft: boolean }> = {},
) => ({ id, data: { title: extra.title ?? id, date: new Date(date), ...extra } });

describe("buildRss", () => {
  it("is an RSS 2.0 channel for the blog, with a self link", () => {
    const xml = buildRss({ site: SITE, posts: [post("hello", "2025-03-04T09:00:00Z")] });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain("<title>Toilet Map blog</title>");
    expect(xml).toContain(`<link>${SITE}/posts</link>`);
    expect(xml).toContain(
      `<atom:link href="${SITE}/posts/rss.xml" rel="self" type="application/rss+xml"/>`,
    );
    expect(xml).toContain("<lastBuildDate>Tue, 04 Mar 2025 09:00:00 GMT</lastBuildDate>");
    expect(xml).toContain(
      `<item><title>hello</title><link>${SITE}/posts/hello</link><guid isPermaLink="true">${SITE}/posts/hello</guid><pubDate>Tue, 04 Mar 2025 09:00:00 GMT</pubDate></item>`,
    );
  });

  it("escapes titles, descriptions and authors", () => {
    const xml = buildRss({
      site: SITE,
      posts: [
        post("x", "2025-01-01", {
          title: "Loos & you <3",
          description: 'A "quoted" <b>summary</b>',
          author: "O'Brien & co",
        }),
      ],
    });
    expect(xml).toContain("<title>Loos &amp; you &lt;3</title>");
    expect(xml).toContain(
      "<description>A &quot;quoted&quot; &lt;b&gt;summary&lt;/b&gt;</description>",
    );
    expect(xml).toContain("<dc:creator>O&apos;Brien &amp; co</dc:creator>");
    expect(xml).not.toContain("<b>");
  });

  it("leaves drafts out and lists the newest first, up to the limit", () => {
    const posts = [
      post("old", "2020-01-01"),
      post("draft", "2030-01-01", { draft: true }),
      post("new", "2025-01-01"),
    ];
    const xml = buildRss({ site: SITE, posts });
    expect(xml).not.toContain("/posts/draft");
    expect(xml.indexOf("/posts/new")).toBeLessThan(xml.indexOf("/posts/old"));

    const many = Array.from({ length: RSS_ITEM_LIMIT + 5 }, (_, i) =>
      post(`p${i}`, new Date(Date.UTC(2020, 0, 1 + i)).toISOString()),
    );
    expect(buildRss({ site: SITE, posts: many }).match(/<item>/g)).toHaveLength(RSS_ITEM_LIMIT);
  });

  it("is a valid empty channel before any posts exist", () => {
    const xml = buildRss({ site: SITE, posts: [] });
    expect(xml).toContain("<channel>");
    expect(xml).not.toContain("<item>");
    expect(xml).not.toContain("lastBuildDate");
  });

  it("is served as RSS", () => {
    expect(RSS_HEADERS["content-type"]).toBe("application/rss+xml; charset=utf-8");
  });
});

describe("content paths", () => {
  it("puts posts under /posts and pages at the root, encoding each segment", () => {
    expect(postPath("2024-05-a-post")).toBe("/posts/2024-05-a-post");
    expect(pagePath("app/privacy")).toBe("/app/privacy");
    expect(pagePath("a b/c?d")).toBe("/a%20b/c%3Fd");
  });

  it("orders published posts newest first", () => {
    expect(
      publishedPosts([post("a", "2020-01-01"), post("b", "2021-01-01")]).map((p) => p.id),
    ).toEqual(["b", "a"]);
  });
});

describe("buildRss with legacy-style posts", () => {
  it("credits every author and summarises a post without a description from its text", () => {
    const xml = buildRss({
      site: SITE,
      posts: [
        {
          id: "roll",
          body: "Welcome to the **Toilet Map** blog! [Read more](/posts).\n\n| a | b |",
          data: {
            title: "Roll of Honour",
            date: new Date("2024-12-23T14:32:00Z"),
            authors: [{ name: "Gail" }, { name: "Ollie" }],
          },
        },
      ],
    });
    expect(xml).toContain("<dc:creator>Gail and Ollie</dc:creator>");
    expect(xml).toContain("<description>Welcome to the Toilet Map blog! Read more.</description>");
  });
});
