import { describe, expect, it } from "vitest";
import {
  formatPostDate,
  markdownExcerpt,
  markdownToText,
  type PostLike,
  paginatePosts,
  postAuthorNames,
  postAuthors,
  postImage,
  postSummary,
  postsIndexPath,
} from "./content";

const post = (data: Partial<PostLike["data"]> = {}, body?: string): PostLike => ({
  id: "a-post",
  body,
  data: { title: "A post", date: new Date("2025-05-05T00:57:00.000Z"), ...data },
});

describe("postAuthors / postAuthorNames", () => {
  it("lists the legacy `authors` in order, linking only http(s) profiles", () => {
    const entry = post({
      authors: [
        {
          name: "Gail",
          social_url: "https://bsky.app/profile/gail",
          profile_image_url: "/images/uploads/g.webp",
        },
        {
          name: " Ollie ",
          social_url: "javascript:alert(1)",
          profile_image_url: "data:image/png;base64,x",
        },
      ],
    });
    expect(postAuthors(entry)).toEqual([
      { name: "Gail", url: "https://bsky.app/profile/gail", image: "/images/uploads/g.webp" },
      { name: "Ollie", url: undefined, image: undefined },
    ]);
    expect(postAuthorNames(entry)).toBe("Gail and Ollie");
  });

  it("falls back to a single `author`, and to nobody", () => {
    expect(postAuthorNames(post({ author: "Jo-Anne" }))).toBe("Jo-Anne");
    expect(postAuthorNames(post())).toBeUndefined();
    expect(postAuthorNames(post({ authors: [{ name: "A" }, { name: "B" }, { name: "C" }] }))).toBe(
      "A, B and C",
    );
  });
});

describe("markdownToText / markdownExcerpt / postSummary", () => {
  const body = [
    "Welcome to the **Toilet Map** blog! See [the map](/) and [^note].",
    "",
    "![A photo](/images/uploads/a.jpg)",
    "",
    "| a | b |",
    "| - | - |",
    "",
    "- - -",
    "",
    "## Heading",
    "",
    "[^note]: A footnote",
    "    that continues.",
  ].join("\n");

  it("keeps link text and drops images, tables, rules, footnotes and markup", () => {
    const text = markdownToText(body);
    expect(text).toContain("Welcome to the Toilet Map blog! See the map and .");
    expect(text).not.toMatch(/photo|\||footnote|continues|\*\*|##/);
    expect(text).toContain("Heading");
  });

  it("summarises the opening paragraphs to a meta-description length", () => {
    const long = `${"Word ".repeat(60)}\n\nSecond paragraph.`;
    const excerpt = markdownExcerpt(long, 160) ?? "";
    expect(excerpt.length).toBeLessThanOrEqual(160);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(markdownExcerpt("Short.\n\nAnd more.", 160)).toBe("Short. And more.");
    expect(markdownExcerpt("")).toBeUndefined();
  });

  it("prefers the front matter description", () => {
    expect(postSummary(post({ description: "Given." }, body))).toBe("Given.");
    expect(postSummary(post({}, body))).toMatch(/^Welcome to the Toilet Map blog!/);
    expect(postSummary(post())).toBeUndefined();
  });
});

describe("postImage", () => {
  it("uses `image`, else the first Markdown image (with its alt text on one line)", () => {
    expect(postImage(post({ image: "/images/uploads/card.jpg" }))).toEqual({
      src: "/images/uploads/card.jpg",
    });
    expect(
      postImage(post({}, "Text\n\n![A toilet\non a hill](/images/uploads/a.jpg)\n\n![b](/b.jpg)")),
    ).toEqual({ src: "/images/uploads/a.jpg", alt: "A toilet on a hill" });
    expect(postImage(post({}, '![x](https://example.org/x.jpg "Title")'))).toEqual({
      src: "https://example.org/x.jpg",
      alt: "x",
    });
    expect(postImage(post({}, "No images here."))).toBeUndefined();
    expect(postImage(post({}, "![x](javascript:alert(1))"))).toBeUndefined();
  });
});

describe("paginatePosts / postsIndexPath", () => {
  const items = Array.from({ length: 45 }, (_, index) => index);

  it("puts 20 on a page, page 1 at /posts and the rest at /posts/page/<n>", () => {
    expect(postsIndexPath(1)).toBe("/posts");
    expect(postsIndexPath(3)).toBe("/posts/page/3");
    const first = paginatePosts(items, 1);
    expect(first).toMatchObject({
      page: 1,
      pageCount: 3,
      prevPath: null,
      nextPath: "/posts/page/2",
    });
    expect(first.items).toHaveLength(20);
    const last = paginatePosts(items, 3);
    expect(last).toMatchObject({ page: 3, prevPath: "/posts/page/2", nextPath: null });
    expect(last.items).toEqual([40, 41, 42, 43, 44]);
  });

  it("is one page when there are 20 or fewer (or none)", () => {
    expect(paginatePosts(items.slice(0, 20), 1)).toMatchObject({ pageCount: 1, nextPath: null });
    expect(paginatePosts([], 1)).toMatchObject({ items: [], page: 1, pageCount: 1 });
  });

  it("clamps out-of-range pages", () => {
    expect(paginatePosts(items, 99).page).toBe(3);
    expect(paginatePosts(items, 0).page).toBe(1);
  });
});

describe("formatPostDate", () => {
  it("writes UK dates in UK time", () => {
    expect(formatPostDate(new Date("2024-12-23T14:32:00.000Z"))).toBe("23 December 2024");
    // 23:30 UTC on 30 June is already 1 July in London (BST).
    expect(formatPostDate(new Date("2025-06-30T23:30:00.000Z"))).toBe("1 July 2025");
  });
});
