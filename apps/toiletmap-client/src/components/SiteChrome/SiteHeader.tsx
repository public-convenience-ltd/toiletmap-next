import { useEffect, useState } from "preact/hooks";
import { type FooterLink, Header } from "toiletmap-design-system";
import { hasSessionCookie, siteNavLinks } from "../../utils/siteNav";

export interface SiteHeaderProps {
  logoSrc: string;
  /**
   * Signed in or not, as the server saw it. Leave it out on prerendered pages (there is no
   * request to read cookies from): the header then reads the session cookie in the browser.
   */
  isAuthenticated?: boolean;
  /** "Sign in" link (see loginHref). */
  signInHref: string;
  /** Extra links for the small-screen menu (map pages pass the footer's links). */
  drawerLinks?: FooterLink[];
}

/** The design system's Header with the site's one nav list (see siteNavLinks). */
export default function SiteHeader({
  logoSrc,
  isAuthenticated,
  signInHref,
  drawerLinks,
}: SiteHeaderProps) {
  const [signedIn, setSignedIn] = useState(isAuthenticated ?? false);

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

  return (
    <Header
      logoSrc={logoSrc}
      navLinks={siteNavLinks({ isAuthenticated: signedIn, signInHref })}
      drawerLinks={drawerLinks}
    />
  );
}
