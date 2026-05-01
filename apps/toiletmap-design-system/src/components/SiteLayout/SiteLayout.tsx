import type { ComponentChildren } from "preact";
import type { FooterLink } from "../Footer/Footer";
import Footer from "../Footer/Footer";
import Header from "../Header/Header";
import type { NavLink } from "../Header/MainMenu";

interface SiteLayoutProps {
  children: ComponentChildren;
  map?: ComponentChildren;
  logoSrc: string;
  logoHref?: string;
  navLinks?: NavLink[];
  footerLinks?: FooterLink[];
  onLogoClick?: () => void;
}

const SiteLayout = ({
  children,
  map,
  logoSrc,
  logoHref,
  navLinks,
  footerLinks,
  onLogoClick,
}: SiteLayoutProps) => (
  <div class="site-layout">
    <Header logoSrc={logoSrc} logoHref={logoHref} navLinks={navLinks} onLogoClick={onLogoClick} />
    <div class="site-layout__wrapper">
      <main class="site-layout__content">
        {map ? (
          <div class="site-layout__map-container">
            {children}
            {map}
          </div>
        ) : (
          children
        )}
      </main>
    </div>
    <Footer links={footerLinks} />
  </div>
);

export default SiteLayout;
