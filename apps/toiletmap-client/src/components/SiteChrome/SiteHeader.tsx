import { useEffect, useRef, useState } from "preact/hooks";
import { type FooterLink, Header } from "toiletmap-design-system";
import { currentPath, loginHref, returnToOf } from "../../utils/returnTo";
import { hasSessionCookie, siteNavLinks } from "../../utils/siteNav";

export interface SiteHeaderProps {
  logoSrc: string;
  /**
   * Signed in or not, as the server saw it. Leave it out on prerendered pages (there is no
   * request to read cookies from): the header then reads the session cookie in the browser.
   */
  isAuthenticated?: boolean;
  /** "Sign in" link (see loginHref), as rendered on the server. */
  signInHref: string;
  /**
   * "Sign in" returns to whatever page the browser is on when it is followed, not just the
   * page that was rendered: the map changes its URL (/ to /loos/:id) without reloading.
   * Off for pages that chose a fixed return (or none, like the error page).
   */
  signInFollowsPage?: boolean;
  /** Extra links for the small-screen menu (map pages pass the footer's links). */
  drawerLinks?: FooterLink[];
}

/** The design system's Header with the site's one nav list (see siteNavLinks). */
export default function SiteHeader({
  logoSrc,
  isAuthenticated,
  signInHref,
  signInFollowsPage = false,
  drawerLinks,
}: SiteHeaderProps) {
  const [signedIn, setSignedIn] = useState(isAuthenticated ?? false);
  const [href, setHref] = useState(signInHref);
  const hrefRef = useRef(href);
  hrefRef.current = href;

  useEffect(() => {
    if (isAuthenticated !== undefined) {
      setSignedIn(isAuthenticated);
      return;
    }
    try {
      setSignedIn(hasSessionCookie(document.cookie));
    } catch {
      setSignedIn(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!signInFollowsPage) {
      setHref(signInHref);
      return;
    }
    const fallback = returnToOf(signInHref) ?? "/";
    const live = () => loginHref(currentPath(fallback));
    setHref(live());
    // Brought up to date as the link is followed (click, middle-click, keyboard), so it
    // carries the page the map moved to since the last render.
    const onActivate = (event: Event) => {
      const target = event.target as Element | null;
      const link = target?.closest?.("a");
      if (!link || link.getAttribute("href") !== hrefRef.current) return;
      const next = live();
      link.setAttribute("href", next);
      hrefRef.current = next;
      setHref(next);
    };
    document.addEventListener("click", onActivate, true);
    document.addEventListener("auxclick", onActivate, true);
    return () => {
      document.removeEventListener("click", onActivate, true);
      document.removeEventListener("auxclick", onActivate, true);
    };
  }, [signInHref, signInFollowsPage]);

  return (
    <Header
      logoSrc={logoSrc}
      navLinks={siteNavLinks({ isAuthenticated: signedIn, signInHref: href })}
      drawerLinks={drawerLinks}
    />
  );
}
