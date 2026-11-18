// @vitest-environment node
import { defaultFooterLinks } from "toiletmap-design-system";
import { describe, expect, it } from "vitest";
import { FEEDBACK_LINK, siteFooterLinks, siteNavLinks } from "./siteNav";

describe("siteFooterLinks", () => {
  it("adds Feedback after the privacy policy, keeping the design system's links", () => {
    const links = siteFooterLinks();
    expect(links.map((l) => l.href)).toEqual([
      "/privacy",
      "/feedback",
      ...defaultFooterLinks.slice(1).map((l) => l.href),
    ]);
    expect(links[1]).toEqual(FEEDBACK_LINK);
    expect(FEEDBACK_LINK).toEqual({ href: "/feedback", label: "Feedback" });
  });

  it("does not change the design system's list (map menus use it as it is)", () => {
    siteFooterLinks();
    expect(defaultFooterLinks.some((l) => l.href === "/feedback")).toBe(false);
  });

  it("is also in the nav, so the map's small-screen menu has it once", () => {
    const nav = siteNavLinks({ isAuthenticated: false, signInHref: "/auth/login" });
    expect(nav.filter((l) => l.href === "/feedback")).toHaveLength(1);
  });
});
