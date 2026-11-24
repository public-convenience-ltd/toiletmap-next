/**
 * The site's main navigation: the one list every page's header shows (via SiteChrome).
 * Safe to import from both the worker and browser islands.
 */
import { defaultFooterLinks, type FooterLink, type NavLink } from "toiletmap-design-system";
import { SIGNED_IN_COOKIE } from "./session";

export interface SiteNavOptions {
  isAuthenticated: boolean;
  /** Where "Sign in" goes: `/auth/login`, with a returnTo when the page wants one (loginHref). */
  signInHref: string;
}

/** The blog lives at /posts (Phase 5 decision); "Blog" is the label people know. */
export const BLOG_PATH = "/posts";

export function siteNavLinks({ isAuthenticated, signInHref }: SiteNavOptions): NavLink[] {
  return [
    { href: "/about", label: "About" },
    { href: BLOG_PATH, label: "Blog" },
    { href: "/contact", label: "Contact" },
    { href: "/feedback", label: "Feedback" },
    { href: "/loos/add", label: "Add a toilet", button: true },
    isAuthenticated
      ? { href: "/auth/logout", label: "Sign out" }
      : { href: signInHref, label: "Sign in" },
  ];
}

/** The feedback page (src/pages/feedback.astro). */
export const FEEDBACK_LINK: FooterLink = { href: "/feedback", label: "Feedback" };

/**
 * The footer's links: the design system's defaults with Feedback after the privacy policy.
 * (Map pages' small-screen menu gets the plain defaults: Feedback is already in the nav.)
 */
export function siteFooterLinks(): FooterLink[] {
  const links = defaultFooterLinks.filter((link) => link.href !== FEEDBACK_LINK.href);
  const privacy = links.findIndex((link) => link.href === "/privacy");
  links.splice(privacy + 1, 0, FEEDBACK_LINK);
  return links;
}

/**
 * Whether a `document.cookie` string holds a signed-in session: the value-less, non-httpOnly
 * `signed_in` flag set at sign-in (src/utils/session.ts). Only for the header's Sign in /
 * Sign out link on prerendered pages; it decides nothing else.
 */
export function hasSessionCookie(cookieString: string | null | undefined): boolean {
  if (!cookieString) return false;
  return cookieString.split(";").some((part) => {
    const [name, ...rest] = part.trim().split("=");
    return name === SIGNED_IN_COOKIE && rest.join("=").trim().length > 0;
  });
}
